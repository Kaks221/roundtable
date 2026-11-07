import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const agent = process.argv[2];
let session, count = 0;
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
const option = name => process.argv[process.argv.indexOf(name) + 1];
createInterface({ input: process.stdin }).on('line', line => {
  const value = JSON.parse(line);
  if (agent === 'codex' && value.method !== 'turn/start') {
    if (value.method === 'initialize') output({ id: value.id, result: {} });
    if (value.method === 'thread/start' || value.method === 'thread/resume') {
      session = value.params.threadId || randomUUID();
      output({ id: value.id, result: { thread: { id: session } } });
    }
    return;
  }
  session ||= process.argv.includes('--resume') ? option('--resume') : option('--session-id');
  const prompt = agent === 'codex' ? value.params.input[0].text : value.message.content;
  if (agent === 'codex') output({ id: value.id, result: { turn: { id: 'turn' } } });
  if (prompt === 'crash') process.exit(3);
  if (prompt === 'hold') return;
  const text = JSON.stringify({ pid: process.pid, count: ++count, prompt, session });
  if (agent === 'codex') output({ method: 'item/agentMessage/delta', params: { threadId: session, itemId: String(count), delta: text } });
  else output({ type: 'stream_event', session_id: session, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  setTimeout(() => {
    if (agent === 'codex') output({ method: 'turn/completed', params: { threadId: session, turn: { status: 'completed' } } });
    else output({ type: 'result', session_id: session, result: text, is_error: false });
  }, 25);
});
