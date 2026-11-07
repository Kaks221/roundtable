import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { WorkerPool } from '../lib/worker.mjs';
import { CodexWorker } from '../lib/codex-server.mjs';
import { ClaudeWorker } from '../lib/claude-worker.mjs';
import { stopProcess } from '../lib/agents.mjs';

function pool(limit = 4) {
  return new WorkerPool(options => new (options.agent === 'codex' ? CodexWorker : ClaudeWorker)({
    ...options, bin: { command: process.execPath, prefix: [fileURLToPath(new URL('./fake-cli.mjs', import.meta.url)), options.agent] },
    env: process.env, stopProcess,
  }), limit);
}
for (const agent of ['codex', 'claude']) {
  test(`${agent}: streams before completion, reuses process, isolates sessions, resumes after release`, async () => {
    const p = pool();
    try {
      let streamed = false, finished = false;
      const options = { agent, cwd: process.cwd(), prompt: 'first' };
      const a = await p.run({ ...options, onEvent: e => { if (e.type === 'text') { assert.equal(finished, false); streamed = true; } } });
      finished = true; assert.ok(streamed);
      const b = await p.run({ ...options, session: a.session, prompt: 'second' });
      assert.equal(JSON.parse(a.text).pid, JSON.parse(b.text).pid);
      assert.equal(JSON.parse(b.text).count, 2);
      assert.equal(JSON.parse(b.text).prompt, 'second');
      const other = await p.run({ ...options, prompt: 'separate' });
      assert.notEqual(other.session, a.session);
      assert.notEqual(JSON.parse(other.text).pid, JSON.parse(a.text).pid);
      await p.close([a.session]);
      const resumed = await p.run({ ...options, session: a.session });
      assert.equal(resumed.session, a.session);
      assert.notEqual(JSON.parse(resumed.text).pid, JSON.parse(a.text).pid);
    } finally { await p.close(); }
  });
  test(`${agent}: cancellation and crashes retire the worker and allow recovery`, async () => {
    const p = pool();
    try {
      const options = { agent, cwd: process.cwd(), prompt: 'first' };
      const first = await p.run(options);
      const controller = new AbortController();
      const pending = p.run({ ...options, session: first.session, prompt: 'hold', signal: controller.signal });
      const rejected = assert.rejects(pending, /Stopped/);
      controller.abort(); await rejected;
      assert.equal(p.workers.size, 0);
      await assert.rejects(p.run({ ...options, prompt: 'crash' }), /CLI exited/);
      const next = await p.run(options); assert.ok(next.text);
    } finally { await p.close(); }
  });
}
test('idle process pool stays bounded without stopping an active worker', async () => {
  const p = pool(1);
  try {
    const options = { agent: 'claude', cwd: process.cwd(), prompt: 'hello' };
    const a = await p.run(options);
    const controller = new AbortController();
    const active = p.run({ ...options, session: a.session, prompt: 'hold', signal: controller.signal });
    const rejected = assert.rejects(active, /Stopped/);
    await p.run({ ...options, agent: 'codex' });
    await p.run(options);
    assert.equal(p.workers.size, 2);
    assert.ok([...p.workers].some(w => w.session === a.session && w.active));
    controller.abort(); await rejected;
  } finally { await p.close(); }
});
