// 系统资源展示文案（纯函数，Node / 浏览器双端导出）。
// 主进程算原始字节，渲染层只负责把字节翻译成 “232.3 G / 14%” 这类文案。
(function (root, factory) {
  const api = factory();
  if (typeof window !== 'undefined') window.CapsuleFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const GB = 1024 * 1024 * 1024;
  const DANGER_FREE_PERCENT = 10; // 剩余低于 10%：红色告警
  const WARN_FREE_PERCENT = 20; // 剩余低于 20%：橙色提醒

  function toNumber(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  }

  // 与 toNumber 的区别：null/undefined/空串视为「还没有数据」，不能当成 0
  function toOptionalNumber(n) {
    if (n === null || n === undefined || n === '') return null;
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }

  // 字节 → GB 数字文案（保留 1 位小数）
  function fmtGB(bytes) {
    return (toNumber(bytes) / GB).toFixed(1);
  }

  function fmtPercent(percent) {
    return Math.round(toNumber(percent)) + '%';
  }

  // 进度条宽度：夹到 0~100 的整数
  function barWidth(percent) {
    const v = Math.round(toNumber(percent));
    return Math.min(100, Math.max(0, v));
  }

  // 剩余空间告警分级
  function levelOf(freePercent) {
    const v = toNumber(freePercent);
    if (v <= DANGER_FREE_PERCENT) return 'danger';
    if (v <= WARN_FREE_PERCENT) return 'warn';
    return 'ok';
  }

  // CPU：「14% · 12 核」；还没取到基准（首次采样）时显示 “--”
  function cpuText(cpu, cores) {
    const n = toOptionalNumber(cpu);
    const head = n === null ? '--' : Math.round(n) + '%';
    const c = Math.round(toNumber(cores));
    return c > 0 ? head + ' · ' + c + ' 核' : head;
  }

  function cpuBar(cpu) {
    const n = toOptionalNumber(cpu);
    return n === null ? 0 : barWidth(n);
  }

  // 内存：总量 / 已用 / 剩余 GB + 剩余百分比
  function memView(mem) {
    const m = mem || {};
    const total = toNumber(m.total);
    const used = toNumber(m.used);
    const free = toNumber(m.free);
    const freePercent = total > 0 ? Math.round((free / total) * 100) : 0;
    return {
      total: total,
      used: used,
      free: free,
      totalText: fmtGB(total),
      usedText: fmtGB(used),
      freeText: fmtGB(free),
      freePercent: freePercent,
      freePercentText: fmtPercent(freePercent),
      lineText: '已用 ' + fmtGB(used) + ' G / 共 ' + fmtGB(total) + ' G',
      subText: '剩余 ' + fmtGB(free) + ' G · ' + fmtPercent(freePercent) + ' 可用',
      barPercent: barWidth(total > 0 ? (used / total) * 100 : 0),
      level: levelOf(freePercent),
    };
  }

  // 磁盘：共多少 G / 剩多少 G / 剩多少 % 可用
  function diskView(disk) {
    const d = disk || {};
    const freePercent = Math.round(toNumber(d.freePercent));
    return {
      letter: String(d.letter || ''),
      totalText: fmtGB(d.total),
      freeText: fmtGB(d.free),
      freePercent: freePercent,
      freePercentText: fmtPercent(freePercent),
      lineText: '共 ' + fmtGB(d.total) + ' G · 剩 ' + fmtGB(d.free) + ' G · ' + fmtPercent(freePercent),
      barPercent: barWidth(100 - freePercent),
      level: levelOf(freePercent),
    };
  }

  // 多盘排序：按盘符字母序，保证每次渲染顺序稳定
  function sortDisks(disks) {
    return (disks || []).slice().sort(function (a, b) {
      return String((a && a.letter) || '').localeCompare(String((b && b.letter) || ''));
    });
  }

  function diskSummary(disks) {
    const list = disks || [];
    return '磁盘 ' + list.length + ' 个';
  }

  return {
    GB,
    DANGER_FREE_PERCENT,
    WARN_FREE_PERCENT,
    fmtGB,
    fmtPercent,
    barWidth,
    levelOf,
    cpuText,
    cpuBar,
    memView,
    diskView,
    sortDisks,
    diskSummary,
  };
});
