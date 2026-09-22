// 应用控制器：加载数据、管理视图切换、维护计时状态条。
// 依赖 window.api / window.api.bus（由 preload 暴露）。
(function () {
  const api = window.api;
  const bus = api.bus;

  const state = {
    data: api.load(),
    view: api.nav.getInitialView(),
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    calSelected: null,
  };
  if (!state.data.settings) state.data.settings = {};

  /* ------------------------- 主题 ------------------------- */
  // 本脚本在解析期就同步跑（api.load 走 sendSync），因此首帧之前 data-theme 已定好，
  // 不会先闪一下浅色再切成深色。
  const themeSwitch = document.getElementById('theme-switch');

  function renderThemeSwitch() {
    if (!themeSwitch) return;
    themeSwitch.innerHTML = window.Theme.switcherHtml(window.Theme.readTheme(state.data));
  }

  function setTheme(id) {
    const next = window.Theme.normalizeTheme(id);
    state.data.settings.theme = next;
    window.Theme.applyTheme(next);
    renderThemeSwitch();
    save();
  }

  window.Theme.applyTheme(window.Theme.readTheme(state.data));
  renderThemeSwitch();

  if (themeSwitch) {
    themeSwitch.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('[data-theme-btn]') : null;
      if (btn) setTheme(btn.dataset.themeBtn);
    });
  }

  function save() {
    api.save(state.data);
    api.notifyDataChanged();
    bus.emit('data-changed', state.data);
  }

  const VIEWS = ['todo', 'pomodoro', 'stopwatch', 'calendar'];

  // 侧边栏「未完成数量」徽标
  function updateBadge() {
    const badge = document.getElementById('nav-todo-badge');
    if (!badge) return;
    const n = (state.data.todos || []).filter((t) => !t.done).length;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
  }

  function showView(name) {
    state.view = api.nav.switchView(state.view, name);
    document.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.view === state.view);
    });
    VIEWS.forEach((v) => {
      document.getElementById('view-' + v).classList.toggle('hidden', v !== state.view);
    });
    renderView();
  }

  function renderView() {
    const mod = window.Views && window.Views[state.view];
    if (mod && mod.render) mod.render(ctx);
  }

  const ctx = { state, api, bus, save, refresh: renderView, showView };

  // 导航点击
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => showView(el.dataset.view));
  });

  bus.on('data-changed', updateBadge);

  // 计时状态条：订阅 bus 的 timer 事件
  const statusBar = document.getElementById('status-bar');
  bus.on('timer', (info) => {
    api.notifyTimer(info || null);
    if (!info) {
      statusBar.classList.add('hidden');
      statusBar.onclick = null;
      return;
    }
    statusBar.classList.remove('hidden');
    statusBar.textContent = info.text;
    statusBar.onclick = () => showView(info.kind);
  });

  window.App = ctx;

  // 待所有 UI 模块脚本注册完成后执行首次渲染
  function init() {
    updateBadge();
    showView(state.view);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
