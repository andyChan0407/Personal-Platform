// 实测：优化后的采集延迟（wmic 优先）vs 旧实现（PowerShell 每次 30s）
const cp = require('child_process');
const os = require('os');
const s = require('../src/sysinfo.js');

function time(label, fn) {
  const t0 = Date.now();
  return Promise.resolve(fn()).then((r) => {
    const ms = Date.now() - t0;
    const n = Array.isArray(r) ? r.length : (r && r.processes ? r.processes.length : '?');
    console.log(`  ${label}: ${ms} ms  (结果数=${n})`);
    return { ms, r };
  });
}

console.log('=== 1) defaultListSamples（首次探明后端，走 wmic） ===');
time('defaultListSamples#1', () => s.defaultListSamples({}))
  .then(({ r }) => {
    console.log('  解析样例:', r.slice(0, 3).map((x) => `${x.name} pid=${x.pid} cpu=${x.cpuSeconds.toFixed(1)}s mem=${(x.memBytes/1048576).toFixed(0)}M`));
    console.log('\n=== 2) defaultListSamples（第二次，复用已探明后端） ===');
    return time('defaultListSamples#2', () => s.defaultListSamples({}));
  })
  .then(() => {
    console.log('\n=== 3) collectProcessList（模拟「首次悬停」体验：采集+聚合 Top12） ===');
    const t0 = Date.now();
    const selfPids = [];
    try { selfPids.push(process.pid); } catch (e) {}
    return s.collectProcessList({ listSamples: s.defaultListSamples, getSelfPids: () => selfPids, cpus: os.cpus }).then((procs) => {
      const ms = Date.now() - t0;
      const apps = (procs && procs.apps ? procs.apps : []).slice(0, 12);
      console.log(`  总采集+聚合: ${ms} ms，Top${apps.length} 应用:`);
      apps.forEach((a) => {
        const tag = a.self ? ' [本应用]' : '';
        console.log(`    - ${String(a.name).padEnd(18)} CPU=${a.cpuPercent == null ? '--' : a.cpuPercent.toFixed(1) + '%'}  内存=${(a.memBytes/1048576).toFixed(1)}M${tag}`);
      });
    });
  })
  .catch((e) => { console.error('ERR', e); process.exit(1); });
