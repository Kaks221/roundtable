export function claudeInputUsage(usage) {
  if (!usage || !Number.isFinite(usage.input_tokens)) return null;
  return usage.input_tokens + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
}

export function updateContext(previous = {}, event, now = new Date().toISOString()) {
  const next = { ...previous };
  if (event.type === 'usage') {
    if (event.model && next.model && event.model !== next.model) next.contextWindow = null;
    if (Number.isFinite(event.inputTokens)) { next.inputTokens = event.inputTokens; next.measuredAt = now; }
    if (Number.isFinite(event.contextWindow) && event.contextWindow > 0) next.contextWindow = event.contextWindow;
    if (event.model) next.model = event.model;
  }
  if (event.type === 'compaction') {
    next.compacting = event.phase === 'started';
    if (event.phase === 'started') next.inputTokens = null;
    if (event.phase === 'completed') {
      next.lastCompactedAt = now;
      next.compactionCount = (next.compactionCount || 0) + 1;
      next.inputTokens = null;
    }
  }
  return next;
}

export function codexContextEvent(method, params) {
  if (method === 'thread/tokenUsage/updated') return { type: 'usage', inputTokens: params.tokenUsage?.last?.inputTokens, contextWindow: params.tokenUsage?.modelContextWindow };
  if (params.item?.type === 'contextCompaction' && ['item/started', 'item/completed'].includes(method)) return { type: 'compaction', phase: method === 'item/started' ? 'started' : 'completed' };
  return null;
}
