// 渲染进程 API 桥：用本地逻辑模块 + preload 暴露的 IPC 能力组装 window.api。
// 依赖加载顺序（index.html）：store/nav/calendar/bus/pomodoro/stopwatch → 本文件 → app.js
(function () {
  const electron = window.electronAPI || {};
  if (!electron.load || !electron.save) {
    // preload 未就绪/失败时给出可读错误，而不是让 app.js 第一行就崩
    throw new Error('electronAPI 未暴露：preload 加载失败，数据读写不可用');
  }
  if (!window.TodoStore || !window.Nav || !window.CalendarLogic || !window.Bus) {
    throw new Error('逻辑模块未加载：请检查 index.html 的脚本顺序');
  }
  window.api = {
    load: electron.load,
    save: electron.save,
    store: window.TodoStore,
    nav: window.Nav,
    calendar: window.CalendarLogic,
    bus: window.Bus.createBus(),
    createPomodoro: (settings) => new window.PomodoroTimer(settings),
    createStopwatch: () => new window.Stopwatch(),
    // 可选能力（无 Electron 环境下降级为空实现，不影响渲染层自测）
    notifyTimer: typeof electron.notifyTimer === 'function' ? electron.notifyTimer : function () {},
    notifyDataChanged:
      typeof electron.notifyDataChanged === 'function' ? electron.notifyDataChanged : function () {},
  };
})();
