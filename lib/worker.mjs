import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// A transport belongs to one native conversation. Turn completion leaves stdin open.
export class Worker {
  constructor({ bin, args, env, cwd, session, stopProcess }) {
    this.session = session; this.dead = false; this.active = null;
    this.stopProcess = stopProcess; this.stderr = '';
    this.child = spawn(bin.command, [...bin.prefix, ...args], {
      cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.closed = new Promise(resolve => this.child.once('close', resolve));
    this.child.on('error', error => { void this.dispose(error); });
    this.child.stdin.on('error', error => { void this.dispose(error); });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-6000); });
    this.child.on('close', code => { void this.dispose(new Error(`CLI exited ${code}: ${this.stderr || 'Connection closed'}`)); });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      try { this.receive(event); } catch (error) { void this.dispose(error); }
    });
  }
  send(value) {
    if (this.dead) throw new Error('CLI connection closed');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  emit(event) { if (!this.active?.signal?.aborted) this.active?.onEvent(event); }
  run({ prompt, signal, onEvent = () => {} }) {
    if (this.dead) return Promise.reject(new Error('CLI connection closed'));
    if (this.active) return Promise.reject(new Error('CLI already has an active turn'));
    return new Promise((resolve, reject) => {
      const abort = () => { void this.dispose(new Error('Stopped')); };
      this.active = { resolve, reject, signal, onEvent, abort };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      Promise.resolve().then(() => this.start(prompt)).catch(error => { void this.dispose(error); });
    });
  }
  finish(error, text = '') {
    const turn = this.active; if (!turn) return;
    this.active = null; turn.signal?.removeEventListener('abort', turn.abort);
    if (error) turn.reject(error); else turn.resolve({ session: this.session, text });
  }
  dispose(error = new Error('CLI connection closed')) {
    if (this.disposal) return this.disposal;
    this.dead = true;
    // Do not allow a replacement turn to edit files until termination completes.
    this.disposal = (async () => {
      this.onDispose?.(error);
      await this.stopProcess(this.child);
      await this.closed;
      this.finish(error);
    })();
    return this.disposal;
  }
}

export class WorkerPool {
  constructor(create, maxIdle = 4) { this.create = create; this.maxIdle = maxIdle; this.workers = new Set(); }
  async run(options) {
    let worker = options.session && [...this.workers].find(w => !w.dead && w.session === options.session && w.cwd === options.cwd && w.agent === options.agent);
    if (!worker) {
      worker = this.create(options); worker.cwd = options.cwd; worker.agent = options.agent;
      this.workers.add(worker);
    }
    clearTimeout(worker.idleTimer);
    try { return await worker.run(options); }
    finally {
      if (worker.dead) this.workers.delete(worker);
      else {
        this.workers.delete(worker); this.workers.add(worker);
        worker.idleTimer = setTimeout(() => { void this.remove(worker); }, 30 * 60 * 1000);
        worker.idleTimer.unref();
      }
      const idle = [...this.workers].filter(w => !w.active);
      while (idle.length > this.maxIdle) await this.remove(idle.shift());
    }
  }
  async remove(worker) { this.workers.delete(worker); clearTimeout(worker.idleTimer); await worker.dispose(); }
  async close(sessions) {
    await Promise.all([...this.workers].filter(w => !sessions || sessions.includes(w.session)).map(w => this.remove(w)));
  }
}
