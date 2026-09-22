// 番茄计时状态机（纯逻辑，可在 Node 中手动 tick 测试）。
//  - 工作/休息自动循环
//  - 归零触发 phase 事件（由 UI 负责声音 + 桌面弹窗）
//  - 支持暂停/继续/跳过/重置、运行时长可调
class PomodoroTimer {
  constructor({ workMin = 25, breakMin = 5 } = {}) {
    this.workSec = workMin * 60;
    this.breakSec = breakMin * 60;
    this.reset();
  }

  reset() {
    this.phase = 'work';
    this.remaining = this.workSec;
    this.completedCount = 0;
    this.running = false;
  }

  start() {
    this.running = true;
  }

  pause() {
    this.running = false;
  }

  resume() {
    this.running = true;
  }

  // 推进 delta 秒（默认 1）。返回本周期内发生的事件数组。
  tick(delta = 1) {
    if (!this.running) return [];
    const events = [];
    this.remaining -= delta;
    let guard = 0;
    while (this.remaining <= 0 && guard < 1000) {
      guard++;
      if (this.phase === 'work') {
        this.completedCount += 1;
        this.phase = 'break';
        const over = -this.remaining;
        this.remaining = this.breakSec - over;
        events.push({ type: 'phase', phase: 'break', completedCount: this.completedCount });
      } else {
        this.phase = 'work';
        const over = -this.remaining;
        this.remaining = this.workSec - over;
        events.push({ type: 'phase', phase: 'work', completedCount: this.completedCount });
      }
    }
    return events;
  }

  // 跳过当前阶段，直接进入下一阶段（不计入 completedCount）
  skip() {
    if (this.phase === 'work') {
      this.phase = 'break';
      this.remaining = this.breakSec;
    } else {
      this.phase = 'work';
      this.remaining = this.workSec;
    }
    return this.phase;
  }

  setDurations({ workMin, breakMin } = {}) {
    if (typeof workMin === 'number' && workMin > 0) this.workSec = workMin * 60;
    if (typeof breakMin === 'number' && breakMin > 0) this.breakSec = breakMin * 60;
    if (!this.running) this.reset();
  }

  get display() {
    const m = Math.floor(this.remaining / 60);
    const s = this.remaining % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}

// Node 与浏览器双端导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PomodoroTimer };
}
if (typeof window !== 'undefined') {
  window.PomodoroTimer = PomodoroTimer;
}
