// 离线手动打包：复用已下载的 Electron 二进制，将应用源码挂到 resources/app。
// 产物 dist/ 即为可双击运行的便携应用（双击 我的待办.exe 启动）。
// 适用于本机无法访问 GitHub 拉取 electron-builder 工具链的场景。
//
// 设计为可重复执行：清理步骤对“删除被环境拦截”做了优雅降级，
// 后续 copyFileSync 会覆盖同名文件，重命名前先移除目标，避免 EEXIST。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
// 默认输出到 dist/；若命令行传入第一个参数（如 dist-debug），则输出到该目录，
// 便于在不覆盖被锁定 dist/ 的情况下验证构建。
const out = path.join(root, process.argv[2] || 'dist');
const appDir = path.join(out, 'resources', 'app');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 安全删除：被安全删除 shim 拦截时忽略，靠后续覆盖即可
function safeRemove(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {
    // 忽略：copyFileSync 会覆盖同名文件
  }
}

// 清理上次便携构建产物（不碰 electron-builder 残留，避免误删大目录）
safeRemove(appDir);
const exeOld = path.join(out, 'electron.exe');
const exeNew = path.join(out, '我的待办.exe');
safeRemove(exeOld);
safeRemove(exeNew);

// 复制 Electron 运行时
copyDir(electronDist, out);
// 复制应用源码（覆盖式）
copyDir(path.join(root, 'src'), path.join(appDir, 'src'));
// 应用入口
fs.writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify({ name: '我的待办', version: '1.0.0', main: 'src/main.js' }, null, 2)
);
// 移除 Electron 默认示例应用，避免干扰
const def = path.join(out, 'resources', 'default_app.asar');
if (fs.existsSync(def)) safeRemove(def);
// 将 electron.exe 重命名为可读的中文可执行名（先移除目标再重命名）
if (fs.existsSync(exeNew)) safeRemove(exeNew);
if (fs.existsSync(exeOld)) fs.renameSync(exeOld, exeNew);

console.log('portable 构建完成 ->', exeNew);
