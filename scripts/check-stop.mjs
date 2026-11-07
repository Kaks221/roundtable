import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3210';
const get = async () => (await fetch(`${base}/api/state`)).json();
const state = await get();
const post = async (url, data) => {
  const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Roundtable-Token': state.csrf }, body: JSON.stringify(data) });
  assert.ok(res.ok, await res.text());
};
assert.equal(state.runtime.active, null);
const room = state.rooms.find(r => r.messages.some(m => m.text.includes('Connection and file-access check.')));
assert.ok(room, 'Run live-check first');
await post('/api/message', { room: room.id, target: 'both', text: 'This is a cancellation test. Do not use tools or edit any files. Wait for the next message.' });
await post('/api/respond', { room: room.id, target: 'both' });
assert.ok((await get()).runtime.active);
await post('/api/stop', {});
for (let i = 0; i < 50; i++) {
  const latest = await get();
  if (!latest.runtime.active) {
    assert.equal(latest.runtime.queue.length, 0);
    assert.equal(latest.rooms.find(r => r.id === room.id).messages.at(-1).status, 'stopped');
    console.log('Real CLI cancellation passed'); process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 100));
}
throw new Error('CLI did not stop within five seconds');
