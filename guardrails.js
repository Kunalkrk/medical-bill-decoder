// Input and output guardrails. Pure functions, no I/O. Not implemented yet.

export const MAX_INPUT_CHARS = 20000; // TODO: tune

export const DISCLAIMER =
  "This is general information to help you read your bill. It is not medical, legal, or financial advice.";

/**
 * Check pasted bill text before it reaches the model.
 * TODO: non-empty, length cap, plain text, looks like a bill, injection handling,
 * warn on SSN / full DOB / card numbers.
 * @returns {{ ok: boolean, reason?: string, warnings?: string[] }}
 */
export function validateInput(text) {
  throw new Error("not implemented");
}

/**
 * Check model output against the original input.
 * TODO: schema valid, every flag.quote is a verbatim substring of input,
 * no advice-like phrasing, disclaimer present, "not enough information" where data is missing.
 * @returns {{ ok: boolean, result?: object, problems?: string[] }}
 */
export function validateOutput(result, inputText) {
  throw new Error("not implemented");
}
