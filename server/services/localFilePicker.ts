import { spawn } from 'node:child_process';

export type LocalMediaKind = 'video' | 'audio' | 'media';

const filters: Record<LocalMediaKind, string> = {
  video: 'Video files|*.mp4;*.mkv;*.mov;*.webm;*.avi;*.m4v|All files|*.*',
  audio: 'Audio files|*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg|All files|*.*',
  media: 'Media files|*.mp4;*.mkv;*.mov;*.webm;*.avi;*.m4v;*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg|All files|*.*',
};

export function buildLocalFilePickerScript(kind: LocalMediaKind) {
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$owner.Size = New-Object System.Drawing.Size(1, 1)',
    '$owner.Opacity = 0',
    '$owner.Show()',
    '$owner.Activate()',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    "$dialog.Title = 'Chọn video hoặc media trên máy'",
    `$dialog.Filter = '${filters[kind]}'`,
    '$dialog.Multiselect = $false',
    '$dialog.CheckFileExists = $true',
    '$dialog.RestoreDirectory = $true',
    'try { $result = $dialog.ShowDialog($owner); $selected = if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.FileName } else { $null } } finally { $dialog.Dispose(); $owner.Close(); $owner.Dispose() }',
    "if ($selected) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($selected)) }",
  ].join('; ');
}

export async function pickLocalMediaFile(kind: LocalMediaKind, signal?: AbortSignal): Promise<string | undefined> {
  if (process.platform !== 'win32') throw new Error('Mở file lớn không sao chép hiện chỉ hỗ trợ Windows.');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const script = buildLocalFilePickerScript(kind);

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let aborted = false;
    const abort = () => { aborted = true; child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      if (code !== 0) { reject(new Error(stderr.trim() || 'Không thể mở hộp thoại chọn file.')); return; }
      const encoded = stdout.trim();
      if (!encoded) { resolve(undefined); return; }
      try { resolve(Buffer.from(encoded, 'base64').toString('utf8')); }
      catch { reject(new Error('Không thể đọc đường dẫn file đã chọn.')); }
    });
  });
}
