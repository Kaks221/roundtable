import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function recycleConversation(directory, id) {
  if (process.platform !== 'win32') throw new Error('Recycle Bin deletion is currently supported on Windows only.');
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid conversation ID');
  const root = realpathSync(directory);
  const target = realpathSync(path.join(root, `${id}.json`));
  if (path.dirname(target).toLowerCase() !== root.toLowerCase() || !statSync(target).isFile()) throw new Error('Conversation path is outside its storage folder');
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:ROUNDTABLE_RECYCLE_FILE, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin, [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, ROUNDTABLE_RECYCLE_FILE: target },
  });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'Could not move conversation to the Recycle Bin');
  if (existsSync(target)) throw new Error('Conversation still exists at its original path');
}
