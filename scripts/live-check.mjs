import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3210';
const state = await (await fetch(`${base}/api/state`)).json();
async function post(url, body) {
  const response = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roundtable-Token': state.csrf }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result)); return result;
}
async function waitForIdle() {
  for (let i = 0; i < 240; i++) {
    const s = await (await fetch(`${base}/api/state`)).json();
    if (!s.runtime.active && !s.runtime.queue.length) return s;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for agents');
}
assert.ok(state.auth.codex.ok && state.auth.claude.ok, 'Both subscriptions connected');
const blocked = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{}' });
assert.equal(blocked.status, 403);
const missingToken = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(missingToken.status, 403);
console.log('Local API origin/token checks passed');
const room = await post('/api/rooms', { project: process.cwd() });
console.log('Test conversation:', room.id);
await post('/api/message', { room: room.id, target: 'both', text: 'Connection and file-access check. Do not edit anything. Codex: read package.json from this project and report its name in one sentence. Include the exact word cobalt in your response. Claude: read the same file, report the package name, and quote the test word from Codex\'s actual response. Keep your replies short.' });
await post('/api/respond', { room: room.id, target: 'codex' });
await waitForIdle();
await post('/api/respond', { room: room.id, target: 'claude' });
let done = await waitForIdle();
let messages = done.rooms.find(r => r.id === room.id).messages;
for (const agent of ['codex', 'claude']) {
  const reply = messages.find(m => m.speaker === agent);
  console.log(agent, reply);
  assert.equal(reply.status, 'complete');
  assert.match(reply.text, /roundtable-local/);
  assert.match(reply.text, /cobalt/i);
}
await post('/api/message', { room: room.id, target: 'codex', text: 'Without using tools, what did Claude just report? One sentence.' });
await post('/api/respond', { room: room.id, target: 'codex' });
done = await waitForIdle();
messages = done.rooms.find(r => r.id === room.id).messages;
assert.equal(messages.at(-1).status, 'complete');
assert.match(messages.at(-1).text, /roundtable-local|cobalt/i);
console.log('Resumed Codex sees Claude:', messages.at(-1).text);
console.log('LIVE HANDOFF AND FILE ACCESS PASSED');
