// Medical Bill Decoder — backend-only Express API for a separately hosted Lovable frontend.
// Analysis logic lives in analyze.js. See CLAUDE.md for rules.

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { analyzeBill, AnalyzeError, MODEL } from "./analyze.js";
import { recordRequest, getMetrics } from "./metrics.js";

const SAMPLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "samples");
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; needed for per-IP rate limiting

app.use((req, res, next) => {
  req.id = randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (no Origin header), listed origins, or everything if "*" is listed.
      if (!origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Origin not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.get("/api/samples", async (req, res) => {
  try {
    const files = (await readdir(SAMPLES_DIR)).filter((f) => f.endsWith(".txt")).sort();
    const samples = await Promise.all(
      files.map(async (f) => ({
        name: f.replace(/\.txt$/, ""),
        text: await readFile(path.join(SAMPLES_DIR, f), "utf8"),
      }))
    );
    res.json(samples);
  } catch {
    res.status(500).json({ error: "Could not load samples" });
  }
});

app.get("/api/metrics", (req, res) => res.json(getMetrics()));

const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

app.post("/api/analyze", analyzeLimiter, async (req, res) => {
  const started = Date.now();
  const meta = {};
  let status = 200;
  let body;
  try {
    body = await analyzeBill(req.body?.billText, meta);
  } catch (err) {
    const known = err instanceof AnalyzeError;
    status = known ? err.status : 500;
    meta.error = known ? err.message : "Internal error"; // static, user-safe strings only
    body = { error: known ? err.message : "Something went wrong. Please try again." };
  }
  // One metadata-only log line per call: never bill text, model output, or PII.
  const entry = {
    requestId: req.id,
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - started,
    model: meta.model ?? MODEL,
    inputTokens: meta.inputTokens ?? 0,
    outputTokens: meta.outputTokens ?? 0,
    billLengthChars: meta.billLengthChars ?? 0,
    lineItemCount: meta.lineItemCount ?? 0,
    flagCount: meta.flagCount ?? 0,
    flagsDropped: meta.flagsDropped ?? 0,
    piiRedactedCount: meta.piiRedactedCount ?? 0,
    injectionDetected: meta.injectionDetected ?? false,
    rejectedAsNonBill: meta.rejectedAsNonBill ?? false,
    error: meta.error ?? null,
  };
  console.log(JSON.stringify(entry));
  recordRequest(entry);
  res.status(status).json(body);
});

// Malformed JSON bodies etc.
app.use((err, req, res, next) => {
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 500 ? "Something went wrong." : "Invalid request." });
});

app.listen(PORT, () => {
  console.log(`listening on ${PORT} (model: ${MODEL}, origins: ${ALLOWED_ORIGINS.join(", ")})`);
});
