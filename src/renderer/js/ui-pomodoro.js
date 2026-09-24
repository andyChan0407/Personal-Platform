// 番茄计时模块 UI。调用 api.createPomodoro，阶段切换触发声音 + 桌面弹窗。
(function () {
  const Views = (window.Views = window.Views || {});
  let timer = null;
  let intervalId = null;
  let settings = null;

  function phaseName(p) {
    return p === 'work' ? '工作时间' : '休息时间';
  }
  function timerInfo(t) {
    return { kind: 'pomodoro', text: `番茄 ${t.display} ${t.phase === 'work' ? '工作中' : '休息中'}` };
  }

  // 当前阶段完成百分比（用于进度环）
  function percent(t) {
    const total = t.phase === 'work' ? t.workSec : t.breakSec;
    if (!total) return 0;
    const done = Math.min(Math.max(total - t.remaining, 0), total);
    return Math.round((done / total) * 100);
  }

  // 同步动态部分（tick 时只改数值，不整块重绘）
  function syncTimer() {
    const el = document.getElementById('pomo-time');
    if (el) el.textContent = timer.display;
    const cnt = document.getElementById('pomo-count');
    if (cnt) cnt.textContent = '第 ' + timer.completedCount + ' 个番茄';
    const ph = document.getElementById('pomo-phase');
    if (ph) ph.textContent = '当前阶段：' + phaseName(timer.phase);
    const ring = document.getElementById('pomo-ring');
    if (ring) {
      ring.style.setProperty('--p', percent(timer));
      ring.classList.toggle('rest', timer.phase === 'break');
    }
  }

  function render(ctx) {
    const { state, api, bus } = ctx;
    if (!timer) {
      settings = state.data.settings;
      timer = api.createPomodoro(settings);
    }
    const root = document.getElementById('view-pomodoro');
    root.innerHTML = `
      <div class="timer-screen">
        <div class="timer-header">
          <span class="timer-label">番茄计时</span>
          <span class="timer-phase" id="pomo-phase">当前阶段：${phaseName(timer.phase)}</span>
        </div>
        <div class="timer-stage">
          <div class="timer-ring ${timer.phase === 'break' ? 'rest' : ''}" id="pomo-ring" style="--p:${percent(timer)}">
            <div class="timer-ring-inner">
              <div class="timer-big" id="pomo-time">${timer.display}</div>
              <div class="timer-sub" id="pomo-count">第 ${timer.completedCount} 个番茄</div>
            </div>
          </div>
        </div>
        <div class="timer-meta">
          <span class="meta-chip">工作 ${settings.workMin} 分钟</span>
          <span class="meta-chip">休息 ${settings.breakMin} 分钟</span>
        </div>
        <div class="controls">
          <button class="btn btn-primary" id="pomo-toggle">${timer.running ? '暂停' : '开始'}</button>
          <button class="btn" id="pomo-skip">跳过</button>
          <button class="btn" id="pomo-reset">重置</button>
        </div>
        <div class="settings-row">
          <span>工作 <input id="pomo-work" type="number" min="1" value="${settings.workMin}" /> 分</span>
          <span>休息 <input id="pomo-break" type="number" min="1" value="${settings.breakMin}" /> 分</span>
        </div>
      </div>`;

    root.querySelector('#pomo-toggle').onclick = () => {
      if (timer.running) {
        timer.pause();
        stopTick();
      } else {
        timer.start();
        startTick(ctx);
      }
      bus.emit('timer', timerInfo(timer));
      render(ctx);
    };
    root.querySelector('#pomo-skip').onclick = () => {
      timer.skip();
      bus.emit('timer', timerInfo(timer));
      render(ctx);
    };
    root.querySelector('#pomo-reset').onclick = () => {
      stopTick();
      timer.reset();
      bus.emit('timer', null);
      render(ctx);
    };
    root.querySelector('#pomo-work').onchange = (e) => applySettings(ctx, e.target.value, null);
    root.querySelector('#pomo-break').onchange = (e) => applySettings(ctx, null, e.target.value);
    if (timer.running) startTick(ctx);
  }

  function startTick(ctx) {
    const { bus } = ctx;
    stopTick();
    intervalId = setInterval(() => {
      const events = timer.tick(1);
      events.forEach((ev) => {
        if (ev.type === 'phase') notifyPhase(ev.phase, timer.completedCount);
      });
      bus.emit('timer', timerInfo(timer));
      syncTimer();
    }, 1000);
  }
  function stopTick() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function applySettings(ctx, w, b) {
    const { state, api, save } = ctx;
    const workMin = w != null ? parseInt(w, 10) : state.data.settings.workMin;
    const breakMin = b != null ? parseInt(b, 10) : state.data.settings.breakMin;
    if (workMin > 0) state.data.settings.workMin = workMin;
    if (breakMin > 0) state.data.settings.breakMin = breakMin;
    timer.setDurations({
      workMin: state.data.settings.workMin,
      breakMin: state.data.settings.breakMin,
    });
    save();
    render(ctx);
  }

  function notifyPhase(phase, count) {
    try {
      beep();
    } catch (e) {}
    try {
      new Notification(phase === 'work' ? '该开始工作啦' : '该休息一下啦', {
        body: `已完成 ${count} 个番茄`,
      });
    } catch (e) {}
  }

  function beep() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.frequency.value = 880;
    g.gain.value = 0.2;
    o.start();
    setTimeout(() => {
      o.stop();
      ac.close();
    }, 300);
  }

  Views.pomodoro = { render };
})();
