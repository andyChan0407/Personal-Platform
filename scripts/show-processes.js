// 真实进程占用自检：直接调用 sysinfo 的采集入口，连续采样两次（间隔 1 秒）求 CPU 差值，
// 打印按内存降序的「应用」列表。用于在不启动 GUI 的情况下验证采集链路是否可用。
// 用法：node scripts/show-processes.js
const os = require('os');
const s = require('../src/sysinfo.js');

(async () => {
  const a = await s.defaultListSamples();
  console.log('原始进程数:', a.length);
  if (!a.length) {
    console.log('未取到进程：当前环境可能不允许起子进程采集。');
    return;
  }
  await new Promise((r) => setTimeout(r, 1100));
  const b = await s.defaultListSamples();
  const prev = new Map(a.map((x) => [x.pid, { cpuSeconds: x.cpuSeconds, at: Date.now() - 1100 }]));
  const r = s.aggregate(b, prev, Date.now(), os.cpus().length, [], s.APP_NAME_MAP);
  console.log(
    '聚合应用数:',
    r.apps.length,
    '| CPU 合计:',
    r.cpuSum + '%',
    '| 内存合计:',
    (r.memSumBytes / 1024 / 1024).toFixed(1) + ' M'
  );
  r.apps.slice(0, 12).forEach((x) => {
    console.log(
      '  ' + x.name + '\t' + x.status + '\t' + x.cpuPercent.toFixed(1) + '%\t' +
        (x.memBytes / 1024 / 1024).toFixed(1) + ' M'
    );
  });
})();
