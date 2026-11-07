import { Worker } from './worker.mjs';
import { codexContextEvent } from './context.mjs';

export class CodexWorker extends Worker {
  constructor(options) {
    super({ ...options, args: ['app-server', '--stdio'] });
    this.cwd = options.cwd; this.nextId = 1; this.requests = new Map(); this.initialized = false;
  }
  rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error(`Codex ${method} timed out`)); }, 60000);
      this.requests.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.requests.delete(id); reject(error); }
    });
  }
  onDispose(error) {
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.requests.clear();
  }
  async start(prompt) {
    this.messages = new Map(); this.failure = '';
    if (!this.initialized) {
      await this.rpc('initialize', { clientInfo: { name: 'roundtable', title: 'Roundtable', version: '1.0.0' }, capabilities: null });
      this.send({ method: 'initialized', params: {} });
      const result = await this.rpc(this.session ? 'thread/resume' : 'thread/start', this.session ? { threadId: this.session, cwd: this.cwd } : { cwd: this.cwd });
      this.session = result.thread.id; this.initialized = true;
    }
    this.emit({ type: 'session', session: this.session });
    await this.rpc('turn/start', { threadId: this.session, input: [{ type: 'text', text: prompt, text_elements: [] }] });
  }
  text() { return [...this.messages.values()].join('\n\n'); }
  receive(event) {
    if (event.id !== undefined && !event.method) {
      const pending = this.requests.get(event.id); if (!pending) return;
      clearTimeout(pending.timer); this.requests.delete(event.id);
      if (event.error) pending.reject(new Error(event.error.message)); else pending.resolve(event.result);
      return;
    }
    if (event.id !== undefined && event.method) {
      const error = new Error(`Codex requires interaction (${event.method}). Complete this action in the CLI.`);
      this.send({ id: event.id, error: { code: -32601, message: error.message } });
      void this.dispose(error); return;
    }
    if (!this.active || this.dead) return;
    const p = event.params || {};
    if (p.threadId && this.session && p.threadId !== this.session) return;
    const context = codexContextEvent(event.method, p); if (context) this.emit(context);
    if (event.method === 'item/agentMessage/delta') {
      this.messages.set(p.itemId, (this.messages.get(p.itemId) || '') + p.delta);
      this.emit({ type: 'text', text: this.text() });
    }
    if (event.method === 'item/completed' && p.item?.type === 'agentMessage') {
      this.messages.set(p.item.id, p.item.text); this.emit({ type: 'text', text: this.text() });
    }
    if (event.method === 'item/started' && p.item && !['agentMessage', 'contextCompaction'].includes(p.item.type)) this.emit({ type: 'activity', text: p.item.type });
    if (event.method === 'error' && !p.willRetry) this.failure = p.error?.message || 'Codex turn failed';
    if (event.method === 'turn/completed') {
      if (p.turn?.status !== 'completed' || this.failure) void this.dispose(new Error(p.turn?.error?.message || this.failure || `Codex turn ${p.turn?.status}`));
      else this.finish(null, this.text());
    }
  }
}
