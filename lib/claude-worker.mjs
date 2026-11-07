import { randomUUID } from 'node:crypto';
import { Worker } from './worker.mjs';
import { claudeInputUsage } from './context.mjs';

export class ClaudeWorker extends Worker {
  constructor(options) {
    const session = options.session || randomUUID();
    super({ ...options, session, args: ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', ...(options.session ? ['--resume', session] : ['--session-id', session])] });
  }
  start(prompt) {
    this.blocks = []; this.streamed = ''; this.text = ''; this.mainModel = null; this.lastInput = null;
    this.emit({ type: 'session', session: this.session });
    this.send({ type: 'user', session_id: this.session, message: { role: 'user', content: prompt }, parent_tool_use_id: null });
  }
  receive(event) {
    if (!this.active || this.dead) return;
    if (event.type === 'control_request') {
      void this.dispose(new Error('Claude requires interaction. Complete this action in the CLI.')); return;
    }
    if (event.type === 'system' && event.subtype === 'status' && event.status === 'compacting') this.emit({ type: 'compaction', phase: 'started' });
    if (event.type === 'system' && event.subtype === 'compact_boundary') { this.lastInput = null; this.emit({ type: 'compaction', phase: 'completed' }); }
    if (event.session_id && event.session_id !== this.session) throw new Error('Claude returned an unexpected session');
    if (event.type === 'stream_event') {
      const part = event.event;
      if (part?.type === 'message_start') this.streamed = '';
      if (part?.type === 'content_block_delta' && part.delta?.type === 'text_delta') {
        this.streamed += part.delta.text;
        this.emit({ type: 'text', text: [...this.blocks, this.streamed].filter(Boolean).join('\n\n') });
      }
      if (part?.type === 'content_block_start' && part.content_block?.type === 'tool_use') this.emit({ type: 'activity', text: part.content_block.name });
    }
    if (event.type === 'assistant') {
      this.mainModel = event.message?.model || this.mainModel;
      const input = claudeInputUsage(event.message?.usage);
      if (input !== null) { this.lastInput = input; this.emit({ type: 'usage', inputTokens: input, model: this.mainModel }); }
      const block = (event.message?.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
      if (block) { this.blocks.push(block); this.text = this.blocks.join('\n\n'); this.streamed = ''; this.emit({ type: 'text', text: this.text }); }
      for (const block of event.message?.content || []) if (block.type === 'tool_use') this.emit({ type: 'activity', text: block.name });
    }
    if (event.type === 'result') {
      const usage = event.modelUsage?.[this.mainModel];
      if (usage) this.emit({ type: 'usage', inputTokens: this.lastInput, contextWindow: usage.contextWindow, model: this.mainModel });
      if (event.is_error) { void this.dispose(new Error(event.result || event.errors?.join('\n') || 'Claude turn failed')); return; }
      if (event.result && !this.text) { this.text = event.result; this.emit({ type: 'text', text: this.text }); }
      if (event.permission_denials?.length) this.emit({ type: 'activity', text: 'Some tools were denied by your Claude permission settings.' });
      this.finish(null, this.text);
    }
  }
}
