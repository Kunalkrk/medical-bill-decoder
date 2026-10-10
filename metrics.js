// In-memory metrics. No persistence: everything resets on restart. Stores counters only.

const startedAt = Date.now();
const m = {
  requests: 0,
  errors: 0,
  rejectedAsNonBill: 0,
  injectionDetected: 0,
  modelCalls: 0, // requests that reached the model (token averages use these)
  latencyMsTotal: 0,
  inputTokensTotal: 0,
  outputTokensTotal: 0,
  flagsReturned: 0,
  flagsDropped: 0,
};

const ratio = (a, b) => (b === 0 ? 0 : a / b);
const round = (n, places = 3) => Number(n.toFixed(places));

/** Record one /api/analyze call from its metadata log entry. */
export function recordRequest(entry) {
  m.requests++;
  m.latencyMsTotal += entry.latencyMs;
  if (entry.error) m.errors++;
  if (entry.rejectedAsNonBill) m.rejectedAsNonBill++;
  if (entry.injectionDetected) m.injectionDetected++;
  if (entry.inputTokens > 0 || entry.outputTokens > 0) {
    m.modelCalls++;
    m.inputTokensTotal += entry.inputTokens;
    m.outputTokensTotal += entry.outputTokens;
  }
  m.flagsReturned += entry.flagCount;
  m.flagsDropped += entry.flagsDropped;
}

export function getMetrics() {
  return {
    since: new Date(startedAt).toISOString(),
    requests: m.requests,
    errors: m.errors,
    rejectedAsNonBill: m.rejectedAsNonBill,
    injectionDetected: m.injectionDetected,
    avgLatencyMs: round(ratio(m.latencyMsTotal, m.requests), 1),
    avgInputTokens: round(ratio(m.inputTokensTotal, m.modelCalls), 1),
    avgOutputTokens: round(ratio(m.outputTokensTotal, m.modelCalls), 1),
    flagDropRate: round(ratio(m.flagsDropped, m.flagsDropped + m.flagsReturned)), // dropped / (kept + dropped)
    rejectionRate: round(ratio(m.rejectedAsNonBill, m.requests)),
    errorRate: round(ratio(m.errors, m.requests)),
  };
}
