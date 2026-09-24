// 本地数据持久化层：读写单个 JSON 文件。
// 设计要点（对齐 PRD 第 6 节）：
//  - 文件缺失/损坏时返回空数据且不抛错（容错）
//  - 保存时先写临时文件再 rename，避免半写损坏
// 该模块在 Node 上下文运行（Electron 主进程/预加载），亦可被 Node 测试直接 require。
const fs = require('fs');
const path = require('path');

function defaultData() {
  return { todos: [], settings: { workMin: 25, breakMin: 5, theme: 'light' } };
}

function createStorage(filePath) {
  function ensureDir() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch (e) {
      // 目录已存在等忽略
    }
  }

  function load() {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw || raw.trim() === '') return defaultData();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.todos)) return defaultData();
      if (!data.settings) data.settings = { workMin: 25, breakMin: 5, theme: 'light' };
      if (typeof data.settings.workMin !== 'number') data.settings.workMin = 25;
      if (typeof data.settings.breakMin !== 'number') data.settings.breakMin = 5;
      // 老数据文件没有主题字段，补默认值（合法性与容错交给 theme.js 统一处理）
      if (typeof data.settings.theme !== 'string') data.settings.theme = 'light';
      return data;
    } catch (e) {
      // 文件损坏/解析失败：以空数据启动，不崩溃（PRD 验收 11）
      return defaultData();
    }
  }

  function save(data) {
    ensureDir();
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return { load, save, filePath };
}

module.exports = { createStorage, defaultData };
