// Phase 4 测试：待办清单模块（数据契约与清单↔日历联动）
// 覆盖 PRD 验收 2（新建+日历圆点）、3（完成/取消）、4（编辑/删除）、5（筛选/搜索）。
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const store = require(path.join(root, 'src/renderer/js/store'));
const { groupByDate } = require(path.join(root, 'src/renderer/js/store'));

// 模拟 UI 持有的 todos 数组与保存动作
let todos = [];

// 1) 新建待办（标题必填）
todos = store.addTodo(todos, { title: '整理季度汇报材料', date: '2026-09-14' });
const created = todos[0];
assert.strictEqual(todos.length, 1, '新建后应出现一项');

// 2) 填了日期 → 日历对应日显示（聚合数量）
const grouped = groupByDate(todos);
assert.strictEqual(grouped['2026-09-14'].length, 1, '带日期待办应聚合到该日（日历圆点来源）');

// 3) 完成 / 取消
todos = store.toggleDone(todos, created.id);
assert.strictEqual(store.filterByStatus(todos, 'done').length, 1, '完成后应在“已完成”下看到');
todos = store.toggleDone(todos, created.id);
assert.strictEqual(store.filterByStatus(todos, 'active').length, 1, '取消后回到未完成');

// 4) 编辑（标题/日期/备注）
todos = store.updateTodo(todos, created.id, { title: '整理月度汇报', date: '2026-09-20', note: '含图表' });
const edited = todos.find((t) => t.id === created.id);
assert.strictEqual(edited.title, '整理月度汇报');
assert.strictEqual(edited.date, '2026-09-20');
assert.strictEqual(edited.note, '含图表');
// 编辑日期后，旧日无、新日有
const g2 = groupByDate(todos);
assert.ok(!g2['2026-09-14'], '旧日期应不再有该待办');
assert.strictEqual(g2['2026-09-20'].length, 1, '新日期应有该待办');

// 5) 删除 → 列表与日历同时消失
todos = store.deleteTodo(todos, created.id);
assert.strictEqual(todos.length, 0, '删除后列表为空');
assert.deepStrictEqual(groupByDate(todos), {}, '删除后日历聚合为空');

// 6) 筛选 / 搜索
todos = store.addTodo(todos, { title: '买菜' });
todos = store.addTodo(todos, { title: '写代码' });
todos = store.toggleDone(todos, todos[0].id); // 买菜 done
assert.strictEqual(store.filterByStatus(todos, 'done').length, 1);
assert.strictEqual(store.filterByStatus(todos, 'active').length, 1);
assert.strictEqual(store.searchByTitle(todos, '写').length, 1, '搜索“写”命中 1');
assert.strictEqual(store.searchByTitle(todos, '菜').length, 1, '搜索“菜”命中 1');

// 7) 未排期不出现在日历
const undated = store.addTodo(todos, { title: '一件没排期的小事' });
assert.strictEqual(undated.find((t) => t.id === undated[undated.length - 1].id).date, null);
assert.ok(!groupByDate(undated)['__none__'], '未排期不应进入日历聚合');

console.log('PASS  Phase 4: 待办清单模块');
