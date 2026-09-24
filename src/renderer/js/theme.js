// 主题系统（纯逻辑，无 DOM 依赖；Node / 浏览器双端导出）。
// 三套主题：light（默认浅色）/ dark（深色）/ glass（毛玻璃）。
// 说明：主题切换只做两件事 —— ① 在 <html> 上写 data-theme，② 渲染右上角切换器。
// 所有配色都在 style.css 的 :root / :root[data-theme] 里定义，本模块不持有任何颜色值。

const DEFAULT_THEME = 'light';

// 顺序即切换器里的显示顺序
const THEMES = [
  { id: 'light', label: '默认', hint: '默认主题', icon: 'sun' },
  { id: 'dark', label: '深色', hint: '深色主题', icon: 'moon' },
  { id: 'glass', label: '毛玻璃', hint: '毛玻璃主题', icon: 'glass' },
];

// 图标一律内联 SVG（离线可用，不依赖字体/网络，也不用 emoji）
const ICONS = {
  sun:
    '<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="7" cy="7" r="2.6"/><path d="M7 1v1.6M7 11.4V13M1 7h1.6M11.4 7H13M2.9 2.9l1.1 1.1M10 10l1.1 1.1M11.1 2.9L10 4M4 10l-1.1 1.1"/></svg>',
  moon:
    '<svg viewBox="0 0 14 14" width="13" height="13" fill="currentColor" aria-hidden="true">' +
    '<path d="M11.4 8.6A4.8 4.8 0 0 1 5.4 2.6a4.9 4.9 0 1 0 6 6z"/></svg>',
  glass:
    '<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M7 1.9s4 4.1 4 6.5a4 4 0 1 1-8 0C3 6 7 1.9 7 1.9z"/></svg>',
};

function themeIds() {
  return THEMES.map((t) => t.id);
}

function findTheme(id) {
  for (let i = 0; i < THEMES.length; i++) {
    if (THEMES[i].id === id) return THEMES[i];
  }
  return null;
}

// 容错：任何非法/缺失值都归一到默认主题（旧数据文件里没有 theme 字段）
function normalizeTheme(value) {
  return findTheme(value) ? value : DEFAULT_THEME;
}

// 从整份数据里读主题（数据可能缺 settings / 缺 theme）
function readTheme(data) {
  const t = data && data.settings ? data.settings.theme : null;
  return normalizeTheme(t);
}

function iconSvg(id) {
  const t = findTheme(id);
  return t ? ICONS[t.icon] : '';
}

// 三段式图标胶囊的 HTML（role=radiogroup 由容器提供）
function switcherHtml(current) {
  const active = normalizeTheme(current);
  return THEMES.map((t) => {
    const on = t.id === active;
    return (
      '<button type="button" class="theme-btn' + (on ? ' active' : '') + '"' +
      ' data-theme-btn="' + t.id + '"' +
      ' role="radio" aria-checked="' + on + '"' +
      ' aria-label="' + t.hint + '" title="' + t.hint + '">' +
      iconSvg(t.id) +
      '</button>'
    );
  }).join('');
}

// 把主题写到目标根节点上（默认 <html>）；返回归一化后的主题 id。
// 浅色也会显式写入（:root 即浅色令牌，data-theme="light" 无需额外规则），
// 这样"当前在哪一套主题"永远能从 DOM 上读到，测试与排查都省事。
function applyTheme(theme, target) {
  const id = normalizeTheme(theme);
  const el = target || (typeof document !== 'undefined' ? document.documentElement : null);
  if (el && el.dataset) el.dataset.theme = id;
  return id;
}

// Node 与浏览器双端导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_THEME,
    THEMES,
    ICONS,
    themeIds,
    normalizeTheme,
    readTheme,
    iconSvg,
    switcherHtml,
    applyTheme,
  };
}
if (typeof window !== 'undefined') {
  window.Theme = {
    DEFAULT_THEME,
    THEMES,
    ICONS,
    themeIds,
    normalizeTheme,
    readTheme,
    iconSvg,
    switcherHtml,
    applyTheme,
  };
}
