// Input and output guardrails. Pure functions, no I/O, never log or return raw bill text from here.

import { z } from "zod";

export const DISCLAIMER =
  "This tool explains billing terms and suggests questions to ask. It is not medical, legal, or financial advice. " +
  "Confirm anything important with your provider, your insurer, or a qualified professional.";

export const NOT_A_BILL_MESSAGE =
  "This doesn't look like a medical bill. Please paste the text of a hospital bill, itemized statement, or EOB " +
  "that includes charges and dollar amounts.";

/* ------------------------------------------------------------------ */
/* INPUT                                                               */
/* ------------------------------------------------------------------ */

const REDACTED = "[REDACTED]";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SSN_RE = /(?<!\d)\d{3}[- ]\d{2}[- ]\d{4}(?!\d)/g;
// Only dates that follow a birth-date label; service dates must survive.
const DOB_RE =
  /(?<=\b(?:DOB|D\.O\.B\.?|date of birth|birth ?date|birthday)\s*[:#-]?\s*)(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})/gi;
const PHONE_RE = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/g;
// Runs of digits (optionally hyphenated) with 9+ digits in total. Skips amounts like $1,234,567.00.
const LONG_NUMBER_RE = /(?<![\w$.,-])\d+(?:-\d+)*(?!\w)/g;

/** Replace PII patterns with [REDACTED]. Returns the redacted text and per-type counts. */
export function redactPII(text) {
  const counts = { ssn: 0, phone: 0, email: 0, dob: 0, account: 0 };
  const swap = (re, key) => {
    text = text.replace(re, () => {
      counts[key]++;
      return REDACTED;
    });
  };
  swap(EMAIL_RE, "email");
  swap(SSN_RE, "ssn");
  swap(DOB_RE, "dob");
  swap(PHONE_RE, "phone");
  text = text.replace(LONG_NUMBER_RE, (m) => {
    if (m.replaceAll("-", "").length < 9) return m;
    counts.account++;
    return REDACTED;
  });
  return { text, counts: { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) } };
}

const CURRENCY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/;
const CODE_RE = /\b(?:\d{5}|[A-V]\d{4})\b/; // CPT / HCPCS style
const BILL_WORDS_RE = /\b(?:charges?|patient|balance|insurance|service)\b/i;

/** Cheap check that the text has dollar amounts plus at least one billing signal. */
export function looksLikeBill(text) {
  return CURRENCY_RE.test(text) && (CODE_RE.test(text) || BILL_WORDS_RE.test(text));
}

const INJECTION_PATTERNS = [
  ["ignore_instructions", /\b(?:ignore|disregard|forget)\b[^.\n]{0,30}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,30}\b(?:instructions?|prompts?|rules)\b/i],
  ["system_prompt", /\bsystem\s+prompt\b/i],
  ["role_override", /\byou\s+are\s+now\b/i],
  ["new_instructions", /\bnew\s+instructions?\s*:/i],
];

/** Returns the labels of any prompt-injection patterns found. Does not block. */
export function detectInjection(text) {
  return INJECTION_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label);
}

/** Run all input guardrails. */
export function runInputGuardrails(billText) {
  const { text: redactedText, counts } = redactPII(billText);
  return {
    redactedText,
    piiRedacted: counts,
    billLike: looksLikeBill(redactedText),
    injectionTriggers: detectInjection(redactedText),
  };
}

/* ------------------------------------------------------------------ */
/* OUTPUT                                                              */
/* ------------------------------------------------------------------ */

const flagSchema = z.object({
  type: z.enum(["possible_duplicate", "high_charge", "vague_fee", "possible_upcoding", "missing_adjustment", "other"]),
  severity: z.enum(["low", "medium", "high"]),
  quote: z.string(),
  why: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
});

export const analysisSchema = z.object({
  summary: z.object({
    totalBilled: z.string().nullable(),
    plainSummary: z.string(),
  }),
  lineItems: z.array(
    z.object({
      quote: z.string(),
      explanation: z.string(),
      amount: z.string().nullable(),
    })
  ),
  flags: z.array(flagSchema),
  questionsToAsk: z.array(z.string()),
  draftMessage: z.object({ subject: z.string(), body: z.string() }),
  limitations: z.string(),
});

/** @returns {{ ok: true, data: object } | { ok: false }} */
export function validateSchema(obj) {
  const parsed = analysisSchema.safeParse(obj);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

const normalizeWs = (s) => s.replace(/\s+/g, " ").trim();

/** Drop flags whose quote is not found verbatim (whitespace-normalized) in the redacted bill. */
export function dropUnsupportedFlags(result, redactedText) {
  const haystack = normalizeWs(redactedText);
  const flags = result.flags.filter((f) => {
    const q = normalizeWs(f.quote);
    return q !== "" && haystack.includes(q);
  });
  return { result: { ...result, flags }, flagsDropped: result.flags.length - flags.length };
}

// Sentence-level rules: a sentence matching a pattern is replaced with neutral text ("" removes it).
const ADVICE_RULES = [
  {
    name: "legal_threat",
    re: /\b(?:sue|sued|suing|lawsuit|legal action|legal counsel|attorney general|my (?:lawyer|attorney)|(?:hire|consult|contact) (?:a |an )?(?:lawyer|attorney)|report(?:ing|ed)? (?:you|this|the (?:hospital|provider)) to)\b/i,
    neutral: "",
  },
  {
    name: "medical_directive",
    re: /\byou (?:should|must|need to|ought to|have to)\s+(?:stop|start|take|avoid|skip|see (?:a|your) doctor|seek (?:medical|emergency)|go to the (?:er|emergency))\b/i,
    neutral: "Please discuss any health questions with your healthcare provider.",
  },
  {
    name: "financial_directive",
    re: /\b(?:do not|don't|dont|never|refuse to|should not|shouldn't)\s+pay\b|\byou (?:do not|don't) (?:owe|have to pay)\b|\byou (?:should|must) (?:pay|dispute|refuse)\b/i,
    neutral: "Please confirm the amounts with your billing department before paying.",
  },
  {
    name: "fraud_accusation",
    re: /\b(?:fraud(?:ulent(?:ly)?)?|scam(?:s|med)?|illegal(?:ly)?|criminal|swindl\w*|rip(?:ped|ping)? (?:you|me|us) off|overbilling you)\b/i,
    neutral: "This item may be worth confirming with the billing department.",
  },
];

/** Replace or remove advice-like sentences in one string. */
function sanitizeString(s, hits) {
  // Split keeping separators so newlines and spacing in the draft message survive.
  const parts = s.split(/([.!?]+\s+|\n+)/);
  const seen = new Set();
  let changed = false;
  for (let i = 0; i < parts.length; i += 2) {
    const rule = ADVICE_RULES.find((r) => r.re.test(parts[i]));
    if (!rule) continue;
    hits.push(rule.name);
    changed = true;
    const neutral = rule.neutral && !seen.has(rule.neutral) ? rule.neutral : "";
    if (neutral) seen.add(neutral);
    parts[i] = neutral;
  }
  return changed ? parts.join("").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim() : s;
}

/**
 * Scan generated text for advice-like phrasing. Flag and line-item quotes are left alone:
 * they are verbatim bill text, not generated text.
 */
export function sanitizeGeneratedText(result) {
  const hits = [];
  const s = (str) => sanitizeString(str, hits);
  const out = {
    ...result,
    summary: { ...result.summary, plainSummary: s(result.summary.plainSummary) },
    lineItems: result.lineItems.map((li) => ({ ...li, explanation: s(li.explanation) })),
    flags: result.flags.map((f) => ({ ...f, why: s(f.why) })),
    questionsToAsk: result.questionsToAsk.map(s).filter(Boolean),
    draftMessage: { subject: s(result.draftMessage.subject), body: s(result.draftMessage.body) },
    limitations: s(result.limitations),
  };
  return { result: out, textSanitized: hits.length, triggers: [...new Set(hits)] };
}

/** Run output guardrails (after schema validation). Always appends the fixed disclaimer. */
export function runOutputGuardrails(validated, redactedText) {
  const { result: kept, flagsDropped } = dropUnsupportedFlags(validated, redactedText);
  const { result: clean, textSanitized, triggers } = sanitizeGeneratedText(kept);
  return { result: { ...clean, disclaimer: DISCLAIMER }, flagsDropped, textSanitized, sanitizerTriggers: triggers };
}

/** Response for text that failed the bill-likeness check. The model is never called. */
export function notABillResponse(input) {
  return {
    summary: { totalBilled: null, plainSummary: NOT_A_BILL_MESSAGE },
    lineItems: [],
    flags: [],
    questionsToAsk: [],
    draftMessage: { subject: "", body: "" },
    limitations: NOT_A_BILL_MESSAGE,
    disclaimer: DISCLAIMER,
    guardrails: buildGuardrailsReport(input, { billLike: false }),
  };
}

export function buildGuardrailsReport(input, { flagsDropped = 0, textSanitized = 0, billLike = true } = {}) {
  return {
    piiRedacted: input.piiRedacted,
    injectionDetected: input.injectionTriggers.length > 0,
    flagsDropped,
    textSanitized,
    billLike,
  };
}
