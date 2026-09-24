// Phase 8 测试：集成与联调
// 覆盖 PRD 验收 1（首屏/数据基础）、9（持久化）、10（备份恢复）、11（损坏容错）及清单↔日历联动。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const { createStorage } = require(path.join(root, 'src/renderer/js/storage'));
const store = require(path.join(root, 'src/renderer/js/store'));
const { createBus } = require(path.join(root, 'src/renderer/js/bus'));

const tmp = path.join(os.tmpdir(), 'gtc-integ-' + Date.now() + '.json');
const backup = tmp + '.bak';
const storage = createStorage(tmp);

// 1) 完整数据流：新建带日期待办 → 日历聚合 → 勾选完成 → 持久化往返一致
let data = { todos: [], settings: { workMin: 25, breakMin: 5 } };
data.todos = store.addTodo(data.todos, { title: '整理季度汇报', date: '2026-09-14' });
data.todos = store.addTodo(data.todos, { title: '未排期事项' });

// 清单↔日历同源：带日期项出现在日历聚合
let beforeGrouped = store.groupByDate(data.todos);
assert.strictEqual(beforeGrouped['2026-09-14'].length, 1, '带日期待办应出现在日历聚合（联动）');

// 勾选完成：filterByStatus 与 groupByDate 同时反映（同一数据源双向同步）
const id = data.todos[0].id;
data.todos = store.toggleDone(data.todos, id);
assert.strictEqual(store.filterByStatus(data.todos, 'done').length, 1, '完成后在已完成中可见');
assert.strictEqual(store.groupByDate(data.todos)['2026-09-14'].length, 1, '日历聚合仍含该项（联动不丢）');

// 以「勾选完成后」的状态作为往返比对的基准
let grouped = store.groupByDate(data.todos);

// 持久化往返（验收 9）
storage.save(data);
const reloaded = storage.load();
assert.strictEqual(reloaded.todos.length, 2, '重新打开数据数量不变');
assert.strictEqual(reloaded.todos[0].title, '整理季度汇报');
assert.strictEqual(reloaded.settings.workMin, 25, '设置持久化');
assert.deepStrictEqual(store.groupByDate(reloaded.todos), grouped, '重载后日历聚合一致');

// 2) 备份 / 恢复（验收 10）：复制文件即备份，覆盖后用备份恢复
fs.copyFileSync(tmp, backup);
const modified = storage.load();
modified.todos = store.addTodo(modified.todos, { title: '后来新增' });
storage.save(modified);
assert.strictEqual(storage.load().todos.length, 3, '修改后应有 3 条');
// 用备份覆盖原文件 → 恢复
fs.copyFileSync(backup, tmp);
const restored = storage.load();
assert.strictEqual(restored.todos.length, 2, '用备份覆盖后应恢复到 2 条');
assert.strictEqual(restored.todos[0].title, '整理季度汇报', '恢复内容正确');

// 3) 损坏容错（验收 11）：文件损坏以空数据启动不崩溃
fs.writeFileSync(tmp, '}{ not json', 'utf8');
const broken = storage.load();
assert.deepStrictEqual(broken.todos, [], '损坏文件应回退空数据，不崩溃');
assert.strictEqual(broken.settings.workMin, 25, '损坏时应有默认设置');
// 损坏后仍能正常写入（重建文件）
storage.save({ todos: [{ id: 'z', title: '重建', date: null, done: false, note: '', createdAt: 'n' }], settings: { workMin: 25, breakMin: 5 } });
assert.strictEqual(storage.load().todos.length, 1, '损坏后可重建文件');

// 4) 事件总线（集成粘合层：data-changed / timer 广播）
const bus = createBus();
let received = null;
bus.on('data-changed', (payload) => (received = payload));
bus.emit('data-changed', { ok: true });
assert.ok(received && received.ok, 'bus 应把事件传递给监听者');
let timerInfo = null;
bus.on('timer', (i) => (timerInfo = i));
bus.emit('timer', { kind: 'pomodoro', text: '番茄 24:12 工作中' });
assert.strictEqual(timerInfo.kind, 'pomodoro', '计时状态条应收到广播');

// 清理
try { fs.unlinkSync(tmp); } catch (e) {}
try { fs.unlinkSync(backup); } catch (e) {}

console.log('PASS  Phase 8: 集成与联调');
