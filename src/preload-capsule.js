// 桌面胶囊预加载：只暴露胶囊需要的 IPC 能力。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capsuleBridge', {
  openMain: () => ipcRenderer.send('capsule:open'),
  dragStart: () => ipcRenderer.send('capsule:drag-start'),
  dragEnd: (opened) => ipcRenderer.send('capsule:drag-end', { opened: !!opened }),
  showMenu: () => ipcRenderer.send('capsule:menu'),
  quit: () => ipcRenderer.send('capsule:quit'),
  onTimer: (cb) => ipcRenderer.on('capsule:timer', (_e, info) => cb(info)),
  onSummary: (cb) => ipcRenderer.on('capsule:summary', (_e, info) => cb(info)),
  // 资源面板展开/收起：带上实测面板高度，主进程据此扩窗
  setPanel: (info) => ipcRenderer.send('capsule:panel', info || {}),
  // 主进程回传面板最终布局：显示在胶囊上方还是下方、胶囊在窗口内的对齐方式
  onPanelLayout: (cb) => ipcRenderer.on('capsule:panel-layout', (_e, info) => cb(info)),
  // 主进程按需推送的系统资源快照（CPU / 内存 / 磁盘）
  onStats: (cb) => ipcRenderer.on('capsule:stats', (_e, info) => cb(info)),
});
