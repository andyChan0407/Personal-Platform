// Phase 14 测试：胶囊悬停资源面板（CPU / 内存 / 固定磁盘）
// ① 采集层纯函数（CPU 差值、内存口径、磁盘容量换算、盘型判定、盘符探测）
// ② 展示层文案（GB / 百分比 / 告警分级）
// ③ 展开布局数学（下方/上方、向右/向左展开、越界夹紧）
// ④ 主进程编排（伪 electron + 伪 sysinfo：悬停扩窗并启动采集、移开缩窗并停止采集、拖拽前收起、打开主界面复位）
// ⑤ 胶囊页面（JSDOM：悬停展开并回传实测高度、渲染 CPU/内存/多磁盘、钉住时不自动收起、主进程收起时同步复位）
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const sys = require(path.join(root, 'src/sysinfo.js'));
const Fmt = require(path.join(root, 'src/sysinfo-format.js'));
const caps = require(path.join(root, 'src/capsule-math.js'));

const GB = 1024 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtc-sysinfo-'));

/* ---------- ① 采集层纯函数 ---------- */
const snapA = sys.cpuSnapshot([{ times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }]);
const snapB = sys.cpuSnapshot([{ times: { user: 200, nice: 0, sys: 50, idle: 1750, irq: 0 } }]);
assert.strictEqual(snapA.total, 1000, 'CPU 快照应汇总 user/nice/sys/idle/irq');
assert.strictEqual(snapA.idle, 850, 'CPU 快照应记录 idle tick');
assert.strictEqual(sys.cpuUsage(snapA, snapB), 10, '两次采样间 1000 tick 里忙 100 → 10%');
assert.strictEqual(sys.cpuUsage(null, snapB), null, '缺少基准时应返回 null（界面显示 --）');
assert.strictEqual(sys.cpuUsage(snapB, snapB), null, '时间未前进时不应算出使用率');
const twoCoreA = sys.cpuSnapshot([
  { times: { user: 10, sys: 0, idle: 90 } },
  { times: { user: 10, sys: 0, idle: 90 } },
]);
const twoCoreB = sys.cpuSnapshot([
  { times: { user: 20, sys: 0, idle: 100 } },
  { times: { user: 20, sys: 0, idle: 100 } },
]);
assert.strictEqual(sys.cpuUsage(twoCoreA, twoCoreB), 50, '多核应汇总后按总 tick 差值计算');
assert.deepStrictEqual(sys.cpuSnapshot(null), { idle: 0, total: 0 }, '空 CPU 列表不应抛错');

const mem = sys.memInfo(16 * GB, 4 * GB);
assert.strictEqual(mem.used, 12 * GB, '内存已用 = 总 - 空闲');
assert.strictEqual(mem.freePercent, 25, '内存剩余百分比应为 25%');
assert.strictEqual(mem.usedPercent, 75, '内存占用百分比应为 75%');
assert.strictEqual(sys.memInfo(16 * GB, 99 * GB).free, 16 * GB, '空闲大于总量时应夹回总量');
assert.deepStrictEqual(sys.memInfo(0, 0), { total: 0, free: 0, used: 0, usedPercent: 0, freePercent: 0 }, '零总量不应出现 NaN');

const disk = sys.driveInfo('c:', { bsize: 4096, blocks: 262144, bavail: 65536 });
assert.strictEqual(disk.letter, 'C:', '盘符应统一大写');
assert.strictEqual(disk.total, 1024 * 1024 * 1024, '总容量 = blocks × bsize');
assert.strictEqual(disk.free, 256 * 1024 * 1024, '剩余容量 = bavail × bsize');
assert.strictEqual(disk.freePercent, 25, '剩余百分比应为 25%');
assert.strictEqual(disk.usedPercent, 75, '占用百分比应为 75%');
assert.strictEqual(sys.driveInfo('D:', { bsize: 4096, blocks: 10, bfree: 5 }).free, 5 * 4096, '缺少 bavail 时退回 bfree');
assert.strictEqual(sys.driveInfo('D:', null).total, 0, 'statfs 失败时应给出 0 而不是抛错');

assert.strictEqual(sys.isFixedDriveText('C: - 固定驱动器'), true, '中文「固定驱动器」应判为固定盘');
assert.strictEqual(sys.isFixedDriveText('Fixed drive'), true, '英文 Fixed drive 应判为固定盘');
assert.strictEqual(sys.isFixedDriveText('E: - 可移动驱动器'), false, '可移动盘应被过滤');
assert.strictEqual(sys.isFixedDriveText('Removable drive'), false, 'Removable 应被过滤');
assert.strictEqual(sys.isFixedDriveText('D: - CD-ROM'), false, '光驱应被过滤');
assert.strictEqual(sys.isFixedDriveText('Z: - Network drive'), false, '网络盘应被过滤');
assert.strictEqual(sys.isFixedDriveText(''), true, '判型无输出时保守保留（宁可多列不要漏盘）');
// 已实测过的 GBK 字节：C: - 固定驱动器
assert.ok(sys.decodeOut(Buffer.from('b9ccb6a8c7fdb6afc6f7', 'hex')).includes('固定'), 'GBK 输出应能正确解码');
assert.strictEqual(sys.decodeOut(Buffer.from('Fixed drive', 'ascii')), 'Fixed drive', '纯 ASCII 输出应原样返回');

const statfsStub = (p) => {
  const letter = String(p).slice(0, 2);
  if (letter === 'C:' || letter === 'D:') return { bsize: 4096, blocks: 100, bavail: 50 };
  throw new Error('ENOENT');
};
assert.deepStrictEqual(sys.probeLetters(statfsStub), ['C:', 'D:'], '应只保留能读到容量的盘符');

const runAsync = (async () => {
  const execStub = (file, args, opts, cb) => {
    const letter = args[2];
    if (letter === 'C:') return cb(null, Buffer.from('b9ccb6a8c7fdb6afc6f7', 'hex'));
    if (letter === 'E:') return cb(null, Buffer.from('E: - Removable drive'));
    return cb(new Error('no such drive'));
  };
  assert.deepStrictEqual(
    await sys.listFixedLetters({ execFile: execStub, statfsSync: statfsStub }),
    ['C:', 'D:'],
    '盘型判定：C 固定、D 判型失败保守保留、E 可移动被过滤'
  );
  const failStub = (file, args, opts, cb) => cb(new Error('fsutil 不可用'));
  assert.deepStrictEqual(
    await sys.listFixedLetters({ execFile: failStub, statfsSync: statfsStub }),
    ['C:', 'D:'],
    'fsutil 全部失败时退回可访问盘符（不静默丢失磁盘）'
  );

  // 采集器：按需启动/停止，CPU 首采样无基准
  let tick = 0;
  const monitor = sys.createSysMonitor({
    cpus: () => [{ times: { user: 100 + tick * 10, sys: 0, idle: 1000 + tick * 90 } }],
    totalmem: () => 16 * GB,
    freemem: () => 4 * GB,
    statfsSync: statfsStub,
    listLetters: () => Promise.resolve(['C:', 'D:']),
    intervalMs: 100000,
    warmupMs: 100000,
  });
  const seen = [];
  monitor.onUpdate((s) => seen.push(s));
  assert.strictEqual(monitor.isRunning(), false, '未展开面板时不应在后台采集');
  monitor.start();
  assert.strictEqual(monitor.isRunning(), true, 'start 后应处于采集状态');
  assert.strictEqual(seen.length, 1, 'start 应立即产出一帧（让面板马上有内容）');
  assert.strictEqual(seen[0].cpu, null, '第一帧没有 CPU 基准，应为 null');
  assert.strictEqual(seen[0].mem.free, 4 * GB, '第一帧应带内存数据');
  assert.deepStrictEqual(seen[0].disks.map((d) => d.letter), ['C:', 'D:'], '第一帧应带上磁盘');
  assert.strictEqual(seen[0].cores, 1, '应带上 CPU 核心数');
  tick = 1;
  monitor.sample();
  assert.strictEqual(seen[1].cpu, 10, '第二次采样应算出 CPU 使用率');
  monitor.stop();
  assert.strictEqual(monitor.isRunning(), false, 'stop 后应停止采集（不留后台开销）');

  /* ---------- ② 展示层文案 ---------- */
  assert.strictEqual(Fmt.fmtGB(GB), '1.0', '字节省略单位应以 GB 保留 1 位小数');
  assert.strictEqual(Fmt.fmtGB(1.5 * GB), '1.5', 'GB 换算应保留 1 位小数');
  assert.strictEqual(Fmt.fmtPercent(13.6), '14%', '百分比应四舍五入');
  assert.strictEqual(Fmt.barWidth(-5), 0, '进度条宽度下限为 0');
  assert.strictEqual(Fmt.barWidth(180), 100, '进度条宽度上限为 100');
  assert.strictEqual(Fmt.levelOf(5), 'danger', '剩余 ≤10% 应告警红');
  assert.strictEqual(Fmt.levelOf(10), 'danger', '剩余 10% 应告警红');
  assert.strictEqual(Fmt.levelOf(15), 'warn', '剩余 ≤20% 应提醒橙');
  assert.strictEqual(Fmt.levelOf(60), 'ok', '剩余充足应为常态色');

  assert.strictEqual(Fmt.cpuText(23, 12), '23% · 12 核', 'CPU 文案应带核心数');
  assert.strictEqual(Fmt.cpuText(null, 12), '-- · 12 核', '首次采样前 CPU 应显示 --');
  assert.strictEqual(Fmt.cpuBar(null), 0, 'CPU 未就绪时进度条宽度为 0');

  const memView = Fmt.memView({ total: 16 * GB, used: 12 * GB, free: 4 * GB });
  assert.strictEqual(memView.lineText, '已用 12.0 G / 共 16.0 G', '内存应显示已用与总量');
  assert.strictEqual(memView.subText, '剩余 4.0 G · 25% 可用', '内存应显示剩余 GB 与可用百分比');
  assert.strictEqual(memView.barPercent, 75, '内存进度条按占用比例');
  assert.strictEqual(memView.level, 'ok', '内存剩余 25% 不告警');

  const diskView = Fmt.diskView({ letter: 'E:', total: 500 * GB, free: 50 * GB, freePercent: 10 });
  assert.strictEqual(diskView.lineText, '共 500.0 G · 剩 50.0 G · 10%', '磁盘应显示总量/剩余/剩余百分比');
  assert.strictEqual(diskView.barPercent, 90, '磁盘进度条按占用比例');
  assert.strictEqual(diskView.level, 'danger', '磁盘剩余 10% 应告警红');
  assert.deepStrictEqual(
    Fmt.sortDisks([{ letter: 'D:' }, { letter: 'C:' }, { letter: 'E:' }]).map((d) => d.letter),
    ['C:', 'D:', 'E:'],
    '磁盘应按盘符稳定排序'
  );
  assert.strictEqual(Fmt.diskSummary([{}, {}, {}]), '磁盘 3 个', '应给出磁盘数量摘要');

  /* ---------- ③ 展开布局数学 ---------- */
  const wa = { x: 0, y: 0, width: 1600, height: 900 };
  const collapsed = { x: 1392, y: 300, width: 184, height: 56 };
  const L1 = caps.resolveExpanded(collapsed, wa, 300);
  assert.strictEqual(L1.bounds.width, 312, '展开宽度 = 面板 300 + 左右内边距');
  assert.strictEqual(L1.bounds.height, 362, '展开高度 = 6 + 胶囊 44 + 6 + 面板 300 + 6');
  assert.strictEqual(L1.bounds.x, 1264, '右侧放不下 312 时应向左展开');
  assert.strictEqual(L1.align, 'right', '向左展开时胶囊应贴窗口右侧');
  assert.strictEqual(L1.capsuleInset, 134, '胶囊在窗口内的水平落点应保持屏幕位置不变');
  assert.strictEqual(L1.place, 'below', '下方空间充足时应显示在胶囊下方');
  assert.strictEqual(L1.bounds.y, 300, '下方显示时窗口纵向位置不变');

  const L2 = caps.resolveExpanded({ x: 100, y: 100, width: 184, height: 56 }, wa, 300);
  assert.strictEqual(L2.bounds.x, 100, '右侧放得下时应向右展开（窗口左缘不动）');
  assert.strictEqual(L2.align, 'left', '向右展开时胶囊贴窗口左侧');
  assert.strictEqual(L2.capsuleInset, 6, '向右展开时胶囊保持左侧内边距');

  const L3 = caps.resolveExpanded({ x: 100, y: 820, width: 184, height: 56 }, wa, 300);
  assert.strictEqual(L3.place, 'above', '贴屏幕底部时应翻到胶囊上方');
  assert.strictEqual(L3.bounds.y, 820 + 56 - 362, '翻到上方后窗口底边对齐原胶囊底边');
  assert.strictEqual(L3.bounds.y + L3.bounds.height, 876, '胶囊的纵向位置在屏幕上保持不变');

  const small = { x: 0, y: 0, width: 800, height: 400 };
  const L4 = caps.resolveExpanded({ x: 300, y: 100, width: 184, height: 56 }, small, 300);
  assert.ok(L4.bounds.y >= 0, '上下都放不下时窗口仍应落在工作区内');
  assert.strictEqual(L4.bounds.y, 38, '放不下时窗口应夹紧在工作区内（400 - 362）');
  const narrow = caps.resolveExpanded({ x: 0, y: 0, width: 184, height: 56 }, { x: 0, y: 0, width: 200, height: 600 }, 200);
  assert.strictEqual(narrow.bounds.x, 0, '屏幕比面板还窄时窗口应贴左');
  assert.ok(narrow.capsuleInset >= 6, '胶囊落点不应被算到窗口外');

  /* ---------- ④ 主进程编排 ---------- */
  const events = { app: {}, ipc: {}, sent: [], menus: [] };
  const cursor = { x: 100, y: 100 };
  const monitorCalls = { created: 0, started: 0, stopped: 0, emit: null };
  const fakeSysinfo = {
    createSysMonitor: () => {
      monitorCalls.created += 1;
      return {
        onUpdate: (cb) => {
          monitorCalls.emit = cb;
        },
        start: () => {
          monitorCalls.started += 1;
        },
        stop: () => {
          monitorCalls.stopped += 1;
        },
      };
    },
  };

  class FakeBrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.handlers = {};
      this.destroyed = false;
      this.visible = false;
      this.position = [opts.x || 0, opts.y || 0];
      this.bounds = { x: opts.x || 0, y: opts.y || 0, width: opts.width, height: opts.height };
      this.boundsCalls = [];
      this.webContents = { send: (ch, payload) => events.sent.push([ch, payload]) };
      FakeBrowserWindow.instances.push(this);
    }
    loadFile(file) {
      this.file = file;
    }
    once(name, cb) {
      if (name === 'ready-to-show') {
        this.visible = true;
        cb();
      }
    }
    on(name, cb) {
      (this.handlers[name] = this.handlers[name] || []).push(cb);
    }
    show() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    focus() {}
    setAlwaysOnTop() {}
    getPosition() {
      return this.position.slice();
    }
    setPosition(x, y) {
      this.position = [x, y];
      // 真实 Electron 里 setPosition 会同步改变窗口 bounds，假窗体保持同样语义
      this.bounds.x = x;
      this.bounds.y = y;
    }
    getBounds() {
      return Object.assign({}, this.bounds);
    }
    setBounds(b) {
      this.boundsCalls.push(Object.assign({}, b));
      this.bounds = Object.assign({}, b);
      this.position = [b.x, b.y];
    }
    isVisible() {
      return this.visible;
    }
    isDestroyed() {
      return this.destroyed;
    }
  }
  FakeBrowserWindow.instances = [];

  const fakeElectron = {
    app: {
      getPath: () => userDataDir,
      whenReady: () => Promise.resolve(),
      on: (name, cb) => {
        events.app[name] = cb;
      },
      quit: () => {},
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      on: (ch, cb) => {
        events.ipc[ch] = cb;
      },
    },
    screen: {
      getPrimaryDisplay: () => ({ workArea: wa }),
      getDisplayMatching: () => ({ workArea: wa }),
      getCursorScreenPoint: () => ({ x: cursor.x, y: cursor.y }),
    },
    shell: { showItemInFolder: () => {} },
    Menu: { buildFromTemplate: () => ({ popup: () => {} }), setApplicationMenu: () => {} },
  };

  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return fakeElectron;
    if (request === './sysinfo') return fakeSysinfo;
    return origLoad.apply(this, arguments);
  };
  let main;
  try {
    main = require(path.join(root, 'src/main.js'));
  } finally {
    Module._load = origLoad;
    delete require.cache[require.resolve(path.join(root, 'src/main.js'))];
  }
  await new Promise((r) => setImmediate(r));

  const capsule = FakeBrowserWindow.instances[0];
  const collapsedNow = capsule.getBounds();
  assert.strictEqual(collapsedNow.width, 184, '初始应为收起态 184 宽');
  assert.strictEqual(collapsedNow.height, 56, '初始应为收起态 56 高');

  const lastPanelLayout = () => {
    const list = events.sent.filter((s) => s[0] === 'capsule:panel-layout');
    return list.length ? list[list.length - 1][1] : null;
  };

  // 悬停 → 扩窗 + 启动采集
  events.ipc['capsule:panel']({}, { open: true, height: 300 });
  const opened = capsule.getBounds();
  assert.strictEqual(opened.height, 362, '悬停后窗口应撑到能容纳面板');
  assert.strictEqual(monitorCalls.started, 1, '悬停后才开始采集系统资源');
  assert.strictEqual(lastPanelLayout().open, true, '应回传展开布局给渲染层');
  assert.strictEqual(lastPanelLayout().place, 'below', '默认显示在胶囊下方');

  // 采集回调 → 推给渲染层
  const sample = { cpu: 23, cores: 12, mem: { total: 16 * GB, free: 4 * GB, used: 12 * GB }, disks: [sys.driveInfo('C:', { bsize: 4096, blocks: 100, bavail: 25 })], at: Date.now() };
  monitorCalls.emit(sample);
  const statsSent = events.sent.filter((s) => s[0] === 'capsule:stats').pop();
  assert.ok(statsSent && statsSent[1] === sample, '系统资源快照应实时推给胶囊');

  // 面板高度变化（磁盘数量变化）→ 窗口跟随调整
  events.ipc['capsule:panel']({}, { open: true, height: 400 });
  assert.strictEqual(capsule.getBounds().height, 462, '面板变高时窗口应跟着变高');
  assert.strictEqual(monitorCalls.created, 1, '采集器应复用同一个实例，不要每次悬停都新建');
  assert.strictEqual(monitorCalls.started, 2, '再次悬停应重新开始采集');

  // 移开 → 缩回 + 停止采集
  events.ipc['capsule:panel']({}, { open: false });
  assert.deepStrictEqual(capsule.getBounds(), collapsedNow, '移开鼠标后窗口应缩回原尺寸原位置');
  assert.strictEqual(monitorCalls.stopped, 1, '面板收起后应停止采集（不留后台常驻开销）');
  assert.strictEqual(lastPanelLayout().open, false, '应收起指令回传渲染层');

  // 钉住期间拖拽 → 拖拽前必须先收起面板，避免按展开态坐标计算
  events.ipc['capsule:panel']({}, { open: true, pinned: true, height: 300 });
  assert.strictEqual(capsule.getBounds().height, 362, '钉住时窗口保持展开');
  events.ipc['capsule:drag-start']({}, null);
  assert.strictEqual(capsule.getBounds().height, 56, '开始拖拽前应先把窗口收回胶囊尺寸');
  cursor.x = 140;
  cursor.y = 160;
  await sleep(60);
  events.ipc['capsule:drag-end']({}, { opened: false });
  const moved = capsule.getBounds();
  assert.strictEqual(moved.width, 184, '拖拽结束后仍是收起态');
  const savedData = JSON.parse(fs.readFileSync(path.join(userDataDir, 'data.json'), 'utf8'));
  assert.deepStrictEqual(savedData.settings.capsulePos, { x: moved.x, y: moved.y }, '拖拽后位置持久化');

  // 钉住状态下面板已收起 → 再次悬停应能正常展开
  events.ipc['capsule:panel']({}, { open: true, height: 300 });
  assert.strictEqual(capsule.getBounds().height, 362, '拖拽后再次悬停应能正常展开');

  // 打开主界面 → 面板复位收起
  events.ipc['capsule:open']({}, null);
  assert.strictEqual(capsule.getBounds().height, 56, '展开主界面时资源面板应复位收起');
  assert.strictEqual(monitorCalls.stopped >= 2, true, '收起后应停止采集');
  assert.strictEqual(capsule.visible, false, '展开主界面时胶囊应隐藏');

  assert.ok(main.PANEL_OPTIONS && main.PANEL_OPTIONS.panelWidth === 300, '应导出面板尺寸参数供样式对齐');

  console.log('PASS  Phase 14: 系统资源采集（CPU 差值/内存口径/固定磁盘过滤）');
  console.log('PASS  Phase 14: 资源文案与告警分级、面板展开布局数学');
  console.log('PASS  Phase 14: 主进程面板编排（悬停扩窗+按需采集 / 移开缩窗停采 / 拖拽前收起）');
})();

const run = runAsync.then(async () => {
  /* ---------- ⑤ 胶囊页面交互（JSDOM） ---------- */
  const calls = { panel: [], layoutCb: null, statsCb: null, open: 0, dragStart: 0, dragEnd: [], menu: 0, timerCb: null, summaryCb: null };
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
        setPanel: (info) => calls.panel.push(info),
        onPanelLayout: (cb) => (calls.layoutCb = cb),
        onStats: (cb) => (calls.statsCb = cb),
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
  const panelEl = document.getElementById('panel');
  assert.ok(panelEl, '胶囊页面应包含资源面板容器');
  assert.ok(document.getElementById('p-disks'), '面板应包含磁盘列表容器');
  assert.ok(document.getElementById('p-cpu'), '面板应包含 CPU 展示位');
  assert.ok(document.getElementById('p-mem'), '面板应包含内存展示位');
  assert.strictEqual(CapsuleUI.isPanelOpen(), false, '默认不显示面板');
  assert.strictEqual(calls.panel.length, 0, '未悬停时不应与主进程通信');

  // JSDOM 不做布局，offsetHeight 恒为 0：这里手动给出面板实测高度
  Object.defineProperty(panelEl, 'offsetHeight', { value: 288, configurable: true });

  // 悬停展开 → 回传实测高度给主进程扩窗
  CapsuleUI.hoverOn();
  assert.strictEqual(CapsuleUI.isPanelOpen(), true, '悬停应展开面板');
  assert.ok(calls.panel.length >= 1, '悬停应通知主进程扩窗');
  const openMsg = calls.panel[calls.panel.length - 1];
  assert.strictEqual(openMsg.open, true, '应上报展开状态');
  assert.strictEqual(openMsg.height, 288, '应上报渲染层实测的面板高度');
  assert.strictEqual(openMsg.pinned, false, '默认未钉住');
  assert.strictEqual(panelEl.getAttribute('aria-hidden'), 'false', '展开时应对辅助技术可见');

  // 主进程回传布局：翻到上方 + 向左展开（JSDOM 跨 realm，逐字段比较避免原型不一致）
  assert.ok(typeof calls.layoutCb === 'function', '胶囊应订阅面板布局');
  calls.layoutCb({ open: true, place: 'above', align: 'right' });
  let layout = CapsuleUI.getLayout();
  assert.strictEqual(layout.above, true, '下方放不下时应把面板翻到胶囊上方');
  assert.strictEqual(layout.capRight, true, '向左展开时胶囊应贴右对齐');
  calls.layoutCb({ open: true, place: 'below', align: 'left' });
  layout = CapsuleUI.getLayout();
  assert.strictEqual(layout.above, false, '应能切回「面板在下方」');
  assert.strictEqual(layout.capRight, false, '应能切回「胶囊贴左对齐」');

  // 资源快照 → 面板渲染
  assert.ok(typeof calls.statsCb === 'function', '胶囊应订阅资源快照');
  calls.statsCb({
    cpu: 23,
    cores: 12,
    mem: { total: 16 * GB, free: 4 * GB, used: 12 * GB },
    disks: [
      { letter: 'D:', total: 500 * GB, free: 250 * GB, freePercent: 50 },
      { letter: 'C:', total: 500 * GB, free: 50 * GB, freePercent: 10 },
      { letter: 'E:', total: 100 * GB, free: 60 * GB, freePercent: 60 },
    ],
  });
  assert.strictEqual(CapsuleUI.getCpuText(), '23% · 12 核', '面板应显示 CPU 使用率与核心数');
  assert.strictEqual(CapsuleUI.getMemText(), '已用 12.0 G / 共 16.0 G', '面板应显示内存总量与已用');
  assert.strictEqual(CapsuleUI.getMemSub(), '剩余 4.0 G · 25% 可用', '面板应显示内存剩余 GB 与可用百分比');
  const rows = CapsuleUI.getDiskRows();
  assert.strictEqual(rows.length, 3, '应渲染全部固定磁盘');
  assert.strictEqual(rows.map((r) => r.letter).join(','), 'C:,D:,E:', '磁盘应按盘符排序展示');
  assert.ok(rows[0].text.indexOf('共 500.0 G') >= 0 && rows[0].text.indexOf('剩 50.0 G') >= 0, '磁盘应显示总量与剩余 GB');
  assert.ok(rows[0].text.indexOf('10%') >= 0, '磁盘应显示剩余百分比');
  assert.strictEqual(rows[0].level, 'danger', '剩余 10% 的磁盘应标红');
  assert.strictEqual(rows[0].width, '90%', '磁盘进度条按占用比例');
  assert.strictEqual(rows[2].level, 'ok', '剩余充足的磁盘用常态色');

  // CPU 未就绪时显示 --
  calls.statsCb({ cpu: null, cores: 12, mem: { total: 16 * GB, free: 4 * GB, used: 12 * GB }, disks: [] });
  assert.strictEqual(CapsuleUI.getCpuText(), '-- · 12 核', '首次采样前 CPU 应显示 --');

  // 钉住：鼠标移开也不收起
  CapsuleUI.togglePin();
  assert.strictEqual(CapsuleUI.isPanelPinned(), true, '点击钉住后应处于钉住状态');
  CapsuleUI.hoverOff();
  await sleep(340);
  assert.strictEqual(CapsuleUI.isPanelOpen(), true, '钉住后移开鼠标不应收起');

  // 取消钉住 → 鼠标离开窗口后收起（取消钉住瞬间光标还在面板上，不应立刻闪退）
  CapsuleUI.togglePin();
  assert.strictEqual(CapsuleUI.isPanelPinned(), false, '再次点击应取消钉住');
  assert.strictEqual(CapsuleUI.isPanelOpen(), true, '取消钉住时指针仍在面板上，不应立即收起');
  document.body.dispatchEvent(new dom.window.MouseEvent('mouseleave'));
  await sleep(340);
  assert.strictEqual(CapsuleUI.isPanelOpen(), false, '取消钉住后鼠标离开应收起');
  const closeMsg = calls.panel[calls.panel.length - 1];
  assert.strictEqual(closeMsg.open, false, '收起时应通知主进程缩回窗口');

  // 悬停进入（mouseenter）与离开（mouseleave）走真实事件路径
  document.body.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
  assert.strictEqual(CapsuleUI.isPanelOpen(), true, '鼠标进入窗口应展开面板');
  document.body.dispatchEvent(new dom.window.MouseEvent('mouseleave'));
  await sleep(340);
  assert.strictEqual(CapsuleUI.isPanelOpen(), false, '鼠标离开窗口应收起面板');

  // 主进程主动收起（拖拽 / 打开主界面）→ 本地同步收起并解除钉住
  CapsuleUI.hoverOn();
  CapsuleUI.togglePin();
  calls.layoutCb({ open: false });
  assert.strictEqual(CapsuleUI.isPanelOpen(), false, '主进程收起时面板应同步收起');
  assert.strictEqual(CapsuleUI.isPanelPinned(), false, '主进程收起时应解除钉住');
  assert.strictEqual(panelEl.getAttribute('aria-hidden'), 'true', '收起时应从辅助技术隐藏');

  // 拖拽/点击胶囊前先收起面板，避免按展开态坐标算位置
  CapsuleUI.hoverOn();
  CapsuleUI.press(50, 50);
  assert.strictEqual(CapsuleUI.isPanelOpen(), false, '按下胶囊应立刻收起面板');
  CapsuleUI.release(51, 52);
  assert.strictEqual(calls.open, 1, '点击胶囊仍应打开主界面');
  assert.strictEqual(calls.dragStart, 1, '按下时应通知主进程开始拖拽');

  dom.window.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });

  console.log('PASS  Phase 14: 胶囊悬停资源面板（展开/钉住/实时渲染 CPU·内存·多磁盘）');
});

if (require.main === module) {
  run.then(
    () => process.exit(0),
    (e) => {
      console.error('FAIL  phase14_sysinfo_panel.test.js: ' + (e && e.message ? e.message : e));
      if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
      process.exit(1);
    }
  );
} else {
  module.exports = run;
}
