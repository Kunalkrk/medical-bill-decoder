// Medical Bill Decoder — backend-only Express API for a separately hosted Lovable frontend.
// Scaffold only: no analysis logic yet. See CLAUDE.md for rules.

import express from "express";
import cors from "cors";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// import Anthropic from "@anthropic-ai/sdk";
// import { validateInput, validateOutput } from "./guardrails.js";

const MODEL = "claude-sonnet-5-5";
const SAMPLES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "samples");
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (no Origin header) and listed origins.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Origin not allowed by CORS"));
    },
  })
);
// TODO: express.json({ limit }) with a small body limit
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
// TODO: POST /api/decode
//   1. validateInput(text)
//   2. call Claude (MODEL) with system prompt: not advice, "not enough information", quote exact lines
//   3. validateOutput(result, text)
//   4. return { lineItems, flags, summary, draftMessage, disclaimer }

app.listen(PORT, () => {
  console.log(`listening on ${PORT} (model: ${MODEL}, origins: ${ALLOWED_ORIGINS.join(", ")})`);
});
