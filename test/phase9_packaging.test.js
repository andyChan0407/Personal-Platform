// Phase 9 测试：打包为 Windows exe
// 校验 electron-builder 配置合法；若已执行构建，确认 dist/ 下产出可执行文件。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const b = pkg.build;

assert.ok(b, 'package.json 应有 build 配置');
assert.ok(b.appId, 'build.appId 必填');
assert.ok(b.productName, 'build.productName 必填');

// Windows 目标应为可双击运行类型（portable 单文件 / nsis 安装包）
assert.ok(b.win && b.win.target, 'build.win.target 应配置');
const t = b.win.target;
const targets = Array.isArray(t) ? t : [t];
const normalized = targets.map((x) => (typeof x === 'string' ? x : x.target));
assert.ok(
  normalized.some((x) => ['portable', 'nsis', 'nsis-web', 'default'].includes(x)),
  'win 目标应为可双击/可安装类型，当前: ' + normalized.join(',')
);

// 打包文件应包含源码
assert.ok(b.files.some((f) => String(f).includes('src')), 'build.files 应包含 src');
assert.ok(b.files.includes('package.json'), 'build.files 应包含 package.json');

// 若已执行构建，dist 下应存在 exe
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  const exes = fs.readdirSync(dist).filter((f) => f.endsWith('.exe'));
  assert.ok(exes.length > 0, 'dist/ 下应存在可执行文件（.exe）');
  // 便携包内的源码应与当前 src 同步（防止旧产物冒充新功能）
  const packedMain = path.join(dist, 'resources', 'app', 'src', 'main.js');
  if (fs.existsSync(packedMain)) {
    const packed = fs.readFileSync(packedMain, 'utf8');
    assert.ok(packed.includes('capsule.html'), '打包产物的主进程应已包含桌面胶囊逻辑（请重新执行 npm run pack:portable）');
    assert.ok(
      fs.existsSync(path.join(dist, 'resources', 'app', 'src', 'renderer', 'capsule.html')),
      '打包产物应包含桌面胶囊页面'
    );
    assert.ok(
      packed.includes("require('./menu')"),
      '打包产物应包含中文菜单模块'
    );
    assert.ok(
      packed.includes("require('./sysinfo')"),
      '打包产物应包含系统资源采集模块（CPU/内存/磁盘面板）'
    );
    assert.ok(
      fs.existsSync(path.join(dist, 'resources', 'app', 'src', 'sysinfo.js')),
      '打包产物应包含系统资源采集模块 sysinfo.js'
    );
    assert.ok(
      fs.existsSync(path.join(dist, 'resources', 'app', 'src', 'sysinfo-format.js')),
      '打包产物应包含资源展示文案模块 sysinfo-format.js'
    );
    assert.ok(
      fs.existsSync(path.join(dist, 'resources', 'app', 'src', 'renderer', 'js', 'theme.js')),
      '打包产物应包含主题模块 theme.js（三套主题切换）'
    );
  }
  console.log('PASS  Phase 9: 打包配置校验 + 已产出 exe (' + exes.join(', ') + ')');
} else {
  console.log('PASS  Phase 9: 打包配置校验（构建产物 dist/ 待执行 npm run build 生成）');
}
