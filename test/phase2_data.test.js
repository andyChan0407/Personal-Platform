// Phase 2 测试：数据层 store + storage
// 覆盖 PRD 验收 9（持久化）、11（损坏容错）及待办数据操作的完整性。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const store = require(path.join(root, 'src/renderer/js/store'));
const { createStorage, defaultData } = require(path.join(root, 'src/renderer/js/storage'));

// ---------- store 纯函数 ----------
let todos = [];
todos = store.addTodo(todos, { title: '写报告' });
assert.strictEqual(todos.length, 1, 'addTodo 应增加一条');
assert.ok(todos[0].id, '应有 id');
assert.strictEqual(todos[0].done, false);
assert.strictEqual(todos[0].date, null, '未排期应为 null');

// 标题为空应抛错
assert.throws(() => store.addTodo(todos, { title: '   ' }), '空标题应抛错');

// 带日期新增
todos = store.addTodo(todos, { title: '开会', date: '2026-09-14', note: '周会' });
assert.strictEqual(todos[1].date, '2026-09-14');
assert.strictEqual(todos[1].note, '周会');

// update
todos = store.updateTodo(todos, todos[0].id, { title: '写周报', done: true });
const upd = todos.find((t) => t.id === todos[0].id);
assert.strictEqual(upd.title, '写周报');
assert.strictEqual(upd.done, true);

// toggle
todos = store.toggleDone(todos, todos[0].id);
assert.strictEqual(todos.find((t) => t.id === todos[0].id).done, false);

// delete
todos = store.deleteTodo(todos, todos[1].id);
assert.strictEqual(todos.length, 1);

// 筛选
todos = store.addTodo(todos, { title: 'A' });
todos = store.toggleDone(todos, todos.find((t) => t.title === 'A').id);
assert.strictEqual(store.filterByStatus(todos, 'done').length, 1, '已完成应为 1');
assert.strictEqual(store.filterByStatus(todos, 'active').length, 1, '未完成应为 1');
assert.strictEqual(store.filterByStatus(todos, 'all').length, 2);

// 搜索
assert.strictEqual(store.searchByTitle(todos, '写').length, 1, '搜索“写”应命中 1');
assert.strictEqual(store.searchByTitle(todos, '').length, 2, '空搜索返回全部');

// 按日期聚合（未排期不计入）
const grouped = store.groupByDate(todos);
assert.ok(grouped['2026-09-14'] === undefined, '已删除的日期不应存在');
todos = store.addTodo(todos, { title: '健身', date: '2026-09-14' });
const g2 = store.groupByDate(todos);
assert.strictEqual(g2['2026-09-14'].length, 1, '该日应有 1 条');
assert.ok(!g2['__none__'], '未排期不应聚合');

// ---------- storage 持久化与容错 ----------
const tmp = path.join(os.tmpdir(), 'gtc-test-data-' + Date.now() + '.json');
const storage = createStorage(tmp);

// 文件不存在 → 默认空数据
let data = storage.load();
assert.deepStrictEqual(data.todos, [], '缺失文件应返回空 todos');
assert.strictEqual(data.settings.workMin, 25);

// 保存后读取往返一致
const payload = { todos: [{ id: 'x1', title: 't', date: null, done: false, note: '', createdAt: 'now' }], settings: { workMin: 30, breakMin: 8 } };
storage.save(payload);
assert.ok(fs.existsSync(tmp), '保存应生成文件');
const loaded = storage.load();
assert.strictEqual(loaded.todos.length, 1);
assert.strictEqual(loaded.todos[0].title, 't');
assert.strictEqual(loaded.settings.workMin, 30, '时长设置应被持久化');
assert.strictEqual(loaded.settings.breakMin, 8);

// 损坏文件 → 容错返回空数据（不抛错，不崩溃）
fs.writeFileSync(tmp, '{ this is not valid json ', 'utf8');
const broken = storage.load();
assert.deepStrictEqual(broken.todos, [], '损坏文件应回退空数据');
assert.strictEqual(broken.settings.workMin, 25, '损坏时应有默认设置');

// 空文件 → 默认
fs.writeFileSync(tmp, '', 'utf8');
assert.deepStrictEqual(storage.load().todos, [], '空文件应回退默认');

// 清理
try { fs.unlinkSync(tmp); } catch (e) {}

console.log('PASS  Phase 2: 数据层 store + storage');
