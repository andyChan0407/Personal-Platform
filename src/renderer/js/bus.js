// 极简事件总线（环境无关，Node / 浏览器均可）。
// 用于：store 变更后通知各视图重渲染；计时模块向状态条广播。
function createBus() {
  const listeners = {};
  return {
    on(ev, fn) {
      if (!listeners[ev]) listeners[ev] = [];
      listeners[ev].push(fn);
    },
    emit(ev, payload) {
      (listeners[ev] || []).forEach((fn) => fn(payload));
    },
  };
}

// Node 与浏览器双端导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createBus };
}
if (typeof window !== 'undefined') {
  window.Bus = { createBus };
}
