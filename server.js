// Medical Bill Decoder — backend-only Express API for a separately hosted Lovable frontend.
// Scaffold only: no analysis logic yet. See CLAUDE.md for rules.

import express from "express";
import cors from "cors";
// import Anthropic from "@anthropic-ai/sdk";
// import { validateInput, validateOutput } from "./guardrails.js";

const MODEL = "claude-sonnet-5-5";
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
// TODO: GET /api/samples — read ./samples and return the sample bills as JSON
// TODO: GET /api/metrics — aggregate counters as JSON
// TODO: POST /api/decode
//   1. validateInput(text)
//   2. call Claude (MODEL) with system prompt: not advice, "not enough information", quote exact lines
//   3. validateOutput(result, text)
//   4. return { lineItems, flags, summary, draftMessage, disclaimer }

app.listen(PORT, () => {
  console.log(`listening on ${PORT} (model: ${MODEL}, origins: ${ALLOWED_ORIGINS.join(", ")})`);
});
