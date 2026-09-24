// Electron 主进程：桌面胶囊悬浮窗 + 主功能窗口 + 数据读写 IPC + 中文菜单。
const electronLib = require('electron');
const { app, BrowserWindow, ipcMain, shell, screen } = electronLib;
const path = require('path');
const fs = require('fs');
const { createStorage } = require('./renderer/js/storage');
const { setupAppMenu, buildCapsuleContextMenu } = require('./menu');
const capsuleMath = require('./capsule-math');
const sysinfo = require('./sysinfo');

const CAPSULE = { width: 184, height: 56, margin: 24 };
// 资源面板展开参数：卡片 300 宽 + 左右各 6 内边距，与 capsule.css 保持一致
const PANEL_OPTIONS = { panelWidth: 300, edge: 6, gap: 6, capsuleHeight: 44 };
// 悬停 CPU+内存 弹出的「应用占用」卡片更宽（约 320），窗口随之加宽以容纳，避免裁切
const PROC_POPUP_WIDTH = 332;
const PANEL_MIN_HEIGHT = 60;
const PANEL_MAX_HEIGHT = 900;
const MAX_DRAG_MS = 30000; // 兜底：防止异常情况下拖拽循环无法停止

let storage = null;
let capsuleWin = null;
let mainWin = null;
let dragging = null; // { offsetX, offsetY, timer }
let quitting = false;
let collapsedBounds = null; // 面板收起时的窗口矩形（展开时以它为基准，不用 getBounds）
let panelOpen = false;
let panelPinned = false;
let sysMonitor = null;

/* ------------------------- 数据 ------------------------- */
// 一次性迁移：应用由「我的待办」改名「今日毕」后，userData 目录随之变化。
// 首次在新目录运行时，若新 data.json 尚不存在而旧目录有数据，则自动搬过来。
// 旧文件保留不删，作为兜底备份。
function migrateLegacyData(newDataPath) {
  try {
    if (fs.existsSync(newDataPath)) return; // 新目录已有数据，不动
    const appDataDir = app.getPath('appData');
    const legacyNames = ['我的待办', 'gtc-todo']; // 便携版旧名 / 开发模式旧名
    for (const name of legacyNames) {
      const legacyFile = path.join(appDataDir, name, 'data.json');
      if (fs.existsSync(legacyFile)) {
        fs.mkdirSync(path.dirname(newDataPath), { recursive: true });
        fs.copyFileSync(legacyFile, newDataPath);
        console.log('[migrate] 已从旧目录迁移数据:', legacyFile, '->', newDataPath);
        return;
      }
    }
  } catch (e) {
    console.error('[migrate] 迁移失败（不影响启动）:', e && e.message);
  }
}

function initStorage() {
  const dataPath = path.join(app.getPath('userData'), 'data.json');
  migrateLegacyData(dataPath);
  storage = createStorage(dataPath);
  ipcMain.on('data:load', (event) => {
    event.returnValue = storage.load();
  });
  ipcMain.on('data:save', (event, data) => {
    try {
      storage.save(data);
      event.returnValue = true;
    } catch (e) {
      event.returnValue = false;
    }
  });
}

function dataFilePath() {
  return storage && storage.filePath ? storage.filePath : null;
}

/* ------------------------- 桌面胶囊 ------------------------- */
function capsulePosition() {
  const saved = (storage.load().settings || {}).capsulePos;
  return capsuleMath.resolvePosition(saved, screen.getPrimaryDisplay().workArea, CAPSULE);
}

function createCapsuleWindow() {
  const pos = capsulePosition();
  collapsedBounds = { x: pos.x, y: pos.y, width: CAPSULE.width, height: CAPSULE.height };
  capsuleWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: CAPSULE.width,
    height: CAPSULE.height,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    focusable: true,
    title: '桌面胶囊',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-capsule.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  capsuleWin.setAlwaysOnTop(true, 'screen-saver');
  capsuleWin.loadFile(path.join(__dirname, 'renderer', 'capsule.html'));
  capsuleWin.once('ready-to-show', () => {
    capsuleWin.show();
    // 延迟预热进程采集：不拖慢启动，首屏渲染完再建立缓存，让首次悬停即秒显
    const t = setTimeout(warmMonitor, 1200);
    if (t && typeof t.unref === 'function') t.unref();
  });
  capsuleWin.on('closed', () => {
    capsuleWin = null;
  });
  return capsuleWin;
}

function capsuleSummary() {
  try {
    const data = storage.load();
    const todos = data.todos || [];
    const key = capsuleMath.todayKey();
    const todayCount = todos.filter((t) => t.date === key && !t.done).length;
    return { todayCount, undone: todos.filter((t) => !t.done).length };
  } catch (e) {
    return { todayCount: 0, undone: 0 };
  }
}

function sendSummary() {
  if (capsuleWin && !capsuleWin.isDestroyed()) {
    capsuleWin.webContents.send('capsule:summary', capsuleSummary());
  }
}

/* ------------------------- 胶囊资源面板 ------------------------- */
// 鼠标悬停胶囊时：临时把窗口撑大到「胶囊 + 下方资源面板」，移开立即缩回。
// 面板高度由渲染层实测回传；屏幕底部放不下时自动翻到胶囊上方。
function workAreaFor(bounds) {
  try {
    if (typeof screen.getDisplayMatching === 'function') {
      const d = screen.getDisplayMatching(bounds);
      if (d && d.workArea) return d.workArea;
    }
  } catch (e) {}
  return screen.getPrimaryDisplay().workArea;
}

function sendPanelLayout(info) {
  if (capsuleWin && !capsuleWin.isDestroyed()) {
    capsuleWin.webContents.send('capsule:panel-layout', info);
  }
}

// 系统资源采集只在面板展开期间运行，收起即停，不留后台开销。
// 进程采集采用「缓存 + 节流 + 防重入」：面板帧只读缓存，PowerShell 采集降频且不重叠。
function ensureMonitor() {
  if (sysMonitor) return sysMonitor;
  sysMonitor = sysinfo.createSysMonitor({
    // 真实进程级采集（Windows：PowerShell Get-Process），供悬停弹层展示
    listSamples: sysinfo.defaultListSamples,
    // 标记本应用自身进程，弹层中显示「运行中」并高亮
    getSelfPids: function () {
      try {
        return (app.getAppMetrics() || []).map(function (m) {
          return m.pid;
        });
      } catch (e) {
        return [];
      }
    },
  });
  sysMonitor.onUpdate((stats) => {
    if (!panelOpen || !capsuleWin || capsuleWin.isDestroyed()) return;
    capsuleWin.webContents.send('capsule:stats', stats);
  });
  return sysMonitor;
}

function startMonitor() {
  ensureMonitor().start();
}

// 启动后预热一次：建立进程 CPU 基准并填充缓存，用户首次悬停即秒显真实占用
function warmMonitor() {
  const m = ensureMonitor();
  if (m && typeof m.warm === 'function') m.warm();
}

function stopMonitor() {
  if (sysMonitor) sysMonitor.stop();
}

// 立即、可靠地退出：先彻底停采（清定时器 + 杀在途子进程），再走标准退出，
// 并加一道兜底强制退出。解决「点了退出不马上退」：
// 胶囊窗以 closable:false 创建、window-all-closed 又会回显胶囊 → 都会拖住 app.quit()。
let forceQuitTimer = null;
function quitApp() {
  if (quitting) return;
  quitting = true;
  try {
    if (sysMonitor && typeof sysMonitor.dispose === 'function') sysMonitor.dispose();
  } catch (e) {}
  // 兜底：极短宽限后仍未退出则强制退出，保证「点了就退」
  forceQuitTimer = setTimeout(() => {
    forceQuitTimer = null;
    try {
      app.exit(0);
    } catch (e) {}
  }, 900);
  app.quit();
}

function expandCapsulePanel(panelHeight, popupOpen) {
  if (!capsuleWin || capsuleWin.isDestroyed() || !collapsedBounds) return null;
  const raw = Math.round(Number(panelHeight) || 0);
  const h = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, raw));
  // 弹出应用占用卡片时加宽窗口以容纳（卡片约 320 宽）
  const opts = Object.assign({}, PANEL_OPTIONS, {
    panelWidth: popupOpen ? PROC_POPUP_WIDTH : PANEL_OPTIONS.panelWidth,
  });
  const layout = capsuleMath.resolveExpanded(collapsedBounds, workAreaFor(collapsedBounds), h, opts);
  capsuleWin.setBounds(layout.bounds);
  panelOpen = true;
  startMonitor();
  sendPanelLayout({ open: true, place: layout.place, align: layout.align, capsuleInset: layout.capsuleInset });
  return layout;
}

function collapseCapsulePanel() {
  if (!panelOpen && !panelPinned) return false;
  panelOpen = false;
  panelPinned = false;
  stopMonitor();
  if (capsuleWin && !capsuleWin.isDestroyed() && collapsedBounds) {
    capsuleWin.setBounds(collapsedBounds);
  }
  sendPanelLayout({ open: false });
  return true;
}

/* ------------------------- 主窗口 ------------------------- */
function createMainWindow() {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show();
    mainWin.focus();
    return mainWin;
  }
  mainWin = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    title: '今日毕',
    backgroundColor: '#EFF3F9',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 主窗口常被收起/被其他窗口遮挡：关闭后台节流，保证番茄/秒表计时不被降频
      backgroundThrottling: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());

  // 点 X：退回桌面胶囊（不退出进程），除非正在真正退出
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWin.hide();
    if (capsuleWin && !capsuleWin.isDestroyed()) {
      capsuleWin.show();
    }
    sendSummary();
    capsuleWin && capsuleWin.webContents.send('capsule:timer', null);
  });
  mainWin.on('closed', () => {
    mainWin = null;
  });
  return mainWin;
}

function openMainWindow() {
  collapseCapsulePanel(); // 展开主界面时把资源面板一并收起并复位钉住状态
  createMainWindow();
  if (capsuleWin && !capsuleWin.isDestroyed()) capsuleWin.hide();
}

function hideToCapsule() {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.hide();
  }
  if (capsuleWin && !capsuleWin.isDestroyed()) {
    capsuleWin.show();
    sendSummary();
  }
}

function toggleMainWindow() {
  if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) hideToCapsule();
  else openMainWindow();
}

/* ------------------------- 拖拽胶囊（自己实现，兼顾点击） ------------------------- */
function startDragLoop() {
  const win = capsuleWin;
  const startedAt = Date.now();
  dragging.timer = setInterval(() => {
    if (!dragging || win.isDestroyed() || Date.now() - startedAt > MAX_DRAG_MS) return stopDragLoop();
    const cur = screen.getCursorScreenPoint();
    const pos = capsuleMath.nextPosition(dragging.mouse0, cur, dragging.win0);
    if (!dragging.moved) {
      dragging.moved = !capsuleMath.isClick(dragging.mouse0, cur);
    }
    win.setPosition(pos.x, pos.y);
  }, 12);
}

function stopDragLoop() {
  if (dragging && dragging.timer) clearInterval(dragging.timer);
  dragging = null;
}

function endCapsuleDrag(shouldOpen) {
  if (!capsuleWin) return;
  const pos = capsuleWin.getPosition();
  // 拖拽结束后以当前窗口位置作为新的收起态基准
  collapsedBounds = { x: pos[0], y: pos[1], width: CAPSULE.width, height: CAPSULE.height };
  if (dragging && !shouldOpen) {
    saveCapsulePos({ x: pos[0], y: pos[1] });
  }
  stopDragLoop();
}

function saveCapsulePos(pos) {
  try {
    const data = storage.load();
    data.settings = data.settings || {};
    data.settings.capsulePos = pos;
    storage.save(data);
  } catch (e) {}
}

/* ------------------------- IPC ------------------------- */
function initCapsuleIPC() {
  ipcMain.on('capsule:drag-start', () => {
    if (!capsuleWin) return;
    collapseCapsulePanel(); // 拖拽前先收起面板：拖拽必须按收起态坐标计算
    const start = screen.getCursorScreenPoint();
    const p = capsuleWin.getPosition();
    dragging = { mouse0: start, win0: { x: p[0], y: p[1] }, moved: false, timer: null };
    startDragLoop();
  });

  ipcMain.on('capsule:drag-end', (event, payload) => {
    endCapsuleDrag(Boolean(payload && payload.opened));
  });

  ipcMain.on('capsule:open', () => openMainWindow());

  // 资源面板：悬停展开（height 为渲染层实测的面板高度）/ 移开或取消钉住时收起
  // popupOpen：渲染层在 CPU+内存 区域悬停、展开「应用占用」卡片时为 true，窗口随之加宽
  ipcMain.on('capsule:panel', (event, info) => {
    const it = info || {};
    panelPinned = Boolean(it.pinned);
    if (!it.open) return collapseCapsulePanel();
    return expandCapsulePanel(it.height, Boolean(it.popupOpen));
  });

  ipcMain.on('capsule:quit', () => {
    quitApp();
  });

  ipcMain.on('capsule:menu', () => {
    if (!capsuleWin) return;
    const menu = buildCapsuleContextMenu({
      handlers: {
        openMainWindow,
        hideCapsule: hideToCapsule,
        showDataHelp: showDataHelp,
        quit: quitApp,
      },
    }, electronLib);
    menu.popup({ window: capsuleWin });
  });

  // 主窗口 → 胶囊：同步计时状态
  ipcMain.on('timer:update', (event, info) => {
    if (capsuleWin && !capsuleWin.isDestroyed()) {
      capsuleWin.webContents.send('capsule:timer', info || null);
    }
  });

  // 主窗口数据变更后刷新胶囊摘要
  ipcMain.on('data:changed', () => sendSummary());
}

/* ------------------------- 菜单动作 ------------------------- */
function showDataHelp() {
  openMainWindow();
  const file = dataFilePath();
  const msg = '数据保存在：\n' + file + '\n\n把这个文件复制走即可备份，粘回原目录即可恢复。';
  if (mainWin && !mainWin.isDestroyed()) {
    setTimeout(() => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.executeJavaScript('alert(' + JSON.stringify(msg) + ')');
      }
    }, 500);
  }
}

function openDataDir() {
  const file = dataFilePath();
  if (file) shell.showItemInFolder(file);
}

function installMenu() {
  setupAppMenu({
    appName: '今日毕',
    isMac: process.platform === 'darwin',
    handlers: {
      openMainWindow,
      hideToCapsule,
      showCapsule: () => {
        if (capsuleWin && !capsuleWin.isDestroyed()) capsuleWin.show();
      },
      hideCapsule: hideToCapsule,
      toggleAlwaysOnTop: (item) => {
        const on = item && item.checked;
        if (capsuleWin && !capsuleWin.isDestroyed()) capsuleWin.setAlwaysOnTop(Boolean(on), 'screen-saver');
        if (mainWin && !mainWin.isDestroyed()) mainWin.setAlwaysOnTop(Boolean(on));
      },
      openDataDir,
      showDataHelp,
    },
  }, electronLib);
}

/* ------------------------- 生命周期 ------------------------- */
app.whenReady().then(() => {
  initStorage();
  installMenu();
  initCapsuleIPC();
  createCapsuleWindow();
  // 启动时预热进程缓存：建立 CPU 基准并填充 procData，
  // 让用户「第一次」展开面板/悬停时即可秒显真实各应用占用，不必等一轮冷采集。
  warmMonitor();
});

app.on('activate', () => {
  openMainWindow();
});

app.on('before-quit', () => {
  quitting = true;
  // 彻底停采：清定时器 + 杀在途子进程（覆盖菜单 role:'quit' 等不经过 quitApp 的路径）
  try {
    if (sysMonitor && typeof sysMonitor.dispose === 'function') sysMonitor.dispose();
  } catch (e) {}
  // 关键修复：胶囊窗以 closable:false 创建、主窗 close 时会拦截隐藏，
  // 二者都会让 app.quit() 无法关闭窗口而卡住。这里直接 destroy() 强制销毁全部窗口，
  // destroy 会绕过 closable 与 close 拦截，保证退出流程一路走完。
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      try {
        w.destroy();
      } catch (e) {}
    });
  } catch (e) {}
});

app.on('will-quit', () => {
  if (forceQuitTimer) {
    clearTimeout(forceQuitTimer);
    forceQuitTimer = null;
  }
});

app.on('window-all-closed', (e) => {
  // 正在真正退出：放行，别再把胶囊显示回来（否则会取消退出）
  if (quitting) return;
  // 平时：胶囊窗口存在则不退出，只把胶囊显示出来；真正退出走「完全退出」
  if (capsuleWin && !capsuleWin.isDestroyed()) {
    e.preventDefault();
    capsuleWin.show();
    return;
  }
  if (process.platform !== 'darwin') app.quit();
});

module.exports = {
  createCapsuleWindow,
  createMainWindow,
  openMainWindow,
  hideToCapsule,
  toggleMainWindow,
  CAPSULE,
  PANEL_OPTIONS,
  expandCapsulePanel,
  collapseCapsulePanel,
};
