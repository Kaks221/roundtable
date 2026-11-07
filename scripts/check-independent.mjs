import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3210';
const get = async () => (await fetch(`${base}/api/state`)).json();
const initial = await get();
async function post(route, data) {
  const res = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roundtable-Token': initial.csrf }, body: JSON.stringify(data) });
  const value = await res.json(); assert.ok(res.ok, JSON.stringify(value)); return value;
}
async function idle() {
  for (let i = 0; i < 240; i++) {
    const state = await get(); if (!state.runtime.active) return state;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Response timed out');
}
await post('/api/auth', {});
const room = await post('/api/rooms', { project: process.cwd() });
await post('/api/message', { room: room.id, text: 'Independent replies check. Without tools or file edits, give one short sentence proposing your own name for a group-chat app.' });
let state = await get();
assert.equal(state.runtime.active, null);
assert.equal(state.rooms.find(r => r.id === room.id).messages.length, 1);
console.log('Sending a message triggered no agent. Test room:', room.id);
await post('/api/respond', { room: room.id, target: 'both' });
state = await idle();
let messages = state.rooms.find(r => r.id === room.id).messages;
assert.deepEqual(messages.slice(1).map(m => m.status), ['complete', 'complete']);
assert.equal(messages[1].round, messages[2].round);
const agentStates = state.rooms.find(r => r.id === room.id).agents;
for (const agent of ['codex', 'claude']) {
  assert.ok(agentStates[agent].context.inputTokens > 0, `${agent} context count`);
  assert.ok(agentStates[agent].context.contextWindow > 0, `${agent} context window`);
  console.log(agent, 'context:', agentStates[agent].context);
}
console.log('Independent pair:', messages.slice(1).map(m => ({ speaker: m.speaker, text: m.text })));
await post('/api/respond', { room: room.id, target: 'claude' });
state = await idle(); messages = state.rooms.find(r => r.id === room.id).messages;
assert.equal(messages.length, 4);
assert.equal(messages.at(-1).speaker, 'claude');
assert.equal(messages.at(-1).status, 'complete');
assert.ok(!messages.at(-1).round);
console.log('Manual follow-up, without another human message:', messages.at(-1).text);
