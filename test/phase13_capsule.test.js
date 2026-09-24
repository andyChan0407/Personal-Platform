// Phase 13 测试：桌面胶囊入口（问题3）
// ① 纯算法（位置/拖拽/点击阈值/文案）
// ② 主进程编排（用伪 electron 真跑 src/main.js：启动只出胶囊、点击展开主窗口、拖动、关闭回胶囊、退出）
// ③ 胶囊页面本身（JSDOM 加载 capsule.html：点击=打开、拖动≠打开、计时状态同步）
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const caps = require(path.join(root, 'src/capsule-math.js'));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtc-capsule-'));

/* ---------- ① 纯算法 ---------- */
const wa = { x: 0, y: 0, width: 1600, height: 900 };
const size = { width: 184, height: 56 };

const def = caps.resolvePosition(null, wa, size);
assert.strictEqual(def.x, 1600 - 184 - 24, '默认应贴右侧安全边距');
assert.ok(def.y > 0 && def.y < 900 - 56, '默认纵向位置应落在工作区内');
assert.strictEqual(caps.resolvePosition({ x: 300, y: 200 }, wa, size).x, 300, '已保存位置应被沿用');
// 越界位置被夹紧回可视区
const clamped = caps.resolvePosition({ x: 9999, y: 9999 }, wa, size);
assert.ok(clamped.x <= 1600 - 184 - 24 && clamped.y <= 900 - 56 - 24, '越界位置应被夹回工作区');
assert.deepStrictEqual(
  caps.resolvePosition({ x: NaN, y: 20 }, wa, size),
  def,
  '无效位置应回落到默认位置'
);

assert.deepStrictEqual(
  caps.nextPosition({ x: 100, y: 100 }, { x: 140, y: 160 }, { x: 500, y: 400 }),
  { x: 540, y: 460 },
  '拖拽位移应叠加到窗口初始坐标'
);
assert.strictEqual(caps.isClick({ x: 100, y: 100 }, { x: 102, y: 103 }), true, '微小位移应视为点击');
assert.strictEqual(caps.isClick({ x: 100, y: 100 }, { x: 140, y: 100 }), false, '明显位移应视为拖拽');
assert.match(caps.todayKey(new Date(2026, 8, 19)), /^2026-09-19$/, 'todayKey 应输出 YYYY-MM-DD');
assert.strictEqual(caps.capsuleText({ timerText: '番茄 24:59' }), '番茄 24:59', '有计时时优先显示计时');
assert.strictEqual(caps.capsuleText({ todayCount: 3, undone: 8 }), '今日待办 3', '其次显示今日待办');
assert.strictEqual(caps.capsuleText({ todayCount: 0, undone: 5 }), '未完成 5', '无今日则显示未完成总数');
assert.strictEqual(caps.capsuleText({}), '今日毕', '都为空时显示默认文案');

/* ---------- ② 主进程编排（伪 electron） ---------- */
const cursor = { x: 100, y: 100 };
const events = { app: {}, ipc: {}, sent: [], quitCalled: false, appExited: false, menus: [] };

class FakeBrowserWindow {
  constructor(opts) {
    this.opts = opts;
    this.handlers = {};
    this.destroyed = false;
    this.visible = false;
    this.position = [opts.x || 0, opts.y || 0];
    this.moves = [];
    this.webContents = { send: (ch, payload) => events.sent.push([ch, payload]) };
    FakeBrowserWindow.instances.push(this);
  }
  loadFile(file) { this.file = file; }
  once(name, cb) { if (name === 'ready-to-show') { this.visible = true; cb(); } }
  on(name, cb) { (this.handlers[name] = this.handlers[name] || []).push(cb); }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() {}
  setAlwaysOnTop() {}
  getPosition() { return this.position.slice(); }
  setPosition(x, y) { this.position = [x, y]; this.moves.push([x, y]); }
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  // destroy 会绕过 closable / close 拦截（真实 Electron 语义），并触发 closed
  destroy() { this.destroyed = true; (this.handlers['closed'] || []).forEach((cb) => cb()); }
}
FakeBrowserWindow.instances = [];
FakeBrowserWindow.getAllWindows = () => FakeBrowserWindow.instances.filter((w) => !w.destroyed);

const fakeElectron = {
  app: {
    getPath: () => userDataDir,
    whenReady: () => Promise.resolve(),
    on: (name, cb) => { events.app[name] = cb; },
    quit: () => { events.quitCalled = true; },
    exit: () => { events.appExited = true; },
  },
  BrowserWindow: FakeBrowserWindow,
  ipcMain: { on: (ch, cb) => { events.ipc[ch] = cb; } },
  screen: {
    getPrimaryDisplay: () => ({ workArea: wa }),
    getCursorScreenPoint: () => ({ x: cursor.x, y: cursor.y }),
  },
  shell: { showItemInFolder: () => {} },
  Menu: {
    buildFromTemplate: (tpl) => ({ template: tpl, popup: () => {} }),
    setApplicationMenu: (m) => events.menus.push(m),
  },
};

const run = (async () => {
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return fakeElectron;
    return origLoad.apply(this, arguments);
  };
  let main;
  try {
    main = require(path.join(root, 'src/main.js'));
  } finally {
    Module._load = origLoad;
    delete require.cache[require.resolve(path.join(root, 'src/main.js'))];
  }
  await new Promise((r) => setImmediate(r)); // 等 app.whenReady().then 执行

  const wins = FakeBrowserWindow.instances;
  assert.strictEqual(wins.length, 1, '启动时只应创建一个窗口（桌面胶囊）');
  const capsule = wins[0];
  assert.ok(capsule.file.includes('capsule.html'), '启动窗口应加载桌面胶囊页面');
  assert.strictEqual(capsule.opts.frame, false, '胶囊应无边框');
  assert.strictEqual(capsule.opts.transparent, true, '胶囊窗体应透明以支持圆角药丸外观');
  assert.strictEqual(capsule.opts.alwaysOnTop, true, '胶囊应置顶显示在桌面上');
  assert.strictEqual(capsule.opts.resizable, false, '胶囊不应可拉伸');
  assert.ok(wins.every((w) => !String(w.file).includes('index.html')), '启动时不应直接打开功能主页');
  assert.ok(capsule.visible, '胶囊应在就绪后显示');
  assert.ok(events.menus.length === 1, '启动时安装中文菜单');
  assert.strictEqual(
    capsule.opts.webPreferences.backgroundThrottling,
    false,
    '胶囊不应被后台节流（要实时显示计时）'
  );

  const expected = caps.resolvePosition(({}).capsulePos, wa, main.CAPSULE);
  assert.deepStrictEqual(capsule.getPosition(), [expected.x, expected.y], '胶囊初始位置应落在工作区右侧');

  // 点击胶囊 → 展开主功能页
  events.ipc['capsule:open']({}, null);
  assert.strictEqual(FakeBrowserWindow.instances.length, 2, '点击胶囊应再创建一个主窗口');
  const mainW = FakeBrowserWindow.instances[1];
  assert.ok(mainW.file.includes('index.html'), '主窗口应加载功能主页 index.html');
  assert.strictEqual(capsule.visible, false, '展开主界面时胶囊应隐藏');
  assert.ok(mainW.visible, '主窗口应显示');
  assert.strictEqual(
    mainW.opts.webPreferences.backgroundThrottling,
    false,
    '主窗口收起/被遮挡时不应节流计时（番茄计时必须走准）'
  );

  // 计时状态转发给胶囊
  events.ipc['timer:update']({}, { kind: 'pomodoro', text: '番茄 24:59 工作中' });
  const lastTimer = events.sent.filter((s) => s[0] === 'capsule:timer').pop();
  assert.ok(lastTimer && lastTimer[1].text === '番茄 24:59 工作中', '计时状态应实时同步到胶囊');

  // 关闭主窗口 → 退回胶囊（而不是退出进程）
  let prevented = false;
  (mainW.handlers['close'] || []).forEach((cb) => cb({ preventDefault: () => (prevented = true) }));
  assert.ok(prevented, '关闭主窗口应被拦截（不直接退出）');
  assert.strictEqual(mainW.visible, false, '主窗口应隐藏');
  assert.strictEqual(capsule.visible, true, '关闭主窗口后胶囊应重新出现');
  assert.strictEqual(events.quitCalled, false, '关闭主窗口不应退出应用');
  const summarySent = events.sent.filter((s) => s[0] === 'capsule:summary').pop();
  assert.ok(summarySent && typeof summarySent[1].todayCount === 'number', '回到胶囊时应刷新今日待办摘要');

  // 拖动胶囊
  cursor.x = 100; cursor.y = 100;
  events.ipc['capsule:drag-start']({}, null);
  cursor.x = 140; cursor.y = 160;
  await new Promise((r) => setTimeout(r, 60));
  const pos = capsule.getPosition();
  assert.strictEqual(pos[0], expected.x + 40, '胶囊应跟随鼠标横向移动');
  assert.strictEqual(pos[1], expected.y + 60, '胶囊应跟随鼠标纵向移动');

  events.ipc['capsule:drag-end']({}, { opened: false });
  const moveCount = capsule.moves.length;
  cursor.x = 900; cursor.y = 800;
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(capsule.moves.length, moveCount, '松手后应停止跟随鼠标（清理定时器）');

  const savedData = JSON.parse(fs.readFileSync(path.join(userDataDir, 'data.json'), 'utf8'));
  assert.deepStrictEqual(savedData.settings.capsulePos, { x: pos[0], y: pos[1] }, '胶囊位置应持久化，下次启动原位恢复');

  // 全部窗口关闭 ≠ 退出（胶囊仍在）
  let allClosedPrevented = false;
  events.app['window-all-closed']({ preventDefault: () => (allClosedPrevented = true) });
  assert.ok(allClosedPrevented, '胶囊存在时不应随窗口关闭而退出');
  assert.strictEqual(events.quitCalled, false);

  // 显式退出
  events.ipc['capsule:quit']({}, null);
  assert.strictEqual(events.quitCalled, true, '“完全退出”应真正退出应用');

  // 退出修复（不能及时退出的根因）：
  // ① before-quit 必须强制销毁所有窗口，绕过胶囊窗 closable:false 与主窗 close 拦截，
  //    否则 app.quit() 无法关闭窗口而被卡住。
  events.app['before-quit']();
  assert.ok(
    FakeBrowserWindow.instances.every((w) => w.destroyed),
    'before-quit 应强制销毁所有窗口（胶囊 closable:false 不能阻塞退出）'
  );
  // ② 退出过程中 window-all-closed 不得再把胶囊显示回来（否则会取消退出）
  let quitAllClosedPrevented = false;
  events.app['window-all-closed']({ preventDefault: () => (quitAllClosedPrevented = true) });
  assert.strictEqual(quitAllClosedPrevented, false, '正在退出时不得拦截 window-all-closed');
  // ③ will-quit 应清理兜底强制退出定时器（避免残留定时器）
  events.app['will-quit'] && events.app['will-quit']();

  /* ---------- ③ 胶囊页面交互（JSDOM） ---------- */
  const calls = { open: 0, dragStart: 0, dragEnd: [], menu: 0, timerCb: null, summaryCb: null };
  const dom = await JSDOM.fromFile(path.join(root, 'src/renderer/capsule.html'), {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.capsuleBridge = {
        openMain: () => (calls.open += 1),
        dragStart: () => (calls.dragStart += 1),
        dragEnd: (opened) => calls.dragEnd.push(opened),
        showMenu: () => (calls.menu += 1),
        onTimer: (cb) => (calls.timerCb = cb),
        onSummary: (cb) => (calls.summaryCb = cb),
      };
    },
  });
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
  });
  const { CapsuleUI, document } = dom.window;
  assert.ok(document.getElementById('capsule'), '胶囊页面应渲染 .capsule 药丸容器');
  assert.ok(CapsuleUI, '胶囊交互脚本应初始化');

  // 点击（按下与松开几乎同点）→ 打开主界面
  CapsuleUI.press(50, 50);
  CapsuleUI.release(51, 52);
  assert.strictEqual(calls.open, 1, '点击胶囊应触发打开主界面');
  assert.strictEqual(calls.dragStart, 1, '按下应通知主进程开始拖拽');
  assert.deepStrictEqual(calls.dragEnd, [false], '点击结束应标记非拖拽以便保留原位');

  // 拖动（松开点明显偏移）→ 不打开主界面
  CapsuleUI.press(50, 50);
  CapsuleUI.release(240, 260);
  assert.strictEqual(calls.open, 1, '拖动后不应误触发打开主界面');
  assert.deepStrictEqual(calls.dragEnd, [false, true], '拖动结束应标记为已移动');

  // 计时状态同步显示
  assert.ok(typeof calls.timerCb === 'function', '胶囊应订阅计时状态');
  calls.timerCb({ kind: 'pomodoro', text: '番茄 24:59 工作中' });
  assert.strictEqual(CapsuleUI.getText(), '番茄 24:59 工作中', '胶囊应实时显示计时文案');
  assert.strictEqual(CapsuleUI.isRunning(), true, '计时中胶囊应有运行态样式');
  calls.timerCb(null);
  calls.summaryCb({ todayCount: 2, undone: 7 });
  assert.strictEqual(CapsuleUI.getText(), '今日待办 2', '无计时时应显示今日待办数');
  assert.strictEqual(CapsuleUI.isRunning(), false, '停止计时应恢复常态样式');

  // 右键 → 中文菜单
  document.getElementById('capsule').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true }));
  assert.strictEqual(calls.menu, 1, '右键胶囊应弹出菜单');

  dom.window.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });

  console.log('PASS  Phase 13: 桌面胶囊入口（仅胶囊启动/点击展开/拖动记忆位置/关闭回胶囊/状态同步/显式退出）');
})();

if (require.main === module) {
  run.then(
    () => process.exit(0),
    (e) => {
      console.error('FAIL  phase13_capsule.test.js: ' + (e && e.message ? e.message : e));
      process.exit(1);
    }
  );
} else {
  module.exports = run;
}
