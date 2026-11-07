import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeInputUsage, codexContextEvent, updateContext } from '../lib/context.mjs';
test('Claude input includes both caches, excludes output', () => {
  assert.equal(claudeInputUsage({ input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens: 500 }), 132);
  assert.equal(claudeInputUsage(null), null);
});
test('Codex context uses last input not cumulative total or double-counted cache', () => {
  const event = codexContextEvent('thread/tokenUsage/updated', { tokenUsage: { last: { inputTokens: 120, cachedInputTokens: 100, outputTokens: 10 }, total: { inputTokens: 999999 }, modelContextWindow: 1000 } });
  assert.equal(event.inputTokens, 120); assert.equal(event.contextWindow, 1000);
});
test('compaction invalidates stale counts and records completion until fresh usage', () => {
  let c = updateContext({}, { type: 'usage', inputTokens: 900, contextWindow: 1000 });
  c = updateContext(c, codexContextEvent('item/started', { item: { type: 'contextCompaction' } }));
  assert.equal(c.inputTokens, null); assert.equal(c.compacting, true);
  c = updateContext(c, codexContextEvent('item/completed', { item: { type: 'contextCompaction' } }), 'now');
  assert.equal(c.lastCompactedAt, 'now'); assert.equal(c.compacting, false);
  c = updateContext(c, { type: 'usage', inputTokens: 100 });
  assert.equal(c.inputTokens, 100); assert.equal(c.contextWindow, 1000);
});
test('a model change never reuses the previous model context window', () => {
  const c = updateContext({ model: 'old', contextWindow: 1000 }, { type: 'usage', model: 'new', inputTokens: 200 });
  assert.equal(c.contextWindow, null);
});
