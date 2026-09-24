// 计时器（秒表）模块 UI。正计时 + 计次 + 清零。
(function () {
  const Views = (window.Views = window.Views || {});
  let sw = null;
  let intervalId = null;

  function fmt(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const d = Math.floor((ms % 1000) / 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
  }

  function render(ctx) {
    const { api, bus } = ctx;
    if (!sw) sw = api.createStopwatch();
    const root = document.getElementById('view-stopwatch');
    const laps = sw.laps
      .map((ms, i) => `<div class="lap-row"><span>计次 ${sw.laps.length - i}</span><span>${fmt(ms)}</span></div>`)
      .join('');

    root.innerHTML = `
      <div class="timer-screen">
        <div class="timer-header">
          <span class="timer-label">计时器</span>
          <span class="timer-phase">正计时 · 已计次 ${sw.laps.length} 段</span>
        </div>
        <div class="timer-stage">
          <div class="timer-panel">
            <div class="timer-big" id="sw-time">${sw.display}</div>
            <div class="timer-sub">${sw.running ? '正在计时…' : '暂停中，点开始继续'}</div>
          </div>
        </div>
        <div class="controls">
          <button class="btn btn-primary" id="sw-toggle">${sw.running ? '暂停' : '开始'}</button>
          <button class="btn" id="sw-lap">计次</button>
          <button class="btn" id="sw-reset">清零</button>
        </div>
        ${laps ? `<div class="lap-list">${laps}</div>` : ''}
      </div>`;

    root.querySelector('#sw-toggle').onclick = () => {
      if (sw.running) {
        sw.pause();
        stopTick();
      } else {
        sw.start();
        startTick(ctx);
      }
      bus.emit('timer', { kind: 'stopwatch', text: `秒表 ${sw.display}` });
      render(ctx);
    };
    root.querySelector('#sw-lap').onclick = () => {
      sw.lap();
      render(ctx);
    };
    root.querySelector('#sw-reset').onclick = () => {
      stopTick();
      sw.reset();
      bus.emit('timer', null);
      render(ctx);
    };
    if (sw.running) startTick(ctx);
  }

  function startTick(ctx) {
    const { bus } = ctx;
    stopTick();
    intervalId = setInterval(() => {
      sw.tick(100);
      bus.emit('timer', { kind: 'stopwatch', text: `秒表 ${sw.display}` });
      const el = document.getElementById('sw-time');
      if (el) el.textContent = sw.display;
    }, 100);
  }
  function stopTick() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  Views.stopwatch = { render };
})();
