// Phase 15 测试：三套主题（默认浅色 / 深色 / 毛玻璃）
// ① theme.js 纯逻辑：主题清单、容错归一、切换器标记、应用主题
// ② style.css 三套令牌：块级解析 + 覆盖关系（浅色是默认，dark / glass 逐项覆盖）
// ③ 真实页面语义：切换器挂在主区右上角、点击切换、aria 状态、持久化与"重启后恢复"
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const Theme = require(path.join(root, 'src/renderer/js/theme.js'));
const cssText = fs.readFileSync(path.join(root, 'src/renderer/css/style.css'), 'utf8');
const htmlText = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const indexPath = path.join(root, 'src/renderer/index.html');

/* ============ ① 纯逻辑：清单 / 容错 / 切换器 / 应用 ============ */

assert.deepStrictEqual(Theme.themeIds(), ['light', 'dark', 'glass'], '主题顺序应为 默认 → 深色 → 毛玻璃');
assert.strictEqual(Theme.DEFAULT_THEME, 'light', '默认主题应为浅色');

['light', 'dark', 'glass'].forEach((id) => {
  assert.strictEqual(Theme.normalizeTheme(id), id, '合法主题应原样返回: ' + id);
});
[undefined, null, '', 'neon', 0, 1, {}, [], 'DARK'].forEach((v) => {
  assert.strictEqual(
    Theme.normalizeTheme(v),
    'light',
    '非法主题应回落到默认（注意大小写也属非法）: ' + JSON.stringify(v)
  );
});

// 从整份数据里读取（老数据文件没有 theme 字段）
assert.strictEqual(Theme.readTheme(null), 'light', '无数据时应为默认主题');
assert.strictEqual(Theme.readTheme({}), 'light', '缺 settings 时应为默认主题');
assert.strictEqual(Theme.readTheme({ settings: {} }), 'light', '缺 theme 字段时应为默认主题');
assert.strictEqual(Theme.readTheme({ settings: { theme: 'dark' } }), 'dark', '应读到已保存的主题');
assert.strictEqual(Theme.readTheme({ settings: { theme: 'xxx' } }), 'light', '脏数据应回落默认');

// 切换器标记：三段、顺序固定、内联 SVG（不用 emoji）、带无障碍属性
const sw = Theme.switcherHtml('dark');
const swIds = (sw.match(/data-theme-btn="([^"]+)"/g) || []).map((s) => s.replace(/data-theme-btn="|"/g, ''));
assert.deepStrictEqual(swIds, ['light', 'dark', 'glass'], '切换器顺序应固定为 默认 → 深色 → 毛玻璃');
assert.strictEqual((sw.match(/<button/g) || []).length, 3, '切换器应为 3 个按钮');
assert.strictEqual((sw.match(/<svg/g) || []).length, 3, '每个按钮都应有内联 SVG 图标');
assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sw), '图标应为内联 SVG，不使用 emoji');

const btnTag = (id) => (sw.match(new RegExp('<button[^>]*data-theme-btn="' + id + '"[^>]*>')) || [''])[0];
assert.ok(/theme-btn active/.test(btnTag('dark')), '当前主题对应的按钮应带 active 类');
assert.ok(/aria-checked="true"/.test(btnTag('dark')), '当前主题按钮应 aria-checked=true');
['light', 'glass'].forEach((id) => {
  assert.ok(!/\bactive\b/.test(btnTag(id)), id + ' 不应处于选中态');
  assert.ok(/aria-checked="false"/.test(btnTag(id)), id + ' 应 aria-checked=false');
});
assert.strictEqual((sw.match(/role="radio"/g) || []).length, 3, '按钮应为 radio 角色');
assert.strictEqual((sw.match(/aria-label="/g) || []).length, 3, '每个按钮都要有可读名称');
assert.ok(/title="/.test(sw), '按钮应有 title 提示');

assert.ok(Theme.iconSvg('light').includes('<svg'), 'iconSvg 应返回内联 SVG');
assert.strictEqual(Theme.iconSvg('nope'), '', '未知图标应返回空串而不是抛错');

// 应用到根节点：非法值同样归一
const fakeRoot = { dataset: {} };
assert.strictEqual(Theme.applyTheme('glass', fakeRoot), 'glass');
assert.strictEqual(fakeRoot.dataset.theme, 'glass');
assert.strictEqual(Theme.applyTheme('bogus', fakeRoot), 'light');
assert.strictEqual(fakeRoot.dataset.theme, 'light', '非法主题应把 data-theme 写回 light');
assert.strictEqual(Theme.applyTheme(undefined, fakeRoot), 'light');
assert.strictEqual(Theme.applyTheme('dark', null), 'dark', '没有目标节点时也不应抛错');

/* ============ ② 三套令牌：块级解析 + 覆盖关系 ============ */

function blockOf(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = cssText.match(new RegExp(esc + '\\s*\\{([\\s\\S]*?)\\}'));
  return m ? m[1] : '';
}
function tokenOf(blockText, name) {
  const m = blockText.match(new RegExp('--' + name + '\\s*:\\s*([^;]+);'));
  return m ? m[1].trim() : '';
}
function luminance(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return null;
  const n = parseInt(hex[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const base = blockOf(':root');
const dark = blockOf(':root[data-theme="dark"]');
const glass = blockOf(':root[data-theme="glass"]');

assert.ok(base.length > 200, '浅色基础令牌块应存在（:root）');
assert.ok(dark.length > 200, '缺少深色主题令牌块 :root[data-theme="dark"]');
assert.ok(glass.length > 200, '缺少毛玻璃主题令牌块 :root[data-theme="glass"]');
assert.strictEqual(tokenOf(base, 'wallpaper'), 'none', '非玻璃主题不应有壁纸层');

// 核心色板必须三套都有，且深色/玻璃都覆盖了浅色的值
const CORE = ['bg', 'surface', 'surface-2', 'text', 'text-2', 'text-3', 'border', 'border-strong'];
CORE.forEach((name) => {
  const b = tokenOf(base, name);
  assert.ok(b, '浅色主题缺少令牌 --' + name);
  assert.ok(tokenOf(dark, name), '深色主题缺少令牌 --' + name);
  assert.ok(tokenOf(glass, name), '毛玻璃主题缺少令牌 --' + name);
  assert.notStrictEqual(tokenOf(dark, name), b, '深色主题未覆盖 --' + name);
  assert.notStrictEqual(tokenOf(glass, name), b, '毛玻璃主题未覆盖 --' + name);
});

// 可读性：深色/玻璃的底色要暗、正文要亮（避免"深底深字"）
[
  ['dark', dark],
  ['glass', glass],
].forEach(([name, blk]) => {
  const bgLum = luminance(tokenOf(blk, 'bg'));
  const textLum = luminance(tokenOf(blk, 'text'));
  assert.ok(bgLum !== null, name + ' 主题的 --bg 应为十六进制色值');
  assert.ok(bgLum < 0.25, name + ' 主题底色应足够深，当前亮度 ' + bgLum.toFixed(3));
  assert.ok(textLum !== null, name + ' 主题的 --text 应为十六进制色值');
  assert.ok(textLum > 0.8, name + ' 主题正文应足够亮，当前亮度 ' + textLum.toFixed(3));
});

// 毛玻璃的关键特征：卡片半透明 + 真的有背景模糊 + 自带壁纸
assert.ok(/^rgba\(/.test(tokenOf(glass, 'surface')), '毛玻璃主题的卡片面应是半透明 rgba');
assert.ok(/^rgba\(/.test(tokenOf(glass, 'surface-2')), '毛玻璃主题的次级面应是半透明 rgba');
assert.ok(/gradient\(/.test(tokenOf(glass, 'wallpaper')), '毛玻璃主题应自带壁纸层（渐变）');
assert.ok(/rgba\(255,\s*255,\s*255/.test(tokenOf(glass, 'wallpaper')), '壁纸应含星点（白色高光）');
assert.ok(
  /\[data-theme="glass"\][^{]*\.page-shell[^{]*\{[^}]*backdrop-filter\s*:\s*blur/.test(cssText),
  '毛玻璃主题的主卡片应使用 backdrop-filter 做背景模糊'
);
assert.ok(
  /\[data-theme="glass"\][^{]*\.sidebar[^{]*\{[^}]*backdrop-filter\s*:\s*blur/.test(cssText),
  '毛玻璃主题的侧边栏应使用 backdrop-filter'
);
assert.ok(/body::before[\s\S]{0,120}var\(--wallpaper\)/.test(cssText), '壁纸层应在 body::before 上取 --wallpaper');

// 组件级令牌三套都覆盖了（这些是"写死颜色"的回收点）
[
  'sidebar-bg', 'sidebar-line', 'card-hairline', 'check-border', 'check-bg',
  'input-bg', 'input-focus-bg', 'pill-muted-bg', 'scroll-thumb', 'nav-badge-bg',
  'tip-bg', 'tip-line', 'mask', 'ring-track', 'ring-inset', 'panel-bg', 'body-glow',
].forEach((name) => {
  const b = tokenOf(base, name);
  assert.ok(b, '浅色主题缺少组件令牌 --' + name);
  assert.ok(tokenOf(dark, name), '深色主题缺少组件令牌 --' + name);
  assert.ok(tokenOf(glass, name), '毛玻璃主题缺少组件令牌 --' + name);
  assert.notStrictEqual(tokenOf(dark, name), b, '深色主题未覆盖 --' + name);
  assert.notStrictEqual(tokenOf(glass, name), b, '毛玻璃主题未覆盖 --' + name);
});

// 插画取色也要三套齐备（深色/毛玻璃各一套，浅色为默认）
['empty-fill', 'empty-line', 'empty-bar-1', 'empty-bar-2', 'empty-dot', 'empty-dot-line'].forEach((name) => {
  assert.ok(tokenOf(base, name), '浅色主题缺少插画令牌 --' + name);
  assert.ok(tokenOf(dark, name), '深色主题缺少插画令牌 --' + name);
  assert.ok(tokenOf(glass, name), '毛玻璃主题缺少插画令牌 --' + name);
});

// 行首色条：基础值引用品牌蓝（跟着主题走），毛玻璃单独换成白色
assert.strictEqual(tokenOf(base, 'accent-bar'), 'var(--blue-500)', '行首色条默认应引用品牌蓝');
assert.strictEqual(tokenOf(glass, 'accent-bar'), 'rgba(255, 255, 255, .75)', '毛玻璃主题行首色条应为白色');

// 规则里不应再有"绕开令牌"的写死浅色（空状态插画已改用 var）
assert.ok(!/fill="#(F2F7FD|D8E3F2|D3E1F4|E4EBF6)/.test(cssText), '样式里不应残留写死的插画色');
const todoJs = fs.readFileSync(path.join(root, 'src/renderer/js/ui-todo.js'), 'utf8');
assert.ok(/fill="var\(--empty-fill\)"/.test(todoJs), '空状态插画应改用 CSS 变量取色');
assert.ok(!/#F2F7FD/.test(todoJs), '空状态插画不应残留写死的浅色');

// CSSOM 能解析到三套选择器与切换器样式
const cssDom = new JSDOM('<!doctype html><html><head><style>' + cssText + '</style></head><body></body></html>');
const rules = Array.from(cssDom.window.document.styleSheets[0].cssRules);
const selectors = rules.map((r) => (r.selectorText || '').trim());
['data-theme="dark"', 'data-theme="glass"'].forEach((frag) => {
  assert.ok(selectors.some((s) => s.includes(frag)), '样式表应包含选择器 ' + frag);
});
['.theme-switch', '.theme-btn', '.theme-btn.active', '.topbar'].forEach((sel) => {
  assert.ok(selectors.some((s) => s === sel || s.startsWith(sel)), '缺少样式选择器: ' + sel);
});
cssDom.window.close();

// 切换器必须在卡片之前（右上角），且 index.html 里已按顺序引入 theme.js
assert.ok(/main-inner[\s\S]*topbar[\s\S]*page-shell/.test(htmlText), 'index.html 里工具条应位于卡片之前');
assert.ok(/id="theme-switch"/.test(htmlText), 'index.html 缺少主题切换器容器');
assert.ok(/js\/theme\.js/.test(htmlText), 'index.html 应引入 theme.js');
assert.ok(
  htmlText.indexOf('js/theme.js') < htmlText.indexOf('js/app.js'),
  'theme.js 必须在 app.js 之前加载（app.js 启动时要用到）'
);

/* ============ ③ 页面语义：切换 / 持久化 / 重启恢复 ============ */

const { createStorage } = require(path.join(root, 'src/renderer/js/storage.js'));
const tmpFile = path.join(os.tmpdir(), 'theme-' + Date.now() + '.json');
const storage = createStorage(tmpFile);

async function boot() {
  const dom = await JSDOM.fromFile(indexPath, {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.electronAPI = {
        load: () => storage.load(),
        save: (d) => storage.save(d),
        notifyTimer: () => {},
        notifyDataChanged: () => {},
      };
      window.confirm = () => true;
      window.alert = () => {};
      if (!window.Notification) window.Notification = function () {};
    },
  });
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
  });
  return dom;
}

const run = (async () => {
  storage.save({ todos: [], settings: { workMin: 25, breakMin: 5 } });

  let dom = await boot();
  let doc = dom.window.document;

  // 位置：主区顶部工具条内、卡片之前
  const swEl = doc.getElementById('theme-switch');
  assert.ok(swEl, '页面应有 #theme-switch');
  const topbar = swEl.closest('.topbar');
  assert.ok(topbar, '切换器应放在 .topbar 工具条里');
  assert.ok(topbar.closest('.main-inner'), '工具条应属于主内容区');
  assert.deepStrictEqual(
    Array.from(topbar.parentElement.children).map((n) => n.className),
    ['topbar', 'page-shell'],
    '工具条应排在卡片之前'
  );
  assert.strictEqual(swEl.getAttribute('role'), 'radiogroup', '容器应声明 radiogroup');

  // 默认主题 + 三段顺序
  assert.strictEqual(doc.documentElement.dataset.theme, 'light', '默认应为浅色主题');
  assert.deepStrictEqual(
    Array.from(doc.querySelectorAll('[data-theme-btn]')).map((b) => b.dataset.themeBtn),
    ['light', 'dark', 'glass'],
    '切换器应渲染出三个主题按钮'
  );
  assert.ok(doc.querySelector('[data-theme-btn="light"]').classList.contains('active'), '默认按钮应选中');

  // 切到深色
  doc.querySelector('[data-theme-btn="dark"]').click();
  assert.strictEqual(doc.documentElement.dataset.theme, 'dark', '点击后应切到深色主题');
  assert.strictEqual(storage.load().settings.theme, 'dark', '主题应写入数据文件');
  assert.ok(doc.querySelector('[data-theme-btn="dark"]').classList.contains('active'), '深色按钮应变成选中态');
  assert.strictEqual(doc.querySelector('[data-theme-btn="dark"]').getAttribute('aria-checked'), 'true');
  assert.strictEqual(doc.querySelector('[data-theme-btn="light"]').getAttribute('aria-checked'), 'false');
  assert.strictEqual(doc.querySelectorAll('.theme-btn.active').length, 1, '同一时刻只应有一个选中');

  // 切到毛玻璃
  doc.querySelector('[data-theme-btn="glass"]').click();
  assert.strictEqual(doc.documentElement.dataset.theme, 'glass', '点击后应切到毛玻璃主题');
  assert.strictEqual(storage.load().settings.theme, 'glass', '毛玻璃主题应持久化');
  assert.strictEqual(doc.querySelectorAll('.theme-btn.active').length, 1, '同一时刻只应有一个选中');

  dom.window.close();
  dom.window.close();

  // 重启后恢复上次选择
  let dom2 = await boot();
  assert.strictEqual(
    dom2.window.document.documentElement.dataset.theme,
    'glass',
    '重启后应恢复上次选择的主题'
  );
  assert.ok(
    dom2.window.document.querySelector('[data-theme-btn="glass"]').classList.contains('active'),
    '重启后切换器应高亮上次选择的主题'
  );
  dom2.window.close();

  // 老数据文件（没有 theme 字段）→ 回落默认，不报错
  storage.save({ todos: [], settings: { workMin: 25, breakMin: 5 } });
  const dom3 = await boot();
  assert.strictEqual(dom3.window.document.documentElement.dataset.theme, 'light', '旧数据应回落到浅色主题');
  dom3.window.close();

  // 脏数据（非法主题值）→ 同样回落默认
  storage.save({ todos: [], settings: { workMin: 25, breakMin: 5, theme: 'neon' } });
  const dom4 = await boot();
  assert.strictEqual(dom4.window.document.documentElement.dataset.theme, 'light', '非法主题值应回落浅色主题');
  assert.strictEqual(storage.load().settings.theme, 'neon', '读取时不应篡改原值（归一发生在使用时）');
  dom4.window.close();

  try { fs.unlinkSync(tmpFile); } catch (e) {}

  console.log('PASS  Phase 15: 三套主题（令牌覆盖/容错归一/右上角切换器/持久化与重启恢复）');
})();

if (require.main === module) {
  run.then(
    () => process.exit(0),
    (e) => {
      console.error('FAIL  phase15_theme.test.js: ' + (e && e.message ? e.message : e));
      process.exit(1);
    }
  );
} else {
  module.exports = run; // 供 test/all.js 顺序 await
}
