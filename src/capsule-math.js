// 桌面胶囊的位置与拖拽数学（纯函数，无 Electron 依赖，便于单元测试）。
const DEFAULT_SIZE = { width: 184, height: 56 };
const DEFAULT_MARGIN = 24;
const CLICK_THRESHOLD = 6; // px：小于该位移视为点击而非拖拽

// 资源面板展开参数：卡片宽 300 + 左右各 6 内边距 = 窗口宽 312
const PANEL = { width: 300, edge: 6, gap: 6, capsuleHeight: 44 };

// 今日日期键（与日历/待办同一格式 YYYY-MM-DD）
function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 计算胶囊初始位置：优先用保存的位置，否则贴右下角；越界则夹紧回可视工作区
function resolvePosition(saved, workArea, size = DEFAULT_SIZE, margin = DEFAULT_MARGIN) {
  const wa = workArea || { x: 0, y: 0, width: 1024, height: 768 };
  const maxX = wa.x + wa.width - size.width - margin;
  const maxY = wa.y + wa.height - size.height - margin;
  const def = {
    x: Math.max(wa.x + margin, maxX),
    y: Math.max(wa.y + Math.floor(wa.height / 3), wa.y + margin),
  };
  const valid = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y);
  if (!valid) return def;
  return {
    x: clamp(saved.x, wa.x + 0, Math.max(wa.x, maxX)),
    y: clamp(saved.y, wa.y + 0, Math.max(wa.y, maxY)),
  };
}

function clamp(v, min, max) {
  if (Number.isNaN(v)) return min;
  return Math.min(Math.max(v, min), Math.max(min, max));
}

// 拖拽：由“按下时鼠标坐标 + 当前鼠标坐标 + 按下时窗口坐标”推导新窗口坐标
function nextPosition(mouse0, mouseNow, win0) {
  const dx = (mouseNow && mouseNow.x != null ? mouseNow.x : 0) - (mouse0 && mouse0.x != null ? mouse0.x : 0);
  const dy = (mouseNow && mouseNow.y != null ? mouseNow.y : 0) - (mouse0 && mouse0.y != null ? mouse0.y : 0);
  return { x: (win0 ? win0.x : 0) + dx, y: (win0 ? win0.y : 0) + dy };
}

// 是否应视为“点击”（位移小于阈值）
function isClick(a, b, threshold = CLICK_THRESHOLD) {
  const dx = Math.abs((a ? a.x : 0) - (b ? b.x : 0));
  const dy = Math.abs((a ? a.y : 0) - (b ? b.y : 0));
  return dx < threshold && dy < threshold;
}

// 展开资源面板时的窗口布局：
// ① 横向——优先向右展开；右侧空间不够则改为向左展开，保证胶囊视觉位置不动
// ② 纵向——优先在胶囊下方显示；下方空间不够则翻到胶囊上方
// 返回 bounds（主进程 setBounds 用）、place（below/above）、capsuleInset/align（胶囊在窗口内的定位）
function resolveExpanded(collapsed, workArea, panelHeight, options = {}) {
  const edge = options.edge != null ? options.edge : PANEL.edge;
  const gap = options.gap != null ? options.gap : PANEL.gap;
  const panelWidth = options.panelWidth != null ? options.panelWidth : PANEL.width;
  const capH = options.capsuleHeight != null ? options.capsuleHeight : PANEL.capsuleHeight;
  const wa = workArea || { x: 0, y: 0, width: 1024, height: 768 };
  const box = collapsed || { x: 0, y: 0, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height };
  const h = Math.max(0, Number(panelHeight) || 0);

  const width = panelWidth + edge * 2;
  const height = edge * 2 + capH + gap + h;
  const capW = box.width - edge * 2;

  // 横向：右展开放不下就整体左移（窗口右移量 = 窗口变宽量）
  const maxX = wa.x + wa.width - width;
  let x = box.x;
  if (x > maxX) x = box.x + box.width - width;
  x = clamp(x, wa.x, Math.max(wa.x, maxX));

  // 纵向：下方能放下就放下，否则比较上下空间取更宽裕的一侧
  const needBelow = gap + h + edge;
  const spaceBelow = wa.y + wa.height - (box.y + box.height);
  const spaceAbove = box.y - wa.y;
  const place = spaceBelow < needBelow && spaceAbove > spaceBelow ? 'above' : 'below';
  let y = place === 'below' ? box.y : box.y + box.height - height;
  y = clamp(y, wa.y, Math.max(wa.y, wa.y + wa.height - height));

  // 胶囊在新窗口里的水平落点：保持它在屏幕上的绝对位置
  let inset = clamp(box.x - x + edge, edge, Math.max(edge, width - edge - capW));
  return {
    bounds: { x, y, width, height },
    place,
    capsuleInset: inset,
    align: inset > edge ? 'right' : 'left',
    panelHeight: h,
  };
}

// 胶囊展示文案
function capsuleText({ timerText, todayCount = 0, undone = 0 } = {}) {
  if (timerText) return timerText;
  if (todayCount > 0) return `今日待办 ${todayCount}`;
  if (undone > 0) return `未完成 ${undone}`;
  return '我的待办';
}

// Node 与浏览器双端导出（浏览器端由胶囊页面通过 ../capsule-math.js 加载）
const api = {
  DEFAULT_SIZE,
  DEFAULT_MARGIN,
  CLICK_THRESHOLD,
  PANEL,
  todayKey,
  resolvePosition,
  nextPosition,
  isClick,
  clamp,
  capsuleText,
  resolveExpanded,
};
if (typeof window !== 'undefined') window.CapsuleMath = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
