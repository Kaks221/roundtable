import test from 'node:test';
import assert from 'node:assert/strict';
import { Coordinator, createRoom, buildPrompt } from '../lib/rooms.mjs';
import { subscriptionEnv } from '../lib/agents.mjs';

function harness(runner) {
  const room = createRoom(process.cwd());
  const store = { rooms: new Map([[room.id, room]]), save() {} };
  const coordinator = new Coordinator(store, () => {}, runner);
  return { room, coordinator };
}
test('subscription processes exclude inherited API credentials without changing parent environment', () => {
  const original = { PATH: 'path', ANTHROPIC_API_KEY: 'secret', OPENAI_API_KEY: 'secret', CLAUDECODE: '1', CLAUDE_CODE_USE_BEDROCK: '1', USERPROFILE: 'home' };
  assert.deepEqual(subscriptionEnv(original), { PATH: 'path', USERPROFILE: 'home' });
  assert.equal(original.ANTHROPIC_API_KEY, 'secret');
});
test('posting a human message never calls either agent', () => {
  const { room, coordinator } = harness(() => { throw new Error('Must not run'); });
  coordinator.submit(room, 'Hello');
  assert.equal(room.messages.length, 1);
  assert.equal(coordinator.active, null);
});
test('manual buttons give exactly one turn and share the preceding answer', async () => {
  const calls = [];
  const { room, coordinator } = harness(async request => {
    calls.push(request); return { session: `${request.agent}-session`, text: `${request.agent} contribution` };
  });
  coordinator.submit(room, 'Plan the project');
  await coordinator.respond(room, 'claude');
  assert.equal(calls.length, 1);
  await coordinator.respond(room, 'codex');
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /claude contribution/);
  await coordinator.respond(room, 'claude');
  assert.equal(calls[2].session, 'claude-session');
  assert.match(calls[2].prompt, /codex contribution/);
});
test('independent pair uses a frozen transcript and shares answers on subsequent turns', async () => {
  const calls = [];
  const { room, coordinator } = harness(async request => {
    calls.push(request); return { session: `${request.agent}-session`, text: `${request.agent} secret-answer` };
  });
  coordinator.submit(room, 'Independent question');
  await coordinator.respond(room, 'both');
  assert.equal(calls.length, 2);
  for (const call of calls) { assert.match(call.prompt, /Independent question/); assert.doesNotMatch(call.prompt, /secret-answer/); }
  assert.ok(room.messages[1].round);
  assert.equal(room.messages[1].round, room.messages[2].round);
  await coordinator.respond(room, 'codex');
  assert.match(calls[2].prompt, /claude secret-answer/);
  await coordinator.respond(room, 'claude');
  assert.match(calls[3].prompt, /codex secret-answer/);
});
test('mid-round human input is saved but reaches both agents only on later requested turns', async () => {
  let release;
  const calls = [];
  const { room, coordinator } = harness(async request => {
    calls.push(request);
    if (calls.length === 1) await new Promise(resolve => release = resolve);
    return { session: request.agent, text: 'Answer' };
  });
  coordinator.submit(room, 'Original snapshot');
  const running = coordinator.respond(room, 'both');
  coordinator.submit(room, 'New steering message');
  assert.throws(() => coordinator.respond(room, 'codex'), /Wait/);
  release(); await running;
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1].prompt, /New steering message/);
  await coordinator.respond(room, 'codex');
  assert.match(calls[2].prompt, /New steering message/);
  await coordinator.respond(room, 'claude');
  assert.match(calls[3].prompt, /New steering message/);
});
test('independent agents start concurrently and stop aborts both', async () => {
  let count = 0;
  const { room, coordinator } = harness(request => {
    count++; return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('Stopped'))));
  });
  coordinator.submit(room, 'Start');
  const running = coordinator.respond(room, 'both');
  assert.equal(count, 2);
  coordinator.stop(); await running;
  assert.deepEqual(room.messages.slice(1).map(m => m.status), ['stopped', 'stopped']);
  assert.deepEqual(room.agents.codex, { session: null, cursor: 0 });
  assert.equal(coordinator.active, null);
});
test('context events persist separately for each agent after a parallel round', async () => {
  const { room, coordinator } = harness(async request => {
    request.onEvent({ type: 'compaction', phase: 'started' });
    request.onEvent({ type: 'compaction', phase: 'completed' });
    request.onEvent({ type: 'usage', inputTokens: request.agent === 'codex' ? 120 : 340, contextWindow: 1000 });
    return { session: request.agent, text: 'Done' };
  });
  coordinator.submit(room, 'Test'); await coordinator.respond(room, 'both');
  assert.equal(room.agents.codex.context.inputTokens, 120);
  assert.equal(room.agents.claude.context.inputTokens, 340);
  assert.equal(room.agents.codex.context.compactionCount, 1);
  assert.equal(room.agents.claude.context.compacting, false);
});
test('one failed independent answer does not discard the other', async () => {
  const { room, coordinator } = harness(async request => {
    if (request.agent === 'codex') throw new Error('Usage limit reached');
    return { session: 'claude', text: 'My answer' };
  });
  coordinator.submit(room, 'Start'); await coordinator.respond(room, 'both');
  assert.equal(room.messages[1].status, 'error');
  assert.equal(room.messages[2].status, 'complete');
  assert.equal(room.messages[2].text, 'My answer');
});
test('empty conversations and invalid recipients do not start agents', () => {
  const { room, coordinator } = harness(() => { throw new Error('Must not run'); });
  assert.throws(() => coordinator.respond(room, 'claude'), /Add a message/);
  assert.throws(() => coordinator.respond(room, 'unknown'), /Invalid/);
});
