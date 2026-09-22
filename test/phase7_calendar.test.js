// Phase 7 测试：日历逻辑
// 覆盖 PRD 验收 2（日期数量圆点来源）、8（月视图正确、今天高亮）及翻月的数据基础。
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const cal = require(path.join(root, 'src/renderer/js/calendar'));
const store = require(path.join(root, 'src/renderer/js/store'));

// 2026-09：共 30 天，9 月 1 日是周二 → 周一为每周起始时第一天前留 1 个空格
const grid = cal.buildMonthGrid(2026, 8); // month 0-based = 8
assert.strictEqual(grid.year, 2026);
assert.strictEqual(grid.month, 8);
assert.strictEqual(grid.weeks.length, 5, '9 月应排成 5 周');
assert.strictEqual(grid.weeks[0][0], null, '首格应为空格（周一前）');
assert.strictEqual(grid.weeks[0][1], 1, '第二个格子应为 1 号');
assert.strictEqual(grid.weeks[4][2], 30, '最后一天 30 号应在第 5 周第 3 格');
// 9 月无 31 号
let has31 = grid.weeks.some((w) => w.includes(31));
assert.ok(!has31, '9 月不应出现 31 号');

// 1 月 2026：31 天，1 月 1 日周四 → 周一前留 3 空格
const jan = cal.buildMonthGrid(2026, 0);
assert.strictEqual(jan.weeks[0][0], null);
assert.strictEqual(jan.weeks[0][3], 1, '1 号应在第 4 格');
let has31jan = jan.weeks.some((w) => w.includes(31));
assert.ok(has31jan, '1 月应有 31 号');

// dayKey 格式
assert.strictEqual(cal.dayKey(2026, 8, 14), '2026-09-14');
assert.strictEqual(cal.dayKey(2026, 0, 5), '2026-01-05');

// isToday：用今天构造应返回 true；用过去日期应返回 false
const now = new Date();
assert.strictEqual(cal.isToday(now.getFullYear(), now.getMonth(), now.getDate()), true, '今天应被识别');
assert.strictEqual(cal.isToday(2020, 0, 1), false, '过去日期不应是今天');

// 按日期聚合 → 日历圆点数量来源
let todos = [];
todos = store.addTodo(todos, { title: 'A', date: '2026-09-14' });
todos = store.addTodo(todos, { title: 'B', date: '2026-09-14' });
todos = store.addTodo(todos, { title: 'C', date: '2026-09-20' });
todos = store.addTodo(todos, { title: 'D' }); // 未排期
const grouped = cal.groupByDate(todos);
assert.strictEqual(grouped['2026-09-14'].length, 2, '9-14 应有 2 条（圆点数量）');
assert.strictEqual(grouped['2026-09-20'].length, 1, '9-20 应有 1 条');
assert.ok(!grouped['__none__'], '未排期不应出现在日历聚合');

console.log('PASS  Phase 7: 日历逻辑');
