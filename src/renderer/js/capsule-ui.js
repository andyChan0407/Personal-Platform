// 桌面胶囊交互：点击展开主窗口 / 拖拽移动 / 右键菜单 / 计时状态同步 / 悬停资源面板。
// 依赖 window.capsuleBridge（preload-capsule.js 暴露）、window.CapsuleMath（与主进程同款算法）、
// window.CapsuleFormat（与主进程同款文案格式化）。
(function () {
  const bridge = window.capsuleBridge || {};
  const Math_ = window.CapsuleMath || { isClick: () => true, capsuleText: () => '今日毕' };
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
  const procTrigger = document.getElementById('proc-trigger');
  const procPopup = document.getElementById('proc-popup');
  const popApps = document.getElementById('pop-apps');
  const popGroup = document.getElementById('pop-group');
  const popCpuTotal = document.getElementById('pop-cpu-total');
  const popMemTotal = document.getElementById('pop-mem-total');
  const popSysToggle = document.getElementById('pop-sys-toggle');

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
      : timerText || '今日毕';
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
  let procOpen = false;
  let procHideTimer = null;
  let showSystem = false; // 弹层是否显示 Windows 系统进程（默认隐藏，贴合「应用」语义）
  const DISPLAY_MAX = 12; // 弹层最多展示条数
  const GAP = 6;

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

  // 含「应用占用弹层」的总高度：弹层展开时把它的高度也算进窗口，避免被裁切
  function measureTotal() {
    let h = panelEl ? panelEl.offsetHeight : 0;
    if (procOpen && procPopup) h += GAP + procPopup.offsetHeight;
    return h;
  }

  /* ------------------------- 应用占用弹层（真实采集） ------------------------- */
  // 状态 → 样式类：运行中(绿) / 系统(琥珀) / 后台(灰)
  function statusClass(status) {
    if (status === '运行中') return 'st-run';
    if (status === '系统') return 'st-sys';
    return 'st-bg';
  }

  function updateSysToggle() {
    if (!popSysToggle) return;
    popSysToggle.setAttribute('aria-pressed', showSystem ? 'true' : 'false');
    popSysToggle.textContent = showSystem ? '隐藏系统进程' : '含系统进程';
    popSysToggle.title = showSystem ? '隐藏 Windows 系统进程' : '显示 Windows 系统进程（如内存压缩）';
  }

  function renderProcs(processes) {
    if (!popApps) return;
    updateSysToggle();
    const all = processes && processes.apps ? processes.apps : null;
    if (!all || !all.length) {
      popApps.innerHTML = '<div class="pop-loading">读取中…</div>';
      if (popGroup) popGroup.textContent = '应用 (0)';
      if (popCpuTotal) popCpuTotal.textContent = '--';
      if (popMemTotal) popMemTotal.textContent = '--';
      return;
    }
    // 默认隐藏系统进程（贴合「应用」语义，也与任务管理器的「应用」分组一致）
    const visible = (showSystem ? all : all.filter(function (a) {
      return !a.system;
    })).slice(0, DISPLAY_MAX);

    if (popGroup) {
      popGroup.textContent = (showSystem ? '应用与系统 (' : '应用 (') + visible.length + ')';
    }
    // 合计按「当前可见行」重算，保证头部数字与列表一致
    let cpuSum = 0;
    let memSum = 0;
    visible.forEach(function (a) {
      cpuSum += a.cpuPercent || 0;
      memSum += a.memBytes || 0;
    });
    if (Fmt) {
      if (popCpuTotal) popCpuTotal.textContent = Fmt.fmtProcCpu(Math.round(cpuSum));
      if (popMemTotal) popMemTotal.textContent = Fmt.fmtMB(memSum);
    }

    popApps.textContent = '';
    if (!visible.length) {
      popApps.innerHTML = '<div class="pop-loading">无应用</div>';
      return;
    }
    visible.forEach(function (a) {
      const row = document.createElement('div');
      row.className =
        'pop-app' + (a.self ? ' is-self' : '') + (a.system ? ' is-sys' : '');

      const nameCell = document.createElement('span');
      nameCell.className = 'pop-name-cell';
      const ic = document.createElement('span');
      ic.className = 'pop-ic';
      ic.textContent = a.iconLabel || '?';
      if (a.iconColor) ic.style.background = a.iconColor;
      const nm = document.createElement('span');
      nm.className = 'pop-name';
      nm.textContent = a.name;
      nameCell.appendChild(ic);
      nameCell.appendChild(nm);

      const st = document.createElement('span');
      st.className = 'pop-status ' + statusClass(a.status);
      st.textContent = a.status || '后台';

      const cpu = document.createElement('span');
      cpu.className = 'pop-cpu';
      cpu.textContent = Fmt ? Fmt.fmtProcCpu(a.cpuPercent) : Math.round(a.cpuPercent) + '%';

      const mem = document.createElement('span');
      mem.className = 'pop-mem';
      mem.textContent = Fmt ? Fmt.fmtMB(a.memBytes) : '';

      row.appendChild(nameCell);
      row.appendChild(st);
      row.appendChild(cpu);
      row.appendChild(mem);
      popApps.appendChild(row);
    });
  }

  function sendPanelState() {
    api.setPanel({ open: true, pinned: pinned, height: measureTotal(), popupOpen: procOpen });
  }

  function showPopup() {
    if (procHideTimer) {
      clearTimeout(procHideTimer);
      procHideTimer = null;
    }
    if (!procOpen) {
      procOpen = true;
      if (procPopup) {
        procPopup.classList.add('open');
        procPopup.setAttribute('aria-hidden', 'false');
      }
    }
    if (!panelOpen) openPanel();
    renderProcs(stats && stats.processes);
    sendPanelState();
  }

  function scheduleHidePopup() {
    if (procHideTimer || !procOpen) return;
    procHideTimer = setTimeout(function () {
      procHideTimer = null;
      procOpen = false;
      if (procPopup) {
        procPopup.classList.remove('open');
        procPopup.setAttribute('aria-hidden', 'true');
      }
      if (panelOpen) sendPanelState(); // 收起弹层但保留资源面板
    }, HOVER_HIDE_MS);
  }

  function cancelHidePopup() {
    if (procHideTimer) {
      clearTimeout(procHideTimer);
      procHideTimer = null;
    }
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
    if (procOpen) renderProcs(stats && stats.processes);
    sentHeight = measureTotal();
    api.setPanel({ open: true, pinned: pinned, height: sentHeight, popupOpen: procOpen });
  }

  function hidePanelOnly() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (procHideTimer) {
      clearTimeout(procHideTimer);
      procHideTimer = null;
    }
    if (!panelOpen && !procOpen) return;
    panelOpen = false;
    procOpen = false;
    if (panelEl) {
      panelEl.classList.remove('open');
      panelEl.setAttribute('aria-hidden', 'true');
    }
    if (procPopup) {
      procPopup.classList.remove('open');
      procPopup.setAttribute('aria-hidden', 'true');
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
      if (procOpen) renderProcs(stats && stats.processes);
      const h = measureTotal();
      // 盘符/应用列表变化导致高度变化时同步给主进程，保持窗口刚好包住内容
      if (Math.abs(h - sentHeight) > 2) {
        sentHeight = h;
        sendPanelState();
      }
    });
  }

  // CPU+内存 区域悬停 → 展开「应用占用」弹层；移开给宽限期（便于把鼠标移进弹层）
  if (procTrigger) {
    procTrigger.addEventListener('mouseenter', showPopup);
    procTrigger.addEventListener('mouseleave', scheduleHidePopup);
  }
  if (procPopup) {
    procPopup.addEventListener('mouseenter', cancelHidePopup);
    procPopup.addEventListener('mouseleave', scheduleHidePopup);
  }
  // 「含系统进程」开关：切换后重渲染，并同步窗口高度（行数变化）
  if (popSysToggle) {
    popSysToggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showSystem = !showSystem;
      renderProcs(stats && stats.processes);
      sentHeight = measureTotal();
      sendPanelState();
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
    isShowSystem: function () {
      return showSystem;
    },
    toggleSystem: function () {
      if (popSysToggle) popSysToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    },
    getProcRows: function () {
      if (!popApps) return [];
      return Array.prototype.map.call(popApps.querySelectorAll('.pop-app'), function (n) {
        const st = n.querySelector('.pop-status');
        return {
          name: n.querySelector('.pop-name') ? n.querySelector('.pop-name').textContent : '',
          status: st ? st.textContent : '',
          cls: st ? st.className : '',
          self: n.classList.contains('is-self'),
          system: n.classList.contains('is-sys'),
        };
      });
    },
    getProcGroupText: function () {
      return popGroup ? popGroup.textContent : '';
    },
  };
})();
