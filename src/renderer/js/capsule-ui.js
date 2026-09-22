// 桌面胶囊交互：点击展开主窗口 / 拖拽移动 / 右键菜单 / 计时状态同步 / 悬停资源面板。
// 依赖 window.capsuleBridge（preload-capsule.js 暴露）、window.CapsuleMath（与主进程同款算法）、
// window.CapsuleFormat（与主进程同款文案格式化）。
(function () {
  const bridge = window.capsuleBridge || {};
  const Math_ = window.CapsuleMath || { isClick: () => true, capsuleText: () => '我的待办' };
  const Fmt = window.CapsuleFormat || null;
  const el = document.getElementById('capsule');
  const textEl = document.getElementById('cap-text');
  const hintEl = document.getElementById('cap-hint');
  const panelEl = document.getElementById('panel');
  const pinEl = document.getElementById('panel-pin');
  const cpuEl = document.getElementById('p-cpu');
  const cpuBar = document.getElementById('p-cpu-bar');
  const memEl = document.getElementById('p-mem');
  const memBar = document.getElementById('p-mem-bar');
  const memSub = document.getElementById('p-mem-sub');
  const disksEl = document.getElementById('p-disks');

  const HOVER_HIDE_MS = 260; // 移开鼠标后的宽限期：够从胶囊划到面板上

  const noop = function () {};
  const api = {
    openMain: typeof bridge.openMain === 'function' ? bridge.openMain : noop,
    dragStart: typeof bridge.dragStart === 'function' ? bridge.dragStart : noop,
    dragEnd: typeof bridge.dragEnd === 'function' ? bridge.dragEnd : noop,
    showMenu: typeof bridge.showMenu === 'function' ? bridge.showMenu : noop,
    setPanel: typeof bridge.setPanel === 'function' ? bridge.setPanel : noop,
  };

  let timerText = null;
  let summary = { todayCount: 0, undone: 0 };

  function updateText() {
    const text = Math_.capsuleText
      ? Math_.capsuleText({ timerText: timerText, todayCount: summary.todayCount, undone: summary.undone })
      : timerText || '我的待办';
    if (textEl) textEl.textContent = text;
    if (hintEl) hintEl.textContent = timerText ? '计时中' : '点击展开';
    document.body.classList.toggle('running', Boolean(timerText));
  }

  if (typeof bridge.onTimer === 'function') {
    bridge.onTimer(function (info) {
      timerText = info && info.text ? info.text : null;
      updateText();
    });
  }
  if (typeof bridge.onSummary === 'function') {
    bridge.onSummary(function (info) {
      summary = info || { todayCount: 0, undone: 0 };
      updateText();
    });
  }

  /* ------------------------- 资源面板 ------------------------- */
  let panelOpen = false;
  let pinned = false;
  let hideTimer = null;
  let stats = null;
  let sentHeight = 0;

  function setBar(node, percent, level) {
    if (!node) return;
    node.setAttribute('data-level', level || 'ok');
    node.style.width = Math.min(100, Math.max(0, percent || 0)) + '%';
  }

  function renderStats(s) {
    if (!Fmt || !s) return;
    if (cpuEl) cpuEl.textContent = Fmt.cpuText(s.cpu, s.cores);
    setBar(cpuBar, Fmt.cpuBar(s.cpu), 'ok');

    const mem = Fmt.memView(s.mem);
    if (memEl) memEl.textContent = mem.lineText;
    if (memSub) memSub.textContent = mem.subText;
    setBar(memBar, mem.barPercent, mem.level);

    if (!disksEl) return;
    disksEl.textContent = '';
    Fmt.sortDisks(s.disks).forEach(function (d) {
      const v = Fmt.diskView(d);
      const row = document.createElement('div');
      row.className = 'p-disk';
      row.setAttribute('data-letter', v.letter);

      const line = document.createElement('div');
      line.className = 'p-line';
      const name = document.createElement('span');
      name.className = 'p-name p-disk-name';
      name.textContent = v.letter;
      const val = document.createElement('span');
      val.className = 'p-value' + (v.level === 'danger' ? ' is-danger' : '');
      val.textContent = v.lineText;
      line.appendChild(name);
      line.appendChild(val);

      const bar = document.createElement('div');
      bar.className = 'p-bar';
      const fill = document.createElement('i');
      fill.setAttribute('data-level', v.level);
      bar.appendChild(fill);

      row.appendChild(line);
      row.appendChild(bar);
      disksEl.appendChild(row);
      fill.style.width = v.barPercent + '%';
    });
  }

  function measurePanel() {
    return panelEl ? panelEl.offsetHeight : 0;
  }

  // 展开：先渲染再量高，把实测高度交给主进程扩窗（避免高度算不准导致裁切）
  function openPanel() {
    if (panelOpen || !panelEl) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    panelOpen = true;
    panelEl.classList.add('open');
    panelEl.setAttribute('aria-hidden', 'false');
    renderStats(stats);
    sentHeight = measurePanel();
    api.setPanel({ open: true, pinned: pinned, height: sentHeight });
  }

  function hidePanelOnly() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (!panelOpen) return;
    panelOpen = false;
    if (panelEl) {
      panelEl.classList.remove('open');
      panelEl.setAttribute('aria-hidden', 'true');
    }
  }

  function closePanel(options) {
    const o = options || {};
    if (o.unpin) {
      pinned = false;
      updatePin();
    }
    const was = panelOpen;
    hidePanelOnly();
    // 通知主进程收缩窗口（由主进程收起时无需再回报，避免来回通信）
    if (was && o.notify !== false) api.setPanel({ open: false });
  }

  function scheduleClose() {
    if (pinned || hideTimer || !panelOpen) return;
    hideTimer = setTimeout(function () {
      hideTimer = null;
      closePanel();
    }, HOVER_HIDE_MS);
  }

  function updatePin() {
    if (!pinEl) return;
    pinEl.classList.toggle('on', pinned);
    pinEl.textContent = pinned ? '已钉住' : '钉住';
  }

  if (panelEl) {
    panelEl.addEventListener('mouseenter', openPanel);
  }
  if (pinEl) {
    pinEl.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    pinEl.addEventListener('click', function (e) {
      e.stopPropagation();
      pinned = !pinned;
      updatePin();
      if (pinned) {
        openPanel();
      } else if (panelOpen) {
        // 取消钉住：不立刻收起，等鼠标离开窗口时再收
        api.setPanel({ open: true, pinned: false, height: measurePanel() });
      }
    });
    updatePin();
  }

  // 进入窗口即展开；离开窗口给一点宽限时间（便于从胶囊划到面板）
  document.body.addEventListener('mouseenter', openPanel);
  document.body.addEventListener('mouseleave', scheduleClose);

  if (typeof bridge.onPanelLayout === 'function') {
    bridge.onPanelLayout(function (info) {
      const it = info || {};
      if (!it.open) {
        // 主进程收起（拖拽开始 / 打开主界面 / 复位）：本地同步收起并解除钉住
        pinned = false;
        updatePin();
        hidePanelOnly();
        return;
      }
      document.body.classList.toggle('above', it.place === 'above');
      document.body.classList.toggle('cap-right', it.align === 'right');
    });
  }

  if (typeof bridge.onStats === 'function') {
    bridge.onStats(function (info) {
      stats = info || null;
      if (!panelOpen) return;
      renderStats(stats);
      const h = measurePanel();
      // 盘符变化导致面板高度变化时同步给主进程，保持窗口刚好包住面板
      if (Math.abs(h - sentHeight) > 2) {
        sentHeight = h;
        api.setPanel({ open: true, pinned: pinned, height: h });
      }
    });
  }

  /* ------------------------- 拖拽 + 点击 ------------------------- */
  let startPoint = null;
  if (el) {
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      startPoint = { x: e.screenX, y: e.screenY };
      // 拖拽/点击前先收起面板：避免按展开态坐标计算位置（主进程 drag-start 也会兜底收起）
      closePanel({ unpin: true, notify: false });
      api.dragStart();
    });
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      api.showMenu();
    });
  }

  window.addEventListener('mouseup', function (e) {
    if (!startPoint) return;
    const clicked = Math_.isClick(startPoint, { x: e.screenX, y: e.screenY });
    startPoint = null;
    api.dragEnd(!clicked);
    if (clicked) api.openMain();
  });

  updateText();

  // 测试/调试用的最小句柄：模拟按下与松开（可指定屏幕坐标以模拟拖拽）、悬停与钉住
  window.CapsuleUI = {
    press: function (x, y) {
      if (!el) return;
      el.dispatchEvent(
        new window.MouseEvent('mousedown', { button: 0, screenX: x || 0, screenY: y || 0, bubbles: true })
      );
    },
    release: function (x, y) {
      window.dispatchEvent(
        new window.MouseEvent('mouseup', { button: 0, screenX: x || 0, screenY: y || 0, bubbles: true })
      );
    },
    getText: function () {
      return textEl ? textEl.textContent : '';
    },
    isRunning: function () {
      return document.body.classList.contains('running');
    },
    hoverOn: function () {
      openPanel();
    },
    hoverOff: function () {
      scheduleClose();
    },
    isPanelOpen: function () {
      return Boolean(panelEl && panelEl.classList.contains('open'));
    },
    isPanelPinned: function () {
      return pinned;
    },
    togglePin: function () {
      if (pinEl) pinEl.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    },
    pushStats: function (s) {
      stats = s || null;
      if (panelOpen) renderStats(stats);
    },
    getPanelHeight: function () {
      return measurePanel();
    },
    getCpuText: function () {
      return cpuEl ? cpuEl.textContent : '';
    },
    getMemText: function () {
      return memEl ? memEl.textContent : '';
    },
    getMemSub: function () {
      return memSub ? memSub.textContent : '';
    },
    getDiskRows: function () {
      if (!disksEl) return [];
      return Array.prototype.map.call(disksEl.querySelectorAll('.p-disk'), function (n) {
        const fill = n.querySelector('.p-bar > i');
        return {
          letter: n.getAttribute('data-letter'),
          text: n.textContent,
          level: fill ? fill.getAttribute('data-level') : '',
          width: fill ? fill.style.width : '',
        };
      });
    },
    getLayout: function () {
      return {
        above: document.body.classList.contains('above'),
        capRight: document.body.classList.contains('cap-right'),
      };
    },
  };
})();
