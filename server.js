// Medical Bill Decoder — backend-only Express API for a separately hosted Lovable frontend.
// Analysis logic lives in analyze.js. See CLAUDE.md for rules.

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBill, AnalyzeError, MODEL } from "./analyze.js";

const SAMPLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "samples");
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; needed for per-IP rate limiting

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (no Origin header) and listed origins.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Origin not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "100kb" }));
// TODO: request id + metadata-only logging middleware (never log bill text or output)
// TODO: in-memory metrics counters

// TODO: GET /api/health — liveness for Render (e.g. { status: "ok" })
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

// TODO: GET /api/metrics — aggregate counters as JSON
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

app.post("/api/analyze", analyzeLimiter, async (req, res) => {
  const started = Date.now();
  const billText = req.body?.billText;
  try {
    const result = await analyzeBill(billText);
    // Metadata only: never log billText or model output.
    console.log(JSON.stringify({ event: "analyze", status: 200, inputChars: billText.length, flags: result.flags.length, ms: Date.now() - started }));
    res.json(result);
  } catch (err) {
    const status = err instanceof AnalyzeError ? err.status : 500;
    const message = err instanceof AnalyzeError ? err.message : "Something went wrong. Please try again.";
    console.log(JSON.stringify({ event: "analyze", status, ms: Date.now() - started }));
    res.status(status).json({ error: message });
  }
});

// Malformed JSON bodies etc.
app.use((err, req, res, next) => {
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 500 ? "Something went wrong." : "Invalid request." });
});

app.listen(PORT, () => {
  console.log(`listening on ${PORT} (model: ${MODEL}, origins: ${ALLOWED_ORIGINS.join(", ")})`);
});
