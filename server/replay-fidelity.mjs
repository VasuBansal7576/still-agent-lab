/** Summarize authenticated reconciliation results without changing their verdicts. */
export function summarizeReplayFidelity(comparison) {
  if (!comparison || !Array.isArray(comparison.results)) throw new TypeError('A replay reconciliation is required.');
  const groups = new Map();
  for (const result of comparison.results) {
    if (result.status !== 'disagreed' || result.source !== 'paypal-sandbox') continue;
    const failures = Array.isArray(result.comparisons) ? result.comparisons.filter(step => step.match === false) : [{ provider: result.provider, mock: result.mock }];
    const provider = failures[0]?.provider || {};
    const body = provider.body || provider;
    const http = provider.status;
    const outcome = body.status || body.outcome || null;
    const issue = body.details?.find(detail => typeof detail?.issue === 'string')?.issue || body.issues?.[0] || null;
    // Classify the first differing step only, so each trial appears once. This is
    // a description of observed responses, not an explanation of their cause.
    const label = outcome === 'PENDING' ? 'Provider returned a pending refund' : Number.isInteger(http) && http >= 400 && http < 500 ? `Provider rejected the refund${issue ? ` (${issue})` : ''}` : 'Other response differed';
    let group = groups.get(label);
    if (!group) {
      group = { label, count: 0, example: { personaId: result.personaId, trial: result.trial, mock: failures[0]?.mock, provider: { http: http ?? null, outcome, issue } } };
      groups.set(label, group);
    }
    group.count++;
  }
  const reasons = new Map();
  for (const result of comparison.results) {
    if (result.status !== 'unverified') continue;
    const reason = result.reason || 'No verified comparison.';
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  return {
    source: 'authenticated-sandbox-replay-comparisons',
    compared: comparison.compared,
    agreed: comparison.agreed,
    disagreed: comparison.disagreed,
    unverified: comparison.unverified,
    agreement: comparison.agreement,
    disagreementGroups: [...groups.values()].sort((a, b) => b.count - a.count),
    unverifiedReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    note: 'Each disagreement is grouped by its first differing response. Pending is not completed. These sandbox observations are not real-world rates; selection, timing and funding can affect responses.',
  };
}
