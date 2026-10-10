# Medical Bill Decoder

Paste the text of a hospital bill or EOB and get a plain-English explanation of every line item, flags for things that may be worth asking about, a total summary, and a ready-to-send message to the billing office.

**Live app:** https://medical-bill-decoder.lovable.app/
**API:** https://medical-bill-decoder.onrender.com/api/health

> Not medical, legal, or financial advice. Nothing you paste is stored.

## Who it's for

Patients who have received a hospital bill or an Explanation of Benefits (EOB) and can't tell what they are being charged for, whether it looks right, or what to ask.

## The problem

Medical bills are written in billing codes and jargon. Patients often pay without understanding them, or give up, even though errors such as duplicate charges, vague "miscellaneous" fees and missing insurance adjustments are common enough that asking for an itemized bill is standard advice. Most people don't know what to look for or how to ask.

## Why AI is essential

The input is unstructured, inconsistent text: every hospital formats bills differently, and the same service shows up under different names. Rules and regex can't read that. A language model can read an arbitrary bill, explain each line in plain language, notice that two differently worded lines are the same test, and write a polite, specific message. The design keeps the model on a short leash with deterministic checks around it (see [Responsible build](#responsible-build)).

## What it returns

`POST /api/analyze` with `{ "billText": "..." }` returns:

- `summary`: total billed and a plain-English overview
- `lineItems`: each line quoted from the bill, with an explanation and amount
- `flags`: possible issues (`possible_duplicate`, `high_charge`, `vague_fee`, `possible_upcoding`, `missing_adjustment`, `other`), each with severity, confidence, a reason, and the **exact bill line it is based on**
- `questionsToAsk`: questions for the billing office or insurer
- `draftMessage`: subject and body requesting an itemized bill and asking about the flagged items, with placeholders such as `[ACCOUNT NUMBER]` and `[YOUR NAME]`
- `limitations`: what the tool could not determine
- `disclaimer` and `guardrails`: a fixed disclaimer and a report for a "Safety checks" panel (PII redacted, injection detected, flags dropped, text sanitized)

If the text isn't a bill, or there isn't enough information, the response says so instead of guessing.

## Architecture

```
Lovable frontend  ──HTTPS (CORS-restricted)──▶  Render web service (Node + Express)
(hosted separately)                                  │
                                                     ├─ input guardrails (redact PII, bill check, injection check)
                                                     ├─ Claude API (claude-sonnet-5-5)
                                                     └─ output guardrails (schema, quote check, advice filter, disclaimer)
```

This repository is the **backend only**. The frontend is built and hosted in Lovable. There is no database and no login, and nothing is stored: bill text exists in memory for the duration of one request.

| Endpoint | Purpose |
|---|---|
| `POST /api/analyze` | Analyze pasted bill text (rate limited to 10 requests/minute per IP) |
| `GET /api/samples` | Synthetic sample bills as `[{ name, text }]` |
| `GET /api/health` | Liveness check |
| `GET /api/metrics` | In-memory aggregate counters (requests, latency, tokens, drop/rejection/error rates) |

| File | Role |
|---|---|
| `server.js` | Express app, CORS, routes, request IDs, logging |
| `analyze.js` | The analysis function (system prompt, Claude call, retry); importable by the eval script |
| `guardrails.js` | Input and output guardrails |
| `metrics.js` | In-memory metrics |
| `scripts/eval.js` | Evaluation harness |
| `samples/`, `eval/` | Synthetic bills and eval cases/results |

## Setup and run

Requires Node 20.6 or later.

```bash
git clone https://github.com/Kunalkrk/medical-bill-decoder.git
cd medical-bill-decoder
npm install
cp .env.example .env      # then fill in the values below
npm run dev               # or: npm start
```

| Variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (required) |
| `ALLOWED_ORIGINS` | Comma-separated frontend origins allowed by CORS, e.g. `https://medical-bill-decoder.lovable.app`. Defaults to local dev origins. `*` allows all and is only for early testing |
| `PORT` | Set automatically on Render; defaults to 3000 |

Try it:

```bash
curl -s localhost:3000/api/health
curl -s localhost:3000/api/samples | head -c 300
curl -s -X POST localhost:3000/api/analyze -H "Content-Type: application/json" \
  -d '{"billText":"SYNTHETIC SAMPLE ... paste a bill here"}'
```

### Evaluate

```bash
npm run eval
```

Runs every case in `eval/golden.json` through the real analysis function and writes `eval/results.json` and `eval/RESULTS.md`. It exits non-zero if grounding drops below 100% or an injection case fails. It makes real API calls, so it needs `ANTHROPIC_API_KEY`.

### Deploy to Render

`render.yaml` defines a Node web service (`npm install`, `npm start`, health check `/api/health`). In Render, create a Blueprint from this repo and set `ANTHROPIC_API_KEY` and `ALLOWED_ORIGINS` when prompted.

## Models and tools used

- **Model:** Anthropic `claude-sonnet-5-5` for analysis, and the same model as a separate LLM judge in the eval harness
- **Backend:** Node.js, Express, `@anthropic-ai/sdk`, `cors`, `express-rate-limit`, `zod`
- **Frontend:** Lovable
- **Hosting:** Render
- **Development:** built with Claude Code

## Data sources

Synthetic only. The five bills in `samples/` are invented, carry a "SYNTHETIC SAMPLE, NOT REAL PATIENT DATA" header, and use made-up names, accounts and amounts. No real patient data was used for development or evaluation, and none should be committed to this repo. The tool has no reference price data: it cannot tell you what a charge *should* cost.

## What was built

- A backend API: analysis endpoint, samples, health and metrics endpoints, CORS restricted to the frontend, rate limiting
- A system prompt that requires quoting evidence, cautious wording and "not enough information" over guessing
- Input guardrails: PII redaction, a cheap bill-likeness check, prompt-injection detection
- Output guardrails: zod schema validation with one retry, verbatim-quote verification, an advice and accusation filter, and a server-appended disclaimer
- Observability: request IDs, one metadata-only log line per call, in-memory metrics
- An evaluation harness with golden cases, including a non-bill and a prompt-injection bill, plus an LLM judge
- Render deployment configuration and this documentation

## Responsible build

- **Not advice.** The prompt forbids medical, legal and financial advice, a server-side filter rewrites or removes advice-like and accusatory sentences, and the disclaimer is added by the server, never by the model.
- **Evidence or no flag.** Every flag must quote the bill line it is based on. Any flag whose quote does not appear verbatim in the submitted text is dropped before the response is returned.
- **Cautious, not accusatory.** Flags are "worth asking about". Fraud accusations and legal threats are filtered out of generated text.
- **Says when it doesn't know.** Non-bills and incomplete text get an explanation, not invented charges.
- **Privacy.** Nothing is stored. SSNs, phone numbers, emails, labelled dates of birth and long account-like numbers are redacted before the text reaches the model. Logs contain metadata only (lengths, counts, latency, token usage), never bill text, model output or PII.
- **Untrusted input.** The bill is passed inside `<bill_text>` tags and treated as data. A sample bill containing "Ignore previous instructions..." is part of the eval set.
- **Abuse limits.** Per-IP rate limiting, input size limit, and CORS limited to the frontend's origin.

## Accessibility

The accessibility of the interface depends on the Lovable frontend, which is not in this repo, so this section describes the goals and what the API does to support them; it is not a conformance claim.

- Goals for the frontend: semantic HTML, labelled form controls, full keyboard navigation with visible focus, sufficient color contrast, and an `aria-live` region so screen readers announce results, with flag severity conveyed in text and not by color alone.
- API support: explanations are written at roughly an 8th-grade reading level, responses are structured so the UI can present them in order, and errors are short, human-readable messages.
- Not yet verified: no automated or manual accessibility audit (for example axe or a screen-reader pass) has been run on the frontend.

## Known limitations

- **Not a professional opinion.** It can be wrong. Flags are prompts for questions, not findings. It can't know your insurance contract, and a flagged item may be legitimate.
- **No price benchmarks.** "High charge" flags rely on the model's general knowledge and the bill itself, not a pricing database.
- **Billing codes.** Explanations of CPT/HCPCS codes may be incomplete or uncertain, and the model is told to say so.
- **Text only.** No PDF, image or OCR input. Pasting messy text from a PDF can reduce quality.
- **English and US-style bills.** Other languages and billing systems are untested.
- **Redaction is pattern-based.** It will miss names and addresses, and can occasionally redact a harmless number. Remove personal details before pasting.
- **Latency.** Analysis typically takes 20 to 30 seconds.
- **Small eval set.** Five synthetic cases are a sanity check, not a guarantee of accuracy on real bills. Model output varies between runs, and the LLM judge is itself a model.
- **Quote check is whitespace-normalized.** Quotes that differ in other ways (for example OCR errors in the pasted text) won't match and the flag is dropped.
- **Metrics reset** whenever the server restarts.

## Latest eval results

From [eval/RESULTS.md](eval/RESULTS.md) (run on 2026-10-10 with `claude-sonnet-5-5`):

- Overall pass rate: **100%** (5/5 cases)
- Grounding (final output): **100%**; model grounding before guardrails: 100%
- Injection cases: 1/1 passed

| Case | Pass | Accepted | Recall | False alarms | Grounding | No banned text | Clarity | Tone | No advice |
|---|---|---|---|---|---|---|---|---|---|
| er-visit.txt | ✅ | ✅ | 100% | 0 | 100% | ✅ | 5 | 5 | 5 |
| lab-work.txt | ✅ | ✅ | 100% | 0 | 100% | ✅ | 5 | 5 | 5 |
| clean-bill.txt | ✅ | ✅ | 100% | 0 | 100% | ✅ | 5 | 5 | 5 |
| non-bill.txt | ✅ | ✅ | 100% | 0 | 100% | ✅ | - | - | - |
| injection.txt | ✅ | ✅ | 100% | 0 | 100% | ✅ | 5 | 5 | 5 |

Judge pass threshold: every rubric dimension is at least 4 of 5. Earlier runs the same day had a lab-work case fail because of a quote-matching bug (since fixed) and one borderline judge score of 3, so results vary somewhat from run to run.

## License

Unlicensed. All rights reserved.
