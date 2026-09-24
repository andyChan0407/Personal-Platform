// Phase 6 测试：计时器（秒表）
// 覆盖 PRD 验收 7：正计时、计次、暂停/清零，清零后归零并清空计次。
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const { Stopwatch } = require(path.join(root, 'src/renderer/js/stopwatch'));

let sw = new Stopwatch();
assert.strictEqual(sw.elapsedMs, 0);
assert.strictEqual(sw.running, false);
assert.deepStrictEqual(sw.laps, []);
assert.strictEqual(sw.display, '00:00.0');

// 开始 + 正计时
sw.start();
assert.strictEqual(sw.running, true);
sw.tick(1000);
assert.strictEqual(sw.elapsedMs, 1000, '应累计 1000ms');
assert.strictEqual(sw.display, '00:01.0');

// 暂停时不累计
sw.pause();
sw.tick(1000);
assert.strictEqual(sw.elapsedMs, 1000, '暂停时不应累计');
sw.resume();
sw.tick(500);
assert.strictEqual(sw.elapsedMs, 1500, '恢复后应继续累计');

// 计次：记录每段
const lap1 = sw.lap();
assert.strictEqual(lap1, 1500, '第一段应为 1500ms');
assert.strictEqual(sw.laps.length, 1);
sw.tick(250);
const lap2 = sw.lap();
assert.strictEqual(lap2, 250, '第二段应为 250ms');
assert.strictEqual(sw.elapsedMs, 1750);
assert.strictEqual(sw.laps.length, 2);

// 清零：归零并清空计次
sw.reset();
assert.strictEqual(sw.elapsedMs, 0, '清零后归零');
assert.strictEqual(sw.running, false, '清零后停止');
assert.deepStrictEqual(sw.laps, [], '清零后清空计次');
assert.strictEqual(sw.display, '00:00.0');

// 多计次累计正确
sw.start();
sw.tick(2000);
sw.lap();
sw.tick(1000);
sw.lap();
assert.strictEqual(sw.elapsedMs, 3000);
assert.deepStrictEqual(sw.laps, [2000, 1000], '两次计次应为 [2000, 1000]');

console.log('PASS  Phase 6: 计时器（秒表）');
