# Roundtable

A local three-way conversation between you, Codex, and Claude Code. Runs the installed CLIs under their existing subscription logins; no API SDK or API key is required.

## Setup on another laptop

**Start with [SETUP.md](SETUP.md).** It includes a copy-and-paste prompt for the recipient's Codex and a complete macOS setup procedure.

Give the repository link and setup guide to your Codex. It will inspect the code and your existing CLI installations, set up the app step by step, troubleshoot any failures, and configure startup at login. There is no installer script to run blindly. The repository is public; no invitation is needed.

For manual startup on Windows or macOS, run `npm start` in the repository folder, open **http://localhost:3210**, and leave that terminal running. Requires Node.js 22+, Codex CLI, and Claude Code CLI with your own subscription logins. No `npm install` or API key is needed. Existing Windows automatic startup is unaffected.

## Use

- Choose **New conversation**, enter your project folder, and send a message.
- Sending a message adds it to the shared thread. It never triggers an AI reply automatically.
- **Ask Codex** or **Ask Claude** requests exactly one response to the conversation so far. No new message is necessary between turns.
- **Ask both** requests independent responses to the same frozen conversation snapshot. Neither receives the other's new answer. The replies stream immediately as they arrive in a purple, side-by-side panel in the same thread; future requested turns see both answers.
- The two CLI calls run concurrently, with both prompts prepared before either starts. Independent turns are for discussion and inspection; request a single agent for implementation.
- Messages sent while a response is running are saved for the next requested turn. Response buttons are disabled until the current turn or pair finishes.
- **Stop** terminates the active CLI process tree and cancels any unstarted answer in the pair. It does not undo file edits already made.
- **New conversation** starts a separate conversation. The folder for an existing conversation is fixed so a resumed CLI cannot accidentally use a different project.

These are fresh native agent sessions, not mirrors of conversations already open in your terminals. Each retains its own native session ID and receives new shared messages. Failed or stopped turns reset that agent's session and replay the transcript next time to avoid losing context.

## Files, settings, and login

Both agents run with the selected folder as their working directory and load their normal user/project configuration. They can read saved files and run their normal tools. They do not see unsaved editor buffers or inherit a live terminal's in-memory state. Models and permission settings come from your existing CLI configuration; this app does not create agent instruction or permission files.

The app removes API credential/provider overrides from **child-process environments only**, so it uses subscription authentication rather than an inherited API key. Your environment and CLI configuration are not modified. Logins are checked on launch; use **Recheck logins** after signing in through your terminal. Subscription usage limits still apply. Existing user configuration such as a custom API-key helper can affect authentication; the app does not rewrite that configuration.

The group-chat prompt asks agents to discuss unless implementation is requested. This is conversational guidance, not a separate read-only sandbox. The CLI's configured permissions remain the enforcement boundary. Noninteractive CLI permission denials appear as tool activity/errors; this app does not implement an approval dialog.

## Storage and local access

Transcripts and native session references are saved under `%LOCALAPPDATA%\Roundtable\conversations` on Windows. Existing native CLI session storage remains managed by each CLI. Conversations and relevant project content are sent to the respective model providers through the CLIs, just as in terminal use.

The server binds to `127.0.0.1` only, checks the Host and Origin headers, and requires a per-launch request token for changes. Do not expose it through a network proxy. The browser loads only local assets and renders model output as escaped text with basic bold/code formatting.

Optional environment variables: `PORT` (default 3210), `ROUNDTABLE_PROJECT` (initial folder), `ROUNDTABLE_DATA_DIR` (transcript storage directory).

## Verification

```powershell
npm test
npm run probe
node scripts/live-check.mjs
```

`npm test` uses mocked agents to test routing, continuation, interruption, independent snapshots, failures, and credential isolation. `probe` makes four small live subscription calls to verify login and session memory. `live-check` requires the server running and creates a saved test conversation to verify file access and both directions of shared context. Live checks use subscription allowance.

Both agents stream text and activity. CLI processes stay alive between turns in each conversation (up to four idle workers, released after 30 minutes idle). Evicted workers resume their saved native sessions on the next turn. Deleting a conversation or shutting down closes its workers. The first reply still needs CLI startup; later replies reuse the process. Codex uses the installed CLI app-server protocol, preserving native sessions and configuration. CLI startup and configured hooks/plugins can add latency. Unsupported CLI event changes, expired logins, and usage limits are reported rather than silently falling back to a paid API.

## Context indicators

Each conversation shows a separate last-reported input context count for Codex and Claude, with a percentage when the CLI reports a context-window size. These are not cumulative usage totals or subscription allowance. Cached input is included. Hover over the count for its measurement time. New/older conversations show unavailable until the next response supplies data.

Compaction start/end events update the status and last-compacted time. Counts are cleared during compaction until fresh usage arrives. Claude uses per-message usage plus its main model's reported window; helper-model usage is excluded. Codex uses native thread usage and context-compaction notifications. Only observed compactions are recorded; this does not reconstruct earlier events.
