// 日历逻辑（纯函数，可测试）。
//  - 构建月视图网格（周一为每周起始）
//  - 按日期聚合待办数量（来自 store.groupByDate）
// groupByDate 复用 store 的实现（单一来源）：
// Node 上下文走 require；浏览器上下文走 window.TodoStore（index.html 中 store.js 先于本文件加载）。
// 注意：必须命名为 groupByDateImpl —— 浏览器 <script> 共享全局作用域，
// store.js 顶层 function groupByDate 已占用该全局名，顶层 const 同名会抛 SyntaxError。
const groupByDateImpl =
  typeof require === 'function'
    ? require('./store').groupByDate
    : window.TodoStore.groupByDate;

function buildMonthGrid(year, month) {
  // month: 0-based
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // 周一=0 ... 周日=6
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { year, month, weeks };
}

// 生成 'YYYY-MM-DD'
function dayKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 判断某天是否为今天（本地日期）
function isToday(year, month, day) {
  const now = new Date();
  return (
    now.getFullYear() === year &&
    now.getMonth() === month &&
    now.getDate() === day
  );
}

// Node 与浏览器双端导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildMonthGrid, dayKey, isToday, groupByDate: groupByDateImpl };
}
if (typeof window !== 'undefined') {
  window.CalendarLogic = { buildMonthGrid, dayKey, isToday, groupByDate: groupByDateImpl };
}
