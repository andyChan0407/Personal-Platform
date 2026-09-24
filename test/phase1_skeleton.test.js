// Phase 1 测试：项目骨架与初始化
// 校验：文件齐全、所有 JS 语法正确、package.json 合法且含打包配置、纯逻辑模块可在 Node 加载。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const files = [
  'package.json',
  'src/main.js',
  'src/preload.js',
  'src/renderer/index.html',
  'src/renderer/css/style.css',
  'src/renderer/js/storage.js',
  'src/renderer/js/store.js',
  'src/renderer/js/nav.js',
  'src/renderer/js/bus.js',
  'src/renderer/js/pomodoro.js',
  'src/renderer/js/stopwatch.js',
  'src/renderer/js/calendar.js',
  'src/renderer/js/app.js',
  'src/renderer/js/ui-todo.js',
  'src/renderer/js/ui-pomodoro.js',
  'src/renderer/js/ui-stopwatch.js',
  'src/renderer/js/ui-calendar.js',
  // 桌面胶囊与主菜单（后续迭代新增）
  'src/menu.js',
  'src/capsule-math.js',
  'src/preload-capsule.js',
  'src/renderer/capsule.html',
  'src/renderer/css/capsule.css',
  'src/renderer/js/capsule-ui.js',
];

// 1) 文件存在
files.forEach((f) => assert.ok(fs.existsSync(path.join(root, f)), '缺少文件: ' + f));

// 2) 所有 JS 通过 node --check 语法校验
files
  .filter((f) => f.endsWith('.js'))
  .forEach((f) => {
    const p = path.join(root, f);
    try {
      execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
    } catch (e) {
      assert.fail('语法错误: ' + f + '\n' + (e.stderr ? e.stderr.toString() : e.message));
    }
  });

// 3) package.json 合法且含关键字段
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.strictEqual(pkg.main, 'src/main.js');
assert.ok(pkg.scripts && pkg.scripts.start && pkg.scripts.build, 'package.json 缺少脚本');
assert.ok(pkg.build && pkg.build.win && pkg.build.win.target, 'package.json 缺少打包配置');

// 4) 纯逻辑模块可在 Node 中加载（无 DOM/Electron 依赖）
require(path.join(root, 'src/renderer/js/store'));
require(path.join(root, 'src/renderer/js/storage'));
require(path.join(root, 'src/renderer/js/nav'));
require(path.join(root, 'src/renderer/js/bus'));
require(path.join(root, 'src/renderer/js/calendar'));
require(path.join(root, 'src/renderer/js/pomodoro'));
require(path.join(root, 'src/renderer/js/stopwatch'));
require(path.join(root, 'src/menu'));
require(path.join(root, 'src/capsule-math'));

console.log('PASS  Phase 1: 项目骨架与初始化');
