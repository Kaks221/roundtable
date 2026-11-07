import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { CodexWorker } from './codex-server.mjs';
import { ClaudeWorker } from './claude-worker.mjs';
import { WorkerPool } from './worker.mjs';

export function subscriptionEnv(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|CODEX_API_KEY|CLAUDECODE|CLAUDE_CODE_USE_.*)$/.test(key)) delete env[key];
  }
  return env;
}

export function executable(agent) {
  if (agent === 'claude') {
    const local = path.join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
    return { command: existsSync(local) ? local : 'claude', prefix: [] };
  }
  const script = path.join(process.env.APPDATA || path.join(homedir(), '.local', 'lib'), 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (existsSync(script)) return { command: process.execPath, prefix: [script] };
  return { command: 'codex', prefix: [] };
}

export function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve();
  if (process.platform === 'win32') return new Promise(resolve => {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', resolve); killer.on('close', resolve);
  });
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  return Promise.resolve();
}

const pool = new WorkerPool(options => {
  const WorkerType = options.agent === 'codex' ? CodexWorker : ClaudeWorker;
  return new WorkerType({ ...options, bin: executable(options.agent), env: subscriptionEnv(), stopProcess });
});
export function runAgent(options) { return pool.run(options); }
export function closeAgents(sessions) { return pool.close(sessions); }

export async function authStatus(agent) {
  const bin = executable(agent);
  return new Promise(resolve => {
    const child = spawn(bin.command, [...bin.prefix, ...(agent === 'codex' ? ['login', 'status'] : ['auth', 'status'])], {
      env: subscriptionEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { void stopProcess(child); resolve({ ok: false, detail: 'Login check timed out' }); }, 15000);
    child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x);
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, detail: error.message }); });
    child.on('close', code => {
      clearTimeout(timer);
      if (agent === 'claude') {
        try { const s = JSON.parse(output); return resolve({ ok: code === 0 && s.loggedIn && s.authMethod === 'claude.ai', detail: s.loggedIn ? `${s.subscriptionType || 'Claude'} subscription login` : 'Run claude auth login in your terminal' }); } catch {}
      }
      const ok = code === 0 && /ChatGPT/i.test(output);
      resolve({ ok, detail: ok ? 'ChatGPT login' : `Run ${agent} login in your terminal` });
    });
  });
}
