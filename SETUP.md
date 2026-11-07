# Set up Roundtable on a Mac

## Give your Codex this request

> Help me set up https://github.com/Kaks221/roundtable on this Mac. Read SETUP.md, inspect the source and my existing environment before running anything, then set it up step by step. Reuse my existing Codex and Claude Code installations and subscription logins. Configure startup at login after the app works. Troubleshoot failures rather than blindly continuing. Do not change my models, permissions, or other apps. Explain anything that needs my input.

You do not need to run an installer. Your Codex should inspect, adapt, execute, and verify the setup with you. It can handle ordinary commands; you may need to complete GitHub access, CLI sign-in, or a macOS permission prompt yourself.

The repository is public; no invitation or GitHub login is required to download it. If cloning is inconvenient, download its ZIP, extract it into a permanent folder, and open that folder in VS Code. Never run the app from inside the ZIP or a temporary download extraction.

## Instructions for the recipient's Codex

### 1. Inspect before executing

Read `README.md`, `package.json`, `server.mjs`, and the files in `lib/`, particularly `agents.mjs`, `worker.mjs`, `codex-server.mjs`, `claude-worker.mjs`, and `recycle.mjs`. Inspect verification scripts before running them. Explain the setup briefly to the user and surface any concrete concern before acting on it.

This is a local Node server and browser interface for the installed Codex and Claude Code CLIs. It binds only to localhost, uses the user's own CLI logins, and stores conversations outside the repository. There are no npm dependencies to install. It is not a hosted service and requires no API key. Agents can use their normal file tools under the user's existing permissions. Never copy the author's credentials, conversations, Windows paths, or permission settings.

### 2. Inspect this Mac and reuse what works

- Identify macOS version, CPU architecture, existing checkout, and the user's preferred permanent location. If none is specified, use `~/Applications/roundtable`. Inspect any existing destination before cloning; do not overwrite it.
- Clone with `git clone https://github.com/Kaks221/roundtable.git ~/Applications/roundtable`, or use the downloaded checkout. GitHub CLI and GitHub authentication are not required.
- Check `node --version`, `command -v node`, `codex --version`, `command -v codex`, `claude --version`, and `command -v claude` in the working VS Code terminal. Node must be 22 or newer. Record `node -p process.execPath` and the current PATH for background startup later.
- Check `codex login status` and `claude auth status`. Reuse existing ChatGPT and Claude subscription authentication. If necessary, let the human complete `codex login` or `claude auth login` interactively. Never copy tokens into files.
- If a prerequisite is missing, consult its current official installation instructions and install only what is missing. Preserve the user's Node manager and working CLI installations. Do not silently switch models, enable full access, alter global agent instructions, or create project-specific permission files.

### 3. Prove the app works manually

From the checkout, run `npm test`, then start `npm start` in a terminal or controlled process. Open `http://localhost:3210`. Check `/api/state` for both `auth.codex.ok` and `auth.claude.ok`; do not print or share its conversation contents or request token unnecessarily.

If port 3210 is busy, identify the owner first. Reuse an existing Roundtable instance or stop only the instance you started. Do not kill an unrelated service. If a different port is necessary, use `PORT` consistently in the server, startup configuration, URL, and verification; existing live-check scripts assume 3210.

After inspecting `scripts/probe.mjs`, run `npm run probe`. It makes four short real subscription requests, verifies both agents retain native session memory, and closes its processes. It consumes a little subscription allowance but creates no app conversation. If it fails, inspect the concrete error and fix it; successful login alone is not an end-to-end pass.

Confirm the browser can create a conversation with the desired project folder and display streamed replies. The default project is the parent of the checkout, but each new conversation can select a different folder. If testing the app with a temporary conversation, identify it clearly and do not change the user's existing conversations.

### 4. Configure startup for this Mac

Only after manual operation works, create a **user-level LaunchAgent**, adapting it to the actual paths you observed. Do this transparently through ordinary file edits and macOS commands, not a downloaded setup script. Do not use sudo or install a system-wide daemon.

Use `~/Library/LaunchAgents/local.roundtable.server.plist`. Inspect an existing file and service before replacing anything. The plist needs these fields:

| Key | Value |
| --- | --- |
| `Label` | `local.roundtable.server` |
| `ProgramArguments` | An array containing the absolute Node executable and the absolute `server.mjs` path, as separate strings |
| `WorkingDirectory` | Absolute checkout directory |
| `EnvironmentVariables` | `PATH` from the working terminal, including the Node/CLI bin directories; `PORT` set to `3210` (or the chosen port) |
| `RunAtLoad` | `true` |
| `KeepAlive` | `true` |
| `ThrottleInterval` | Integer `10` |
| `StandardOutPath` | `~/Library/Logs/Roundtable/server.log`, expanded to an absolute path |
| `StandardErrorPath` | `~/Library/Logs/Roundtable/error.log`, expanded to an absolute path |

Create the log directory first. Expand `~` and shell variables yourself: launchd does not expand them. Use a proper plist writer or correctly escape XML. Do not embed API keys or credentials. Capturing PATH matters because launchd does not load the interactive shell's nvm/Homebrew setup. `agents.mjs` finds the normal Claude native installation or falls back to PATH; on Mac, Codex is resolved through PATH.

Validate with `plutil -lint` before loading. Stop the manually started server once no reply is running, then load the agent using `launchctl bootstrap gui/$(id -u) <absolute-plist-path>`. If updating an already registered Roundtable agent, unload that specific service first with `launchctl bootout gui/$(id -u)/local.roundtable.server`. Never unload another service.

Check `launchctl print gui/$(id -u)/local.roundtable.server`, inspect the logs, and verify the browser and both auth checks again. Confirm it runs independently of the original terminal. Keep the checkout in place; moving it or replacing a version-specific Node path requires updating the plist. Starting the server at login does not need to open a browser window automatically.

### 5. Report the actual result

Give the user the URL, installed location, startup status, and verification outcome. Distinguish completed checks from anything pending. If an interactive login or macOS consent is required, explain the exact action and continue after the user completes it. Do not claim success merely because files were created.

The macOS Trash integration was developed on Windows and has not been tested on a real Mac by the author. Verify it on this Mac using only a disposable test conversation: deletion should move its JSON transcript to Trash, not permanently erase it. Finder automation may request macOS consent. If consent is denied, report the failure and leave the original intact. Fix platform incompatibilities if found and rerun the affected checks.

## Locations and troubleshooting

- Mac app conversations: `~/.local/share/Roundtable/conversations`. Native CLI sessions stay in each CLI's own storage. Deleting an app conversation does not delete native CLI history.
- Logs: `~/Library/Logs/Roundtable/server.log` and `error.log`.
- A CLI that works in the terminal but not at login usually needs its actual executable directory in the service PATH. Compare environments before reinstalling anything. Both must run under the same macOS user.
- Permission errors: preserve the user's existing CLI policy. Roundtable has no interactive tool-approval dialog; actions requiring one may need the native CLI. Do not silently enable bypass permissions to make a test pass.
- Disable startup: `launchctl bootout gui/$(id -u)/local.roundtable.server`, then move its plist to Trash. Preserve conversations.
- Update: inspect local changes, use `git pull --ff-only`, run tests, and reload the specific LaunchAgent while no reply is running. Resolve local changes deliberately rather than resetting them away.
- Manual alternative: `npm start`, then leave the terminal open. Windows also supports manual startup and uses the Recycle Bin. Do not change an existing Windows startup configuration as part of a Mac setup.
