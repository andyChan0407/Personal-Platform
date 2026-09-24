// Phase 3 测试：框架与导航（nav 纯逻辑）
// 验证默认首页为待办清单、视图切换合法性校验（防非法视图）。
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const nav = require(path.join(root, 'src/renderer/js/nav'));

// 默认首页 = 待办清单
assert.strictEqual(nav.getInitialView(), 'todo', '默认视图应为 todo（待办清单）');

// 合法视图集合
['todo', 'pomodoro', 'stopwatch', 'calendar'].forEach((v) => {
  assert.ok(nav.isValidView(v), v + ' 应为合法视图');
});

// 非法视图
assert.ok(!nav.isValidView('xxx'), 'xxx 不应是合法视图');
assert.ok(!nav.isValidView(''), '空不应是合法视图');

// 切换到合法视图生效
assert.strictEqual(nav.switchView('todo', 'calendar'), 'calendar', '切换到合法视图应生效');

// 切换到非法视图：保持当前视图（兜底，不崩溃）
assert.strictEqual(nav.switchView('todo', 'bad'), 'todo', '非法视图应被忽略并保持当前');
assert.strictEqual(nav.switchView('pomodoro', null), 'pomodoro', 'null 应被忽略');

console.log('PASS  Phase 3: 框架与导航');
