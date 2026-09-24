// 判定常驻 PowerShell 是否在 stdout 被重定向时仍能按行流式输出（心跳测试）
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

// 心跳脚本：只写时间戳，每 500ms 一行
const script =
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
  '$i=0;' +
  'while($true){' +
  '$i++;' +
  '[Console]::WriteLine("HB " + $i + " " + (Get-Date).ToString("HH:mm:ss.fff"));' +
  '[Console]::Out.Flush();' +
  'Start-Sleep -Milliseconds 500' +
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
    console.log('@', Date.now() - t0, 'ms |', line);
    if (n >= 5) { child.kill(); console.log('OK: heartbeat streams'); process.exit(0); }
  }
});
child.on('error', (e) => { console.log('SPAWN ERROR:', e.message); process.exit(1); });
child.on('exit', (c) => console.log('child exited code', c));
setTimeout(() => { console.log('TIMEOUT n=' + n); try { child.kill(); } catch (e) {} process.exit(1); }, 12000);
