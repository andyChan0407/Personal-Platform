// 导航状态（纯逻辑，可测试）。默认首页为待办清单。
const VIEWS = ['todo', 'pomodoro', 'stopwatch', 'calendar'];

function getInitialView() {
  return 'todo';
}

function isValidView(v) {
  return VIEWS.includes(v);
}

function switchView(current, next) {
  return isValidView(next) ? next : current;
}

// Node 与浏览器双端导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VIEWS, getInitialView, isValidView, switchView };
}
if (typeof window !== 'undefined') {
  window.Nav = { VIEWS, getInitialView, isValidView, switchView };
}
