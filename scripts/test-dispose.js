// 验证退出清理：dispose() 应清定时器 + 杀掉在途子进程（退出不能及时的核心修复）
const s = require('../src/sysinfo.js');

const state = { killed: 0, execCalls: 0 };
// 假 execFile：返回一个“永不结束”的子进程句柄，模拟在途采集
const fakeChild = { on() { return this; }, kill() { state.killed += 1; } };
const fakeExec = () => { state.execCalls += 1; return fakeChild; };

const m = s.createSysMonitor({
  listSamples: s.defaultListSamples,
  execFile: fakeExec,
});

console.log('warm 调用前 execCalls =', state.execCalls);
m.warm();
setTimeout(() => {
  console.log('warm 后  execCalls =', state.execCalls, '| killed =', state.killed);
  m.dispose();
  console.log('dispose 后 killed =', state.killed, '| isRunning =', m.isRunning());
  // dispose 之后再 start() 不应重新起采集
  const before = state.execCalls;
  m.start();
  setTimeout(() => {
    const ok = state.killed > 0 && m.isRunning() === false && state.execCalls === before;
    console.log(ok ? 'PASS dispose 清理正常（杀子进程 + 停定时器 + 阻止再采集）' : 'FAIL dispose 清理异常');
    process.exit(ok ? 0 : 1);
  }, 60);
}, 150);
