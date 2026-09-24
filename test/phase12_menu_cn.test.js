// Phase 12 测试：菜单栏中文化（问题2）
// 校验：菜单模板全部为中文；常见英文菜单词（File/Edit/View…）不再出现；
//       菜单在应用启动时被真实安装（用伪 electron 主-risk-free 跑一遍 setupAppMenu）；click 处理器可用。
const path = require('path');
const Module = require('module');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const { buildMenuTemplate } = require(path.join(root, 'src/menu.js'));

const CJK = /[\u4e00-\u9fa5]/;
const ENGLISH_MENU_WORDS = ['File', 'Edit', 'View', 'Window', 'Help', 'Quit', 'Undo', 'Redo', 'Copy', 'Paste', 'Select All', 'Reload', 'Minimize', 'Zoom', 'Toggle Developer Tools', 'Toggle Full Screen', 'Close Window'];

// 递归收集所有菜单项（含子菜单）
function collect(items) {
  const out = [];
  (items || []).forEach((it) => {
    if (it.type === 'separator') return; // 分隔线无文案，跳过（继续遍历后续项）
    out.push(it);
    if (it.submenu) collect(it.submenu).forEach((x) => out.push(x));
  });
  return out;
}

/* ---------- ① Windows / Linux 模板 ---------- */
const handlersCalled = [];
const winTemplate = buildMenuTemplate({
  appName: '今日毕',
  isMac: false,
  handlers: {
    openMainWindow: () => handlersCalled.push('openMainWindow'),
    hideToCapsule: () => handlersCalled.push('hideToCapsule'),
    openDataDir: () => handlersCalled.push('openDataDir'),
    showDataHelp: () => handlersCalled.push('showDataHelp'),
    showCapsule: () => handlersCalled.push('showCapsule'),
    hideCapsule: () => handlersCalled.push('hideCapsule'),
    toggleAlwaysOnTop: () => handlersCalled.push('toggleAlwaysOnTop'),
  },
});

assert.strictEqual(winTemplate.length, 5, 'Windows 菜单应有 5 个顶级菜单');
assert.deepStrictEqual(
  winTemplate.map((m) => m.label),
  ['文件(&F)', '编辑(&E)', '视图(&V)', '窗口(&W)', '帮助(&H)'],
  '顶级菜单标签应为中文'
);

// 所有条目要么中文、要么是分隔符；且不含任何英文菜单词汇
const winItems = collect(winTemplate);
winItems.forEach((it) => {
  if (it.separator) return;
  assert.ok(it.label && CJK.test(it.label), '菜单项未中文化: ' + JSON.stringify(it.label));
  ENGLISH_MENU_WORDS.forEach((w) => {
    assert.ok(!String(it.label).includes(w), '菜单项残留英文 “' + w + '”: ' + it.label);
  });
});

// 关键条目存在
const flatLabels = winItems.map((i) => i.label).join('|');
['显示主窗口', '隐藏到桌面胶囊', '隐藏桌面胶囊', '打开数据目录', '退出', '撤销', '重做', '剪切', '复制', '粘贴', '全选', '重新加载', '切换全屏', '关于'].forEach((zh) => {
  assert.ok(flatLabels.includes(zh), '缺少菜单项: ' + zh);
});

/* ---------- ② macOS 模板（应用菜单同样中文） ---------- */
const macTemplate = buildMenuTemplate({ appName: '今日毕', isMac: true });
assert.strictEqual(macTemplate.length, 6, 'macOS 应多出一条应用菜单');
assert.strictEqual(macTemplate[0].label, '今日毕', 'macOS 首个菜单应显示应用中文名');
collect(macTemplate).forEach((it) => {
  if (it.separator) return;
  assert.ok(CJK.test(it.label), 'macOS 菜单项未中文化: ' + it.label);
});

/* ---------- ③ 菜单项可点击、绑定正确 ---------- */
const openItem = collect(winTemplate).find((i) => i.label === '显示主窗口');
assert.ok(openItem && typeof openItem.click === 'function', '“显示主窗口”应可点击');
openItem.click({}, null);
assert.deepStrictEqual(handlersCalled, ['openMainWindow'], '点击后应调用注入的 openMainWindow');

const helpItem = collect(winTemplate).find((i) => i.label === '备份与数据说明');
helpItem.click({}, null);
assert.ok(handlersCalled.includes('showDataHelp'), '“备份与数据说明”应触发 showDataHelp');

/* ---------- ④ 启动时真实安装（伪 electron） ---------- */
const mainSrc = require('fs').readFileSync(path.join(root, 'src/main.js'), 'utf8');
assert.ok(/setupAppMenu\(/.test(mainSrc), 'main.js 应调用 setupAppMenu 安装中文菜单');
assert.ok(/require\('\.\/menu'\)|require\("\.\/menu"\)/.test(mainSrc), 'main.js 应引入 ./menu');
assert.ok(/installMenu\(\)/.test(mainSrc), 'main.js 应在 ready 后调用 installMenu()');
assert.ok(!/Menu\.setApplicationMenu\(\)/.test(mainSrc), '不应仅清空菜单（否则仍是系统默认英文菜单）');

const installed = [];
const fakeElectron = {
  Menu: {
    buildFromTemplate: (tpl) => ({ template: tpl, popup: () => {} }),
    setApplicationMenu: (m) => installed.push(m),
  },
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return fakeElectron;
  return origLoad.apply(this, arguments);
};
try {
  const { setupAppMenu } = require(path.join(root, 'src/menu.js'));
  setupAppMenu({ appName: '今日毕', isMac: false, handlers: {} });
} finally {
  Module._load = origLoad;
}
assert.strictEqual(installed.length, 1, '应调用一次 Menu.setApplicationMenu');
const tpl = installed[0].template;
assert.strictEqual(tpl.length, 5, '安装到应用的菜单应含 5 个顶级菜单');
collect(tpl).forEach((it) => {
  if (it.separator) return;
  assert.ok(CJK.test(it.label), '实际安装的菜单项未中文化: ' + it.label);
});

/* ---------- ⑤ 胶囊右键菜单同样中文 ---------- */
let capsuleMenuTpl = null;
const fakeElectron2 = {
  Menu: {
    buildFromTemplate: (t) => {
      capsuleMenuTpl = t;
      return { popup: () => {} };
    },
  },
};
Module._load = function (request) {
  if (request === 'electron') return fakeElectron2;
  return origLoad.apply(this, arguments);
};
try {
  const { buildCapsuleContextMenu } = require(path.join(root, 'src/menu.js'));
  buildCapsuleContextMenu({ handlers: { openMainWindow: () => {} } });
} finally {
  Module._load = origLoad;
}
assert.ok(capsuleMenuTpl, '胶囊右键菜单应可构建');
assert.strictEqual(typeof capsuleMenuTpl[0].click, 'function', '右键菜单项应可点击');
collect(capsuleMenuTpl).forEach((it) => {
  assert.ok(CJK.test(it.label), '胶囊右键菜单未中文化: ' + it.label);
});
assert.ok(
  collect(capsuleMenuTpl).some((i) => i.label === '完全退出'),
  '胶囊右键菜单应提供“完全退出”'
);

console.log('PASS  Phase 12: 菜单栏全中文（顶级/子菜单/右键入口 + 启动时真实安装）');
