// 秒表（纯逻辑，可在 Node 中手动 tick 测试）。
//  - 正计时（累计毫秒）
//  - 开始/暂停/继续、计次、清零
class Stopwatch {
  constructor() {
    this.reset();
  }

  reset() {
    this.elapsedMs = 0;
    this.running = false;
    this.laps = [];
    this._lastLapMs = 0;
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

  tick(deltaMs = 100) {
    if (this.running) this.elapsedMs += deltaMs;
  }

  // 记录一段：返回本段毫秒数
  lap() {
    const cur = this.elapsedMs;
    const lapMs = cur - this._lastLapMs;
    this.laps.push(lapMs);
    this._lastLapMs = cur;
    return lapMs;
  }

  get display() {
    const total = this.elapsedMs;
    const m = Math.floor(total / 60000);
    const s = Math.floor((total % 60000) / 1000);
    const d = Math.floor((total % 1000) / 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
  }
}

// Node 与浏览器双端导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Stopwatch };
}
if (typeof window !== 'undefined') {
  window.Stopwatch = Stopwatch;
}
