# Medical Bill Decoder (API)

Backend-only API. The frontend is built separately in Lovable and hosted elsewhere.

Given pasted bill or EOB text, it returns a plain-English explanation of each line item, flags for possible issues, a total summary, and a draft message requesting an itemized bill or disputing flagged charges.

**Not medical, legal, or financial advice.** Nothing is stored.

## Endpoints
- `GET /api/health`
- `GET /api/samples`
- `GET /api/metrics`
- `POST /api/decode`

## Run locally
```
cp .env.example .env   # add ANTHROPIC_API_KEY, set ALLOWED_ORIGINS
npm install
npm start
```

## Evaluate
```
npm run eval
```

## Deploy (Render)
Web service. Build: `npm install`. Start: `npm start`. Health check path: `/api/health`.
Set `ANTHROPIC_API_KEY` and `ALLOWED_ORIGINS` (your Lovable site origin) as environment variables.

TODO: expand. See [CLAUDE.md](CLAUDE.md) for design rules.
