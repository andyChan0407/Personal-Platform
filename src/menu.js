// 应用菜单（全中文）。
// 模板是纯数据，便于单元测试；安装动作在 main.js 启动时调用 setupAppMenu()。
// handlers：由主进程注入的具体行为（显示主窗口 / 隐藏到胶囊 / 打开数据目录 等）
function buildMenuTemplate({ appName = '今日毕', isMac = false, handlers = {} } = {}) {
  const call = (name) => () => {
    const fn = handlers[name];
    if (typeof fn === 'function') fn();
  };

  const appMenu = isMac
    ? [
        {
          label: appName,
          submenu: [
            { label: `关于 ${appName}`, role: 'about' },
            { type: 'separator' },
            { label: '隐藏窗口', role: 'hide' },
            { label: '隐藏其他窗口', role: 'hideOthers' },
            { label: '显示全部窗口', role: 'unhide' },
            { type: 'separator' },
            { label: `退出 ${appName}`, role: 'quit' },
          ],
        },
      ]
    : [];

  return [
    ...appMenu,
    {
      label: '文件(&F)',
      submenu: [
        { label: '显示主窗口', accelerator: 'CmdOrCtrl+O', click: call('openMainWindow') },
        { label: '隐藏到桌面胶囊', accelerator: 'CmdOrCtrl+W', click: call('hideToCapsule') },
        { type: 'separator' },
        { label: '打开数据目录', click: call('openDataDir') },
        { type: 'separator' },
        ...(isMac ? [] : [{ label: `退出 ${appName}`, role: 'quit' }]),
      ],
    },
    {
      label: '编辑(&E)',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '删除', role: 'delete' },
        { type: 'separator' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: '视图(&V)',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切换全屏', accelerator: 'F11', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口(&W)',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: '关闭窗口', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' },
        { type: 'separator' },
        { label: '显示桌面胶囊', click: call('showCapsule') },
        { label: '隐藏桌面胶囊', click: call('hideCapsule') },
        { type: 'separator' },
        { label: '窗口置顶', type: 'checkbox', checked: false, click: call('toggleAlwaysOnTop') },
      ],
    },
    {
      label: '帮助(&H)',
      submenu: [
        ...(isMac ? [] : [{ label: `关于 ${appName}`, role: 'about' }]),
        { label: '备份与数据说明', click: call('showDataHelp') },
        { label: '退出到桌面胶囊', click: call('hideToCapsule') },
      ],
    },
  ];
}

// 安装应用菜单。electron 模块可由调用方注入（便于在 Node 测试中替换）
function setupAppMenu(options = {}, electron) {
  const { Menu } = electron || require('electron');
  const template = buildMenuTemplate(options);
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

// 胶囊右键菜单（同样中文化）。返回 Menu 实例，由主进程 popup
function buildCapsuleContextMenu(args, electron) {
  const { Menu } = electron || require('electron');
  const handlers = (args && args.handlers) || {};
  const call = (name) => () => {
    const fn = handlers[name];
    if (typeof fn === 'function') fn();
  };
  return Menu.buildFromTemplate([
    { label: '打开主界面', click: call('openMainWindow') },
    { label: '隐藏胶囊', click: call('hideCapsule') },
    { type: 'separator' },
    { label: '关于本应用', click: call('showDataHelp') },
    { type: 'separator' },
    { label: '完全退出', click: call('quit') },
  ]);
}

module.exports = { buildMenuTemplate, setupAppMenu, buildCapsuleContextMenu };
