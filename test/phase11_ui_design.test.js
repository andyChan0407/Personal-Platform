// Phase 11 测试：界面视觉设计（问题1）
// 校验三部分：① 设计系统令牌与样式规则真实生效（CSSOM 解析验证，而非纯文本）
//            ② 页面结构升级（品牌区 / 图标导航 / 卡片容器 / 空状态插画）
//            ③ 交互联动仍完整（新增待办后侧边栏徽标更新、番茄进度环渲染）
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const cssText = fs.readFileSync(path.join(root, 'src/renderer/css/style.css'), 'utf8');
const htmlText = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');

/* ---------- ① CSSOM：样式能被浏览器解析，且设计要素齐备 ---------- */
const cssDom = new JSDOM(`<!doctype html><html><head><style>${cssText}</style></head><body></body></html>`);
const sheet = cssDom.window.document.styleSheets[0];
assert.ok(sheet, 'style.css 未能被解析为样式表');
const rules = Array.from(sheet.cssRules);
assert.ok(rules.length > 40, '样式规则数量过少，疑似未完整应用新设计：' + rules.length);

// 收集每条规则的选择器与 cssText
const ruleInfo = rules.map((r) => ({
  selector: (r.selectorText || '').trim(),
  css: r.cssText || '',
}));

const hasToken = (name) => new RegExp('\\s*' + name + '\\s*:').test(cssText);
['--shadow-sm', '--shadow-md', '--shadow-lg', '--grad-brand', '--r-pill', '--ease', '--blue', '--tomato'].forEach((t) => {
  assert.ok(hasToken(t), '缺少设计令牌: ' + t);
});

const withSelector = (sel) => ruleInfo.filter((r) => r.selector.includes(sel));

// 关键视觉组件必须有规则覆盖
[
  '.brand-logo', '.nav-item.active', '.nav-badge', '.page-shell', '.todo-row',
  '.todo-check.done', '.timer-ring', '.timer-panel', '.cal-cell.today', '.modal-mask', '.empty',
].forEach((sel) => {
  const found = withSelector(sel).some((r) => r.selector === sel || r.selector.startsWith(sel));
  assert.ok(found, '缺少样式选择器: ' + sel);
});

// 过渡动效：至少 6 条规则带 transition
const transnRules = ruleInfo.filter((r) => r.css.includes('transition'));
assert.ok(transnRules.length >= 6, '交互元素缺少 transition 动效，当前 ' + transnRules.length + ' 条');
// 悬停反馈：hover 规则足够多
const hoverRules = ruleInfo.filter((r) => r.selector.includes(':hover'));
assert.ok(hoverRules.length >= 8, '缺少鼠标悬停反馈，hover 规则仅 ' + hoverRules.length + ' 条');
// 键盘可达性：聚焦态
assert.ok(
  ruleInfo.some((r) => r.selector.includes(':focus')),
  '缺少 :focus / :focus-visible 键盘聚焦样式'
);
// 阴影与渐变（走 CSSOM 文本，避免被具体实现裁剪）
const shadowCount = (cssText.match(/box-shadow:/g) || []).length;
const gradientCount = (cssText.match(/gradient\(/g) || []).length;
assert.ok(shadowCount >= 12, '缺少层次阴影，box-shadow 仅 ' + shadowCount + ' 处');
assert.ok(gradientCount >= 6, '缺少渐变层次，gradient 仅 ' + gradientCount + ' 处');
// 关键帧动画 + 无障碍降级
assert.ok(/@keyframes\s+[\w-]+/.test(cssText), '缺少 @keyframes 动画');
assert.ok(/prefers-reduced-motion/.test(cssText), '缺少 prefers-reduced-motion 动效降级');

// 日历应为「左月历 + 右侧栏」并列布局（窄屏才折行），且窄屏有降级
const calWrapRule = withSelector('.cal-wrap').map((r) => r.css).join(' ');
assert.ok(/grid-template-columns/.test(calWrapRule), '.cal-wrap 应使用两列网格排布月历与侧栏');
assert.ok(/@media/.test(cssText), '缺少响应式断点');

/* ---------- ② 页面结构升级 ---------- */
assert.ok(/class="brand"/.test(htmlText), '侧边栏缺少品牌区');
assert.ok(/brand-logo/.test(htmlText), '缺少品牌标识');
assert.ok(/brand-sub/.test(htmlText), '缺少品牌副标题');
assert.ok(/class="page-shell"/.test(htmlText), '主区缺少卡片容器 page-shell');

// page-shell 必须包住 4 个视图
const shellBody = htmlText.slice(htmlText.indexOf('page-shell'));
['view-todo', 'view-pomodoro', 'view-stopwatch', 'view-calendar'].forEach((v) => {
  assert.ok(shellBody.includes(v), 'page-shell 未包含 ' + v);
});

// 导航图标 + 徽标
const navIcons = (htmlText.match(/class="nav-icon"/g) || []).length;
assert.strictEqual(navIcons, 4, '4 个导航项都应有图标，当前 ' + navIcons);
assert.ok(htmlText.includes('id="nav-todo-badge"'), '缺少未完成数量徽标');
assert.ok(/<svg/.test(htmlText), '图标应使用内联 SVG（离线可用，不依赖字体/网络）');

// 计时状态条仍在侧边栏底部
assert.ok(htmlText.includes('id="status-bar"'), '缺少计时状态条');
assert.ok(/sidebar-foot[\s\S]*status-bar/.test(htmlText), '状态条应位于侧边栏底部 sidebar-foot 内');

cssDom.window.close();

/* ---------- ③ 结构与联动（真实脚本语义） ---------- */
const { createStorage } = require(path.join(root, 'src/renderer/js/storage.js'));
const tmpFile = path.join(os.tmpdir(), 'ui-design-' + Date.now() + '.json');
const storage = createStorage(tmpFile);
const indexPath = path.join(root, 'src/renderer/index.html');

const run = (async () => {
  const dom = await JSDOM.fromFile(indexPath, {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.electronAPI = { load: () => storage.load(), save: (d) => storage.save(d) };
      window.confirm = () => true;
      window.alert = () => {};
      if (!window.Notification) window.Notification = function () {};
    },
  });
  const { window } = dom;
  const { document } = window;
  await new Promise((resolve) => {
    if (document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve);
  });

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // 空状态插画（不是干巴巴一句文字）
  assert.ok($('#view-todo .empty svg'), '待办空状态应包含插画');
  // 初始无待办，徽标隐藏
  const badge = $('#nav-todo-badge');
  assert.ok(badge.classList.contains('hidden'), '无待办时徽标应隐藏');

  // 新建 2 条 → 徽标显示 2
  $('#new-todo').click();
  $('#f-title').value = '设计重构';
  $('#f-date').value = '2026-09-20';
  $('#m-save').click();
  $('#new-todo').click();
  $('#f-title').value = '编写测试';
  $('#f-date').value = '2026-09-20';
  $('#m-save').click();
  assert.strictEqual($$('#view-todo .todo-row').length, 2, '应有 2 条待办');
  assert.strictEqual(badge.textContent, '2', '侧边栏徽标应显示未完成数 2');
  assert.ok(!badge.classList.contains('hidden'), '有待办时徽标应显示');

  // 行结构：包含文本容器与备注槽位
  assert.ok($('#view-todo .todo-row .todo-main .todo-title'), '待办行应使用 todo-main 容器');

  // 完成一条 → 徽标减到 1
  $('#view-todo .todo-row [data-act="toggle"]').click();
  assert.strictEqual(badge.textContent, '1', '勾选完成后徽标应变为 1');

  // 番茄：进度环渲染且百分比可更新
  $('.nav-item[data-view="pomodoro"]').click();
  const ring = $('#pomo-ring');
  assert.ok(ring, '番茄视图应有进度环 #pomo-ring');
  assert.ok(ring.classList.contains('timer-ring'), '进度环应使用 timer-ring 样式');
  assert.ok($('#pomo-ring .timer-big#pomo-time'), '大号时间应位于进度环内部');
  assert.ok($('#pomo-ring .timer-ring-inner'), '进度环应含内层容器');

  // 秒表：采用数字面板
  $('.nav-item[data-view="stopwatch"]').click();
  assert.ok($('.timer-panel #sw-time'), '秒表应使用 timer-panel 数字面板');

  // 日历：侧栏行结构与之行一致
  $('.nav-item[data-view="calendar"]').click();
  $('.cal-cell[data-key="' + (storage.load().todos.find((t) => !t.done).date) + '"]').click();
  assert.ok($('.cal-side .todo-row .todo-main'), '日历侧栏行应保持一致的卡片结构');

  window.close();
  dom.window.close();
  try { fs.unlinkSync(tmpFile); } catch (e) {}

  console.log('PASS  Phase 11: 界面视觉设计（设计令牌/层次阴影/动效/卡片容器/图标导航/徽标联动/进度环）');
})();

if (require.main === module) {
  run.then(
    () => process.exit(0),
    (e) => {
      console.error('FAIL  phase11_ui_design.test.js: ' + (e && e.message ? e.message : e));
      process.exit(1);
    }
  );
} else {
  module.exports = run; // 供 test/all.js 顺序 await
}
