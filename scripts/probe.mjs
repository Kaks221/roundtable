import { runAgent, authStatus, closeAgents } from '../lib/agents.mjs';
const cwd = process.cwd();
const sessions = {};
try {
for (const agent of ['codex', 'claude']) {
  console.log(agent, await authStatus(agent));
  const result = await runAgent({ agent, cwd, prompt: 'This is a connection test. Do not use tools or edit files. Remember the test word cobalt. Reply with exactly: Connection ready.', onEvent: e => { if (e.type === 'activity') console.log(agent, e.text); } });
  sessions[agent] = result.session;
  console.log(agent, result);
}
for (const agent of ['codex', 'claude']) {
  const result = await runAgent({ agent, cwd, session: sessions[agent], prompt: 'Without using tools, what test word did I ask you to remember? Reply with only that word.' });
  if (!/cobalt/i.test(result.text)) throw new Error(`${agent} session continuity failed: ${result.text}`);
  console.log(agent, 'continuity verified:', result.text);
}

} finally { await closeAgents(); }
