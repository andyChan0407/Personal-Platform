// Phase 10 验收 / 渲染层集成冒烟测试（jsdom，真实 <script> 语义）
// 用 JSDOM.fromFile + runScripts:'dangerously' 按页面真实方式加载全部脚本：
//  - 共享全局作用域（能暴露“顶层标识符跨文件冲突”这类 SyntaxError）
//  - 真实 DOMContentLoaded / load 时序（app.js 的启动路径原样执行）
// preload 侧用真实 storage（临时文件）模拟 electronAPI，由 api-bridge.js 组装 window.api。
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const req = (p) => require(path.join(root, 'src/renderer/js', p));

const { PomodoroTimer } = req('pomodoro.js');
const { createStorage } = req('storage.js');

// 真实持久化到临时文件（验证 storage 真实写回，而非内存假对象）
const tmpFile = path.join(os.tmpdir(), 'pomodoro-smoke-' + Date.now() + '.json');
const storage = createStorage(tmpFile);

const indexPath = path.join(root, 'src/renderer/index.html');
const rawHtml = fs.readFileSync(indexPath, 'utf8');

// 校验脚本顺序：api-bridge 必须先于 app.js
const order = [...rawHtml.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const idxBridge = order.indexOf('api-bridge.js');
const idxApp = order.indexOf('app.js');
assert.ok(idxBridge !== -1, 'index.html 应加载 api-bridge.js');
assert.ok(idxApp !== -1 && idxBridge < idxApp, 'index.html 中 api-bridge.js 必须先于 app.js 加载');

const run = (async () => {
  // 以真实浏览器语义加载页面：脚本由 jsdom 从磁盘按 <script> 标签加载执行
  const dom = await JSDOM.fromFile(indexPath, {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      // preload 侧能力（等价于主进程 data:load / data:save）
      window.electronAPI = {
        load: () => storage.load(),
        save: (d) => storage.save(d),
      };
      window.confirm = () => true; // 删除确认默认通过
      window.alert = () => {};
      if (!window.Notification) window.Notification = function () {};
    },
  });
  const { window } = dom;
  const { document } = window;

  // 等 load 事件：全部脚本已执行、DOMContentLoaded 已触发、首屏已渲染
  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve);
  });

  if (!window.App) throw new Error('app 未初始化：window.App 不存在');
  if (!window.api || !window.api.store) throw new Error('api-bridge 未正确组装 window.api');
  if (!window.api.calendar || !window.api.nav || !window.api.bus) {
    throw new Error('api-bridge 组装不完整（calendar/nav/bus 缺失）');
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // 1) 启动：首页待办可见、其余隐藏、导航高亮
  assert.ok(!$('#view-todo').classList.contains('hidden'), '首页待办视图应可见');
  assert.ok($('#view-pomodoro').classList.contains('hidden'), '番茄视图初始应隐藏');
  assert.ok($('#view-stopwatch').classList.contains('hidden'), '秒表视图初始应隐藏');
  assert.ok($('#view-calendar').classList.contains('hidden'), '日历视图初始应隐藏');
  assert.strictEqual($('.nav-item.active').dataset.view, 'todo', '待办导航应高亮（首页）');
  assert.ok($('#status-bar').classList.contains('hidden'), '计时状态条初始应隐藏');

  // 2) 新建待办（标题 + 日期）
  $('#new-todo').click();
  $('#f-title').value = '写周报';
  $('#f-date').value = '2026-09-20';
  $('#m-save').click();
  assert.strictEqual($$('#view-todo .todo-row').length, 1, '新建后应出现 1 条待办');
  const data = storage.load();
  assert.strictEqual(data.todos.length, 1, '待办应已真实写入存储文件');
  assert.strictEqual(data.todos[0].title, '写周报', '标题正确持久化');
  assert.strictEqual(data.todos[0].date, '2026-09-20', '日期正确持久化');
  assert.strictEqual(data.todos[0].done, false, '新待办未完成');

  // 3) 筛选：已完成应为空，全部应 1 条
  $('#view-todo .filter[data-f="done"]').click();
  assert.strictEqual($$('#view-todo .todo-row').length, 0, '“已完成”筛选应为空');
  $('#view-todo .filter[data-f="all"]').click();
  assert.strictEqual($$('#view-todo .todo-row').length, 1, '“全部”筛选应为 1 条');

  // 4) 勾选完成（首页）
  $('#view-todo .todo-row [data-act="toggle"]').click();
  assert.ok($('#view-todo .todo-row').classList.contains('done'), '勾选后应有 done 样式');
  assert.strictEqual(storage.load().todos[0].done, true, '完成状态应已持久化');

  // 5) 切到日历：当天应有数量圆点；点该日侧栏显示待办
  $('.nav-item[data-view="calendar"]').click();
  assert.ok(!$('#view-calendar').classList.contains('hidden'), '日历视图应可见');
  const cell = $('.cal-cell[data-key="2026-09-20"]');
  assert.ok(cell, '日历应含 2026-09-20 单元格');
  assert.ok(cell.querySelector('.cal-dot'), '该日应有数量圆点');
  assert.ok(cell.querySelector('.cal-count'), '该日应有数量标签');
  cell.click();
  assert.ok($('#view-calendar .cal-side .todo-row'), '侧栏应显示该日待办');

  // 6) 在日历侧栏取消勾选（同源同步）
  $('#view-calendar .cal-side .todo-check').click();
  assert.strictEqual(storage.load().todos[0].done, false, '日历侧栏取消勾选应同步回数据源');

  // 7) 回到待办，删除该条
  $('.nav-item[data-view="todo"]').click();
  $('#view-todo .todo-row [data-act="del"]').click();
  assert.strictEqual($$('#view-todo .todo-row').length, 0, '删除后列表应为空');
  assert.strictEqual(storage.load().todos.length, 0, '删除应已持久化');

  // 8) 日历内点击日期直接新增计划，且同一天支持多笔
  $('.nav-item[data-view="calendar"]').click();
  $('.cal-cell[data-key="2026-09-21"]').click();
  $('#cal-add').click();
  $('#f-title').value = '上午站会';
  $('#m-save').click();
  assert.strictEqual($$('#view-calendar .cal-side .todo-row').length, 1, '新增后侧栏应显示 1 笔计划');
  // 同一天再新增第二笔
  $('#cal-add').click();
  $('#f-title').value = '下午评审';
  $('#m-save').click();
  assert.strictEqual($$('#view-calendar .cal-side .todo-row').length, 2, '同一天应支持多笔计划');
  const dayTodos = storage.load().todos.filter((t) => t.date === '2026-09-21');
  assert.strictEqual(dayTodos.length, 2, '两笔计划都应以 2026-09-21 入库');
  assert.deepStrictEqual(
    dayTodos.map((t) => t.title).sort(),
    ['下午评审', '上午站会'].sort(),
    '两笔计划标题均正确持久化'
  );
  // 数量标签同步为 2
  const cell21 = $('.cal-cell[data-key="2026-09-21"]');
  assert.strictEqual(cell21.querySelector('.cal-count').textContent, '2', '该日数量标签应为 2');
  assert.ok(cell21.querySelector('.cal-dot'), '该日应有数量圆点');
  // 侧栏就地删除一笔
  $('#view-calendar .cal-side [data-act="cal-del"]').click();
  assert.strictEqual($$('#view-calendar .cal-side .todo-row').length, 1, '删除后侧栏应剩 1 笔');
  assert.strictEqual(storage.load().todos.length, 1, '日历内删除应已持久化');

  // 9) 番茄视图渲染且不抛错，初始显示 25:00（由渲染层 window.PomodoroTimer 构造）
  $('.nav-item[data-view="pomodoro"]').click();
  assert.ok(!$('#view-pomodoro').classList.contains('hidden'), '番茄视图应可见');
  assert.ok($('#pomo-time'), '番茄应有计时显示元素');
  assert.strictEqual(
    $('#pomo-time').textContent,
    new PomodoroTimer({ workMin: 25, breakMin: 5 }).display,
    '番茄初始显示应为 25:00'
  );

  // 10) 秒表视图渲染且不抛错，初始显示 00:00.0
  $('.nav-item[data-view="stopwatch"]').click();
  assert.ok(!$('#view-stopwatch').classList.contains('hidden'), '秒表视图应可见');
  assert.ok($('#sw-time'), '秒表应有计时显示元素');
  assert.match($('#sw-time').textContent, /^\d{2}:\d{2}\.\d$/, '秒表初始显示格式应为 MM:SS.d');

  // 关闭 jsdom 实例（防止定时器挂住进程）
  window.close();
  dom.window.close();

  // 清理临时文件
  try { fs.unlinkSync(tmpFile); } catch (e) {}

  console.log('PASS  Phase 10: 渲染层集成冒烟测试（真实脚本语义/API桥/启动/CRUD/筛选/日历联动/番茄/秒表）');
})();

if (require.main === module) {
  run.then(
    () => process.exit(0),
    (e) => {
      console.error('FAIL  phase10_acceptance.test.js: ' + (e && e.message ? e.message : e));
      process.exit(1);
    }
  );
} else {
  module.exports = run; // 供 test/all.js 顺序 await
}
