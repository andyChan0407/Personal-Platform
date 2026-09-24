// 预加载脚本：只暴露数据读写 IPC。
// 注意：Electron 20+ 渲染进程默认 sandbox:true，沙箱化 preload 不允许 require 本地文件，
// 因此本文件只 require 'electron'，存储逻辑放在主进程（main.js）。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 同步 IPC：数据量小（本地单个 JSON），同步返回可让渲染层启动逻辑保持简单
  load: () => ipcRenderer.sendSync('data:load'),
  save: (data) => ipcRenderer.sendSync('data:save', data),
  // 计时状态 / 数据变更 → 通知主进程转发给桌面胶囊
  notifyTimer: (info) => ipcRenderer.send('timer:update', info),
  notifyDataChanged: () => ipcRenderer.send('data:changed'),
});
