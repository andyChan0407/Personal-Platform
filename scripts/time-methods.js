// 诊断：对比不同进程采集方式的耗时（PowerShell 顺序调用 / tasklist / wmic）
const { execFile } = require('child_process');
const s = require('../src/sysinfo.js');
const now = Date.now;

function run(file, args, opts) {
  return new Promise((res) => {
    const t = now();
    execFile(file, args, Object.assign({ encoding: 'buffer', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, opts), (err, stdout) => {
      res({ ms: now() - t, err: err ? err.message : null, bytes: stdout ? stdout.length : 0 });
    });
  });
}

(async () => {
  console.log('--- PowerShell 顺序调用 3 次 (defaultListSamples) ---');
  for (let i = 1; i <= 3; i += 1) {
    const t = now();
    const samples = await s.defaultListSamples();
    console.log(`#${i}: ${now() - t} ms | 进程数 ${samples.length}`);
  }

  console.log('\n--- tasklist /fo csv /nh ---');
  for (let i = 1; i <= 2; i += 1) {
    const r = await run('tasklist', ['/fo', 'csv', '/nh']);
    console.log(`#${i}: ${r.ms} ms | ${r.bytes} bytes | err=${r.err}`);
  }

  console.log('\n--- wmic process get ---');
  const r = await run('wmic', ['process', 'get', 'Name,ProcessId,UserModeTime,KernelModeTime,WorkingSetSize', '/format:csv']);
  console.log(`wmic: ${r.ms} ms | ${r.bytes} bytes | err=${r.err}`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
