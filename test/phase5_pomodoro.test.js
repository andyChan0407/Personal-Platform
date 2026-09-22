// Phase 5 测试：番茄计时状态机
// 覆盖 PRD 验收 6：25/5 循环、开始/暂停/跳过/重置、时长可调、阶段切换。
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const { PomodoroTimer } = require(path.join(root, 'src/renderer/js/pomodoro'));

// 默认 25/5
let p = new PomodoroTimer();
assert.strictEqual(p.workSec, 25 * 60);
assert.strictEqual(p.breakSec, 5 * 60);
assert.strictEqual(p.phase, 'work');
assert.strictEqual(p.remaining, 25 * 60);
assert.strictEqual(p.completedCount, 0);
assert.strictEqual(p.running, false);

// 用 1 分钟便于测试
p = new PomodoroTimer({ workMin: 1, breakMin: 1 });
assert.strictEqual(p.remaining, 60);

// 开始 + 倒计时到 0 → 切入休息，completedCount+1，触发 phase 事件
p.start();
assert.strictEqual(p.running, true);
const evs = p.tick(60);
assert.strictEqual(p.phase, 'break', '工作结束应切入休息');
assert.strictEqual(p.completedCount, 1, '完成一个番茄');
assert.strictEqual(p.remaining, 60, '休息剩余应为 60s');
assert.strictEqual(evs.length, 1);
assert.strictEqual(evs[0].type, 'phase');
assert.strictEqual(evs[0].phase, 'break');

// 休息结束 → 回到工作，completedCount 不再增加
const evs2 = p.tick(60);
assert.strictEqual(p.phase, 'work', '休息结束应回到工作');
assert.strictEqual(p.completedCount, 1, '仅工作→休息计入番茄数');
assert.strictEqual(p.remaining, 60);

// 暂停时 tick 不改变
p.pause();
const before = p.remaining;
p.tick(10);
assert.strictEqual(p.remaining, before, '暂停时 tick 应无效');

// 跳过：工作→休息→工作
p.start();
p.skip();
assert.strictEqual(p.phase, 'break', '跳过应从工作到休息');
assert.strictEqual(p.remaining, 60);
p.skip();
assert.strictEqual(p.phase, 'work', '再次跳过应回到工作');

// 重置
p.reset();
assert.strictEqual(p.phase, 'work');
assert.strictEqual(p.completedCount, 0);
assert.strictEqual(p.remaining, 60);

// 显示格式
assert.strictEqual(p.display, '01:00');

// 时长可调且生效（验收 6：调整时长后生效）
p.setDurations({ workMin: 25, breakMin: 5 });
assert.strictEqual(p.remaining, 25 * 60, '调整后工作时长应生效');
assert.strictEqual(p.breakSec, 5 * 60);

// 跨多周期的连续 tick（overshoot）不陷入死循环且状态正确
const p2 = new PomodoroTimer({ workMin: 1, breakMin: 1 });
p2.start();
const big = p2.tick(150); // 60 工作 + 60 休息 + 剩余 30 工作
assert.strictEqual(p2.phase, 'work', '连续 tick 后应为工作阶段');
assert.strictEqual(p2.remaining, 30, '剩余应正确');
assert.strictEqual(p2.completedCount, 1, '仅完成一个工作阶段');

console.log('PASS  Phase 5: 番茄计时状态机');
