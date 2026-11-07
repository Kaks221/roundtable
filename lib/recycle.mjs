import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function recycleConversation(directory, id) {
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Deletion supports Windows Recycle Bin and macOS Trash.');
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid conversation ID');
  const root = realpathSync(directory);
  const target = realpathSync(path.join(root, `${id}.json`));
  if (path.dirname(target).toLowerCase() !== root.toLowerCase() || !statSync(target).isFile()) throw new Error('Conversation path is outside its storage folder');
  if (process.platform === 'darwin') {
    const result = spawnSync('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete POSIX file (item 1 of argv)', '-e', 'end run', target], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'Could not move conversation to Trash');
    if (existsSync(target)) throw new Error('Conversation still exists at its original path');
    return;
  }
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:ROUNDTABLE_RECYCLE_FILE, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin, [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, ROUNDTABLE_RECYCLE_FILE: target },
  });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'Could not move conversation to the Recycle Bin');
  if (existsSync(target)) throw new Error('Conversation still exists at its original path');
}
