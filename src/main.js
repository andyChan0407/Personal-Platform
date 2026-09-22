// Electron 主进程：桌面胶囊悬浮窗 + 主功能窗口 + 数据读写 IPC + 中文菜单。
const electronLib = require('electron');
const { app, BrowserWindow, ipcMain, shell, screen } = electronLib;
const path = require('path');
const { createStorage } = require('./renderer/js/storage');
const { setupAppMenu, buildCapsuleContextMenu } = require('./menu');
const capsuleMath = require('./capsule-math');
const sysinfo = require('./sysinfo');

const CAPSULE = { width: 184, height: 56, margin: 24 };
// 资源面板展开参数：卡片 300 宽 + 左右各 6 内边距，与 capsule.css 保持一致
const PANEL_OPTIONS = { panelWidth: 300, edge: 6, gap: 6, capsuleHeight: 44 };
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
function initStorage() {
  const dataPath = path.join(app.getPath('userData'), 'data.json');
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
  capsuleWin.once('ready-to-show', () => capsuleWin.show());
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

// 系统资源采集只在面板展开期间运行，收起即停，不留后台开销
function startMonitor() {
  if (!sysMonitor) {
    sysMonitor = sysinfo.createSysMonitor();
    sysMonitor.onUpdate((stats) => {
      if (!panelOpen || !capsuleWin || capsuleWin.isDestroyed()) return;
      capsuleWin.webContents.send('capsule:stats', stats);
    });
  }
  sysMonitor.start();
}

function stopMonitor() {
  if (sysMonitor) sysMonitor.stop();
}

function expandCapsulePanel(panelHeight) {
  if (!capsuleWin || capsuleWin.isDestroyed() || !collapsedBounds) return null;
  const raw = Math.round(Number(panelHeight) || 0);
  const h = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, raw));
  const layout = capsuleMath.resolveExpanded(collapsedBounds, workAreaFor(collapsedBounds), h, PANEL_OPTIONS);
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
    title: '我的待办',
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
  ipcMain.on('capsule:panel', (event, info) => {
    const it = info || {};
    panelPinned = Boolean(it.pinned);
    if (!it.open) return collapseCapsulePanel();
    return expandCapsulePanel(it.height);
  });

  ipcMain.on('capsule:quit', () => {
    quitting = true;
    app.quit();
  });

  ipcMain.on('capsule:menu', () => {
    if (!capsuleWin) return;
    const menu = buildCapsuleContextMenu({
      handlers: {
        openMainWindow,
        hideCapsule: hideToCapsule,
        showDataHelp: showDataHelp,
        quit: () => {
          quitting = true;
          app.quit();
        },
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
    appName: '我的待办',
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
});

app.on('activate', () => {
  openMainWindow();
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', (e) => {
  // 胶囊窗口存在时不退出；真正退出走「完全退出」
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
