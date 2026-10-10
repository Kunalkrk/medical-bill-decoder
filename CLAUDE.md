# Medical Bill Decoder (backend API)

Backend-only API for patients confused by hospital bills or EOBs. The frontend is built separately in **Lovable** and hosted elsewhere; **do not build UI in this repo**. The user pastes bill text into that frontend, which calls this API. The API returns:
1. A plain-English explanation of every line item
2. Flags for possible issues (duplicate charges, unusually high amounts, vague "miscellaneous" fees, possible upcoding, missing insurance adjustments)
3. A total summary
4. A ready-to-send draft message requesting an itemized bill or disputing flagged charges

## Stack and constraints
- Node + Express, single server, ESM (`"type": "module"`).
- Claude API via `@anthropic-ai/sdk`, model `claude-sonnet-5-5`, key from env `ANTHROPIC_API_KEY` (never hardcode, never log, never expose).
- Text paste only. No PDF/OCR, no login, no database, **nothing stored** (no files, sessions, or bill text in logs).
- CORS via the `cors` package; allowed origins come from env `ALLOWED_ORIGINS` (comma-separated, defaults to localhost dev origins). Don't use `*`.
- Deploys to Render as a web service (`npm start`, listen on `process.env.PORT`, health check `/api/health`).

## API
- `GET /api/health` — liveness
- `GET /api/samples` — sample bills from `samples/` as JSON
- `GET /api/metrics` — in-memory aggregate counters (JSON)
- `POST /api/decode` — `{ text }` in, `{ lineItems, flags, summary, draftMessage, disclaimer }` out

## Layout
- `server.js` — Express app, CORS, routes, Claude call, wiring of guardrails/metrics
- `guardrails.js` — input and output checks (pure functions, unit-testable)
- `scripts/eval.js` — evaluation harness, `npm run eval`
- `samples/` — fake/synthetic bills served by `/api/samples`. **Never commit real patient data.**
- `eval/` — eval cases (input + expected properties)

## Commands
- `npm start` — run server
- `npm run dev` — run with `node --watch`
- `npm run eval` — run eval harness (needs `ANTHROPIC_API_KEY`)

## Non-negotiable product rules
- Output is **never** presented as medical, legal, or financial advice. A disclaimer is included in every response; the output guardrail rejects advice-like phrasing ("you should sue", "you don't owe this").
- If information is insufficient, the model must say **"not enough information"** instead of guessing (amounts, codes, insurer rules).
- **Every flag must quote the exact line it is based on**, verbatim from the input. The output guardrail verifies the quote is a substring of the input; failing flags are dropped or the response is rejected.
- Flags are "possible issue / worth asking about", never accusations of fraud.
- Draft message is a request/question, not a legal demand; uses placeholders for name/account/date, never invented values.

## Guardrails (`guardrails.js`)
- Input: non-empty, max length, plain text, reject obviously unrelated content, treat bill text as data not instructions (prompt-injection), warn about SSN / full DOB / card numbers.
- Output: schema validation of Claude's JSON, quote-must-appear-in-input, banned advice phrasing, disclaimer present, "not enough information" where data is missing.

## Observability
- Logs are **metadata only**: request id, timestamp, input length, line-item count, flag count/types, guardrail outcomes, latency, token usage, status. **Never log bill text or model output.**
- `GET /api/metrics` exposes counters; they reset on restart (nothing is persisted).

## Evaluation (`npm run eval`)
- Cases in `eval/` run through the same pipeline as `/api/decode`.
- Checks: schema valid, flag quotes verbatim, no advice phrasing, "not enough information" on underspecified input, known issues flagged, clean bills not over-flagged.
- Exit non-zero on failure.

## Code style
- Small functions; no new dependencies without a reason.
- Secrets only via env; `.env` is gitignored; `.env.example` documents every variable.

## Status
Scaffold only: TODO stubs, no analysis logic yet.
