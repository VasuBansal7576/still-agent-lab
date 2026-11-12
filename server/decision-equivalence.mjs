// Decision IDs are scoped to a session. Compare reuse patterns across sessions.
export function normalizeDecisionIds(calls, field) {
  const ids = new Map();
  return calls.map(call => {
    if (!call || !Object.hasOwn(call, field)) return call;
    const id = call[field];
    if (!ids.has(id)) ids.set(id, ids.size + 1);
    return { ...call, [field]: ids.get(id) };
  });
}
