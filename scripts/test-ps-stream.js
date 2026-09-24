// 验证：常驻 PowerShell 进程能否按行流式输出进程快照（用于消除每次采样的冷启动开销）
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const script =
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
  '$OutputEncoding=[System.Text.Encoding]::UTF8;' +
  '$ErrorActionPreference="SilentlyContinue";' +
  'while($true){' +
  '$j = Get-Process | Where-Object { $_.WorkingSet -gt 0 } | Select-Object Name,Id,CPU,WorkingSet | ConvertTo-Json -Compress;' +
  '[Console]::WriteLine($j);' +
  '[Console]::Out.Flush();' +
  'Start-Sleep -Milliseconds 1200' +
  '}';

const t0 = Date.now();
const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
  windowsHide: true,
});
const dec = new StringDecoder('utf8');
let buf = '';
let n = 0;

child.stdout.on('data', (chunk) => {
  buf += dec.write(chunk);
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    n += 1;
    let len = 0;
    let cjk = false;
    try {
      const d = JSON.parse(line);
      len = Array.isArray(d) ? d.length : 1;
      cjk = /[\u4e00-\u9fa5]/.test(line);
    } catch (e) {
      console.log('PARSE FAIL @', Date.now() - t0, 'ms:', line.slice(0, 80));
      continue;
    }
    console.log('line', n, '@', Date.now() - t0, 'ms | procs', len, '| cjk', cjk);
    if (n >= 4) {
      child.kill();
      console.log('OK: streaming works');
      process.exit(0);
    }
  }
});
child.on('error', (e) => {
  console.log('SPAWN ERROR:', e.message);
  process.exit(1);
});
setTimeout(() => {
  console.log('TIMEOUT (no 4 lines in 15s) n=' + n);
  try { child.kill(); } catch (e) {}
  process.exit(1);
}, 15000);
