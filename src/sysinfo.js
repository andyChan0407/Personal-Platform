// 系统资源采集（主进程侧）：CPU 使用率 / 内存占用 / 固定磁盘容量。
// 约束：不依赖 Electron，依赖全部可注入，便于 Node 端直接单测。
// 说明：CPU 使用率必须由两次采样求差值得出（os.cpus() 只给累计 tick，没有瞬时值）。
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const GB = 1024 * 1024 * 1024;
const DRIVE_CACHE_MS = 60 * 1000; // 盘符清单缓存时长：避免每次悬停都起子进程
const CPU_BASELINE_MS = 3000; // 上次采样超过该时长视为过期，重新取基准

// fsutil 的盘型文案随系统语言变化，命中以下关键字视为「非固定磁盘」；
// 都不命中时按固定磁盘保留 —— 宁可多列一个盘，也不要漏掉真实硬盘。
const NON_FIXED_KEYS = [
  'removable', 'cd-rom', 'cdrom', 'network', 'ram disk', 'no such',
  '可移动', '移动盘', '光盘', '光碟', '光盤', '网络', '網路', '远程', '遠端', '抽取',
];

/* ------------------------- CPU ------------------------- */
// 汇总所有核心的 idle / 总 tick
function cpuSnapshot(cpus) {
  let idle = 0;
  let total = 0;
  (cpus || []).forEach((c) => {
    const t = (c && c.times) || {};
    idle += t.idle || 0;
    total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.idle || 0) + (t.irq || 0);
  });
  return { idle, total };
}

// 两次快照之间的忙碌占比（%）。基准缺失或时间未前进时返回 null（界面显示 “--”）
function cpuUsage(prev, curr) {
  if (!prev || !curr) return null;
  const dt = curr.total - prev.total;
  const di = curr.idle - prev.idle;
  if (!(dt > 0)) return null;
  const busy = 1 - di / dt;
  return Math.min(100, Math.max(0, Math.round(busy * 100)));
}

/* ------------------------- 内存 ------------------------- */
// 注意口径：os.freemem() 只统计「完全空闲」内存，不含 Windows 的待机/缓存，
// 因此这里的剩余百分比会比任务管理器低几个百分点，换来的是零子进程开销。
function memInfo(totalBytes, freeBytes) {
  const total = Math.max(0, Number(totalBytes) || 0);
  const free = Math.min(total, Math.max(0, Number(freeBytes) || 0));
  const used = total - free;
  return {
    total,
    free,
    used,
    usedPercent: total > 0 ? Math.round((used / total) * 100) : 0,
    freePercent: total > 0 ? Math.round((free / total) * 100) : 0,
  };
}

/* ------------------------- 磁盘 ------------------------- */
// statfs 结果 → 磁盘信息（bavail 才是普通用户真正可用的剩余空间）
function driveInfo(letter, stat) {
  const bsize = (stat && Number(stat.bsize)) || 0;
  const total = bsize * ((stat && Number(stat.blocks)) || 0);
  const availTicks =
    stat && stat.bavail != null ? Number(stat.bavail) : (stat && Number(stat.bfree)) || 0;
  const free = bsize * (Number.isFinite(availTicks) ? availTicks : 0);
  const freePercent = total > 0 ? Math.round((free / total) * 100) : 0;
  return {
    letter: String(letter || '').toUpperCase(),
    total,
    free,
    used: Math.max(0, total - free),
    freePercent,
    usedPercent: total > 0 ? 100 - freePercent : 0,
  };
}

// 子进程输出解码：英文系统是纯 ASCII，中文系统是 GBK 字节
function decodeOut(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''));
  if (!b.length) return '';
  let ascii = true;
  for (let i = 0; i < b.length; i += 1) {
    if (b[i] >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return b.toString('ascii');
  try {
    return new TextDecoder('gbk').decode(b);
  } catch (e) {
    return b.toString('latin1');
  }
}

// fsutil 的盘型描述是否属于固定磁盘
function isFixedDriveText(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return true;
  return !NON_FIXED_KEYS.some((k) => s.includes(k.toLowerCase()));
}

// 穷举 A~Z，能读到容量且不为 0 的即为可访问盘符（不依赖外部进程，作为判型失败时的兜底）
function probeLetters(statfsSync) {
  const out = [];
  for (let i = 65; i <= 90; i += 1) {
    const letter = String.fromCharCode(i) + ':';
    try {
      const st = statfsSync(letter + '\\');
      if (st && st.blocks > 0) out.push(letter);
    } catch (e) {
      /* 盘符不存在 */
    }
  }
  return out;
}

function driveTypeText(execFileFn, letter) {
  return new Promise((resolve) => {
    execFileFn(
      'fsutil',
      ['fsinfo', 'drivetype', letter],
      { encoding: 'buffer', windowsHide: true },
      (err, stdout) => resolve(err ? null : decodeOut(stdout))
    );
  });
}

// 枚举「固定磁盘」盘符：fsutil 判定盘型 → 全部失败时退回可访问盘符全量
async function listFixedLetters(options) {
  const o = options || {};
  const execFileFn = o.execFile || execFile;
  const statfsSync = o.statfsSync || fs.statfsSync;
  const letters = probeLetters(statfsSync);
  if (!letters.length || process.platform !== 'win32') return letters;
  try {
    const texts = await Promise.all(letters.map((l) => driveTypeText(execFileFn, l)));
    const fixed = letters.filter((l, i) => texts[i] == null || isFixedDriveText(texts[i]));
    // 系统盘必定保留：判型文案异常时也不要把 C 盘滤掉
    const sysDrive = String(process.env.SystemDrive || 'C:').toUpperCase();
    if (letters.indexOf(sysDrive) >= 0 && fixed.indexOf(sysDrive) < 0) fixed.unshift(sysDrive);
    return fixed.length ? fixed : letters;
  } catch (e) {
    return letters;
  }
}

/* ------------------------- 进程级占用（真实采集） ------------------------- */
// 仅 Windows 可用：通过 PowerShell Get-Process 取每个进程的累计 CPU 秒数 + 工作集内存，
// 两次采样求差得到实时 CPU 占用率；按进程名聚合为「应用」，按内存降序取前 N。
// 该能力全部可注入（listSamples / getSelfPids / appNameMap），便于 Node 端单测。
const MB = 1024 * 1024;
// 进程 CPU 差值允许的最大时间跨度：超过视为「基准过期」（长时间收起面板后重开），
// 该帧 CPU 记 0，等下一帧拿到新鲜基准再给真实值，避免用久远基准算出误报值。
const MAX_CPU_DELTA_S = 5;
// 采集时按内存降序保留的「候选应用」条数（>渲染层展示上限，便于渲染层过滤系统进程后仍有足够应用）
const PROC_CANDIDATES = 30;

// 进程名（Get-Process 的 Name，无 .exe）→ 面向用户的友好名。缺失则回退原进程名。
const APP_NAME_MAP = {
  Weixin: '微信',
  WXWork: '企业微信',
  WeMail: '腾讯企业邮',
  MailMaster: '腾讯企业邮',
  MindMaster: 'MindMaster',
  '360zip': '360压缩',
  '360Zip': '360压缩',
  '360se': '360安全浏览器',
  Electron: 'Electron',
  explorer: 'Windows 资源管理器',
  Taskmgr: '任务管理器',
  wps: 'WPS Office',
  wpsoffice: 'WPS Office',
  et: 'WPS Office',
  wpspdf: 'WPS PDF',
  chrome: 'Chrome',
  chrome_crashpad: 'Chrome',
  Code: 'Visual Studio Code',
  CodeHelper: 'Visual Studio Code',
  svchost: 'Windows 服务主机',
  lsass: '本地安全机构',
  dwm: '桌面窗口管理器',
  csrss: '客户端服务运行时',
  winlogon: '登录进程',
  fontdrvhost: '字体驱动',
  SearchUI: 'Windows 搜索',
  SearchApp: 'Windows 搜索',
  TextInputHost: 'Windows 文本输入',
  SystemSettings: 'Windows 设置',
  ApplicationFrameHost: '应用框架宿主',
  ShellExperienceHost: 'Shell 体验宿主',
  RuntimeBroker: '运行时代理',
  sihost: 'Shell 基础宿主',
  ShellHost: 'Shell 宿主',
  dutok: 'Dutok',
};

// 应用图标：单字标签 + 主题色（无法内嵌真实 exe 图标时的代表色块）
const APP_ICON_COLOR = {
  Weixin: '#1AAD19',
  WXWork: '#2E8B57',
  WeMail: '#2F88FF',
  MailMaster: '#2F88FF',
  MindMaster: '#7C4DFF',
  '360zip': '#FF7A1A',
  '360Zip': '#FF7A1A',
  '360se': '#FF7A1A',
  Electron: '#4789FE',
  explorer: '#7A8A99',
  Taskmgr: '#7A8A99',
  wps: '#E8412C',
  wpsoffice: '#E8412C',
  et: '#E8412C',
  wpspdf: '#E8412C',
  chrome: '#F4B400',
  Code: '#3AA0F0',
  CodeHelper: '#3AA0F0',
  svchost: '#9AA1AC',
  lsass: '#9AA1AC',
  dwm: '#9AA1AC',
  csrss: '#9AA1AC',
  winlogon: '#9AA1AC',
};

function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'hsl(' + (h % 360) + ' 62% 50%)';
}

function iconFor(name) {
  const color = APP_ICON_COLOR[name] || hashColor(name);
  const label = (APP_NAME_MAP[name] || name).slice(0, 1);
  return { color, label };
}

function friendlyName(name, map) {
  const m = map || APP_NAME_MAP;
  return m[name] || name;
}

// Windows 系统/后台进程（按进程名，已去 .exe）。这些不是「用户应用」，
// 任务管理器会把它们归到「后台进程」而非「应用」分组——例如 Memory Compression（内存压缩）
// 常占 1GB+，用户会疑惑「今日毕里为什么有这个」。默认在弹层里隐藏，可一键显示。
const SYSTEM_PROCS = new Set([
  'System',
  'Secure System',
  'Registry',
  'System Idle Process',
  'Memory Compression',
  'smss',
  'csrss',
  'wininit',
  'winlogon',
  'services',
  'lsass',
  'lsaiso',
  'fontdrvhost',
  'dwm',
  'spoolsv',
  'svchost',
  'audiodg',
  'WUDFHost',
  'WmiPrvSE',
  'WmiApSrv',
  'conhost',
  'dllhost',
  'taskhostw',
  'sihost',
  'RuntimeBroker',
  'ShellExperienceHost',
  'StartMenuExperienceHost',
  'TextInputHost',
  'sppsvc',
  'TrustedInstaller',
  'TiWorker',
  'ctfmon',
  'smartscreen',
  'MsMpEng',
  'NisSrv',
  'SecurityHealthService',
  'SecurityHealthSystray',
  'SearchIndexer',
  'SearchProtocolHost',
  'SearchFilterHost',
  'MoUsoCoreWorker',
  'MpDefenderCoreService',
  'AggregatorHost',
  'CompatTelRunner',
  'Widgets',
  'WidgetService',
  'backgroundTaskHost',
  'SecurityHealthHost',
  'usocoreworker',
]);

// 判断是否为系统进程（原始进程名，大小写不敏感）
function isSystemProc(rawName) {
  if (!rawName) return false;
  if (SYSTEM_PROCS.has(rawName)) return true;
  return SYSTEM_PROCS.has(String(rawName).replace(/\.exe$/i, ''));
}

// PowerShell 脚本：列出进程的 Name/Id/CPU(累计秒)/WorkingSet(字节) → JSON。
// 关键：先把控制台输出编码强制为 UTF-8（Windows PowerShell 5.1 默认按 GBK 输出，会导致中文进程名乱码）。
// 性能：不再 Select 无用的 Path（载荷更小）、去掉 Where-Object 过滤（改由 JS 侧 parsePs 过滤，少一层 PS 对象管道）。
function psScriptText() {
  return (
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
    '$OutputEncoding=[System.Text.Encoding]::UTF8;' +
    '$ErrorActionPreference="SilentlyContinue";' +
    'Get-Process | Select-Object Name,Id,CPU,WorkingSet |' +
    ' ConvertTo-Json -Compress'
  );
}

// 把 PowerShell 的 JSON 输出解析成统一结构。单进程时 ConvertTo-Json 返回对象而非数组，需兜底。
function parsePs(stdout) {
  if (!stdout) return [];
  let data;
  try {
    data = JSON.parse(String(stdout).trim());
  } catch (e) {
    return [];
  }
  if (data && !Array.isArray(data)) data = [data];
  return (data || [])
    .map((p) => ({
      name: String((p && p.Name) || '?'),
      pid: Number((p && p.Id) || 0),
      cpuSeconds: p && p.CPU != null ? Number(p.CPU) || 0 : 0,
      memBytes: Number((p && p.WorkingSet) || 0),
      path: p && p.Path ? String(p.Path) : null,
    }))
    .filter((s) => s.memBytes > 0);
}

// 在途子进程登记：退出应用时统一 kill，避免残留进程拖住主进程
const liveChildren = new Set();
function killLiveChildren() {
  liveChildren.forEach((c) => {
    try {
      c.kill();
    } catch (e) {}
  });
  liveChildren.clear();
}

// 通用子进程执行：按字节返回，便于自行解码（中文系统可能是 GBK）
function execBuffer(execFileFn, file, args) {
  return new Promise((resolve) => {
    let child = null;
    const done = (err, stdout) => {
      if (child) liveChildren.delete(child);
      resolve({ err, stdout });
    };
    try {
      child = execFileFn(
        file,
        args,
        { encoding: 'buffer', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        done
      );
    } catch (e) {
      return resolve({ err: e, stdout: '' });
    }
    // execFileFn 可注入（单测为假实现，不会返回子进程）→ 有 .on 才登记
    if (child && typeof child.on === 'function') {
      liveChildren.add(child);
      child.on('error', () => liveChildren.delete(child));
      child.on('exit', () => liveChildren.delete(child));
    }
  });
}

// PowerShell 后端（兼容性最好但最慢）：见 psScriptText/parsePs
// 实测本机 PowerShell Get-Process+ConvertTo-Json ≈ 30s/次（被杀软深度扫描），仅作兜底。
function viaPowershell(execFileFn) {
  return execBuffer(execFileFn, 'powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    psScriptText(),
  ]).then(({ err, stdout }) => {
    if (err) return [];
    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout || ''));
    let text = buf.toString('utf8');
    if (text.indexOf('\uFFFD') >= 0) {
      try {
        text = new TextDecoder('gbk').decode(buf);
      } catch (e) {
        /* 保留 utf8 结果 */
      }
    }
    return parsePs(text.replace(/^\uFEFF/, ''));
  });
}

// wmic 后端（首选，实测 ≈ 0.9s）：UserModeTime/KernelModeTime 为 100ns 单位 → /1e7 = CPU 秒；
// WorkingSetSize 为字节；Name 形如 "weixin.exe"（去掉 .exe 以匹配友好名表）。
const WMIC_ARGS = [
  'process',
  'get',
  'Name,ProcessId,UserModeTime,KernelModeTime,WorkingSetSize',
  '/format:csv',
];
function parseWmic(input) {
  const text = decodeOut(input);
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (k) => header.indexOf(k);
  const iName = col('name');
  const iPid = col('processid');
  const iU = col('usermodetime');
  const iK = col('kerneltime');
  const iW = col('workingsetsize');
  if (iName < 0 || iPid < 0 || iW < 0) return [];
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = lines[i].split(',');
    const raw = (c[iName] || '').trim();
    if (!raw) continue;
    const memBytes = Number(c[iW]) || 0;
    if (memBytes <= 0) continue;
    out.push({
      name: raw.replace(/\.exe$/i, ''),
      pid: Number(c[iPid]) || 0,
      cpuSeconds: ((Number(c[iU]) || 0) + (Number(c[iK]) || 0)) / 1e7,
      memBytes,
      path: null,
    });
  }
  return out;
}
function viaWmic(execFileFn) {
  return execBuffer(execFileFn, 'wmic', WMIC_ARGS).then(({ err, stdout }) =>
    err ? [] : parseWmic(stdout)
  );
}

// tasklist 后端（次选，仅内存无 CPU）：CSV 列 = 映像名称,PID,会话名,会话#,内存使用（"12,345 K"）
function parseTasklist(input) {
  const text = decodeOut(input);
  const rows = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line) => {
      const s = line.trim();
      if (!s) return;
      const cols = s.replace(/^"|"$/g, '').split('","');
      if (cols.length < 5) return;
      const name = (cols[0] || '').replace(/\.exe$/i, '');
      const kb = Number(String(cols[4] || '').replace(/[^\d]/g, '')) || 0;
      if (!name || kb <= 0) return;
      rows.push({ name, pid: Number(cols[1]) || 0, cpuSeconds: 0, memBytes: kb * 1024, path: null });
    });
  return rows;
}
function viaTasklist(execFileFn) {
  return execBuffer(execFileFn, 'tasklist', ['/fo', 'csv', '/nh']).then(({ err, stdout }) =>
    err ? [] : parseTasklist(stdout)
  );
}

// 采集后端缓存：首次探测成功后记住，后续直接复用最快的那一个
let procBackend = null; // 'wmic' | 'tasklist' | 'powershell'

// 默认采集实现：优先 wmic（快 + 有 CPU），退 tasklist（快 + 仅内存），最后 PowerShell（慢 + 全信息）。
// execFileFn 可注入（单测时用假数据）。
function defaultListSamples(options) {
  const o = options || {};
  const execFileFn = o.execFile || execFile;
  const kind = o.backend || procBackend;
  if (kind === 'wmic') return viaWmic(execFileFn);
  if (kind === 'tasklist') return viaTasklist(execFileFn);
  if (kind === 'powershell') return viaPowershell(execFileFn);
  // 尚未探明后端：按 wmic → tasklist → powershell 依次尝试，成功即记住
  return viaWmic(execFileFn).then((list) => {
    if (list.length) {
      procBackend = 'wmic';
      return list;
    }
    return viaTasklist(execFileFn).then((l2) => {
      if (l2.length) {
        procBackend = 'tasklist';
        return l2;
      }
      procBackend = 'powershell';
      return viaPowershell(execFileFn);
    });
  });
}

// 把「原始采样」聚合成面向展示的「应用列表」。
// prevProcs: 上一次采样的 {pid -> {cpuSeconds, at}}，用于求 CPU 差值；首次传 null（CPU 记为 0）。
// selfPids: 本应用自身进程 pid 集合（来自 app.getAppMetrics），命中则标记 self。
function aggregate(samples, prevProcs, now, cores, selfPids, appMap) {
  const selfSet = new Set(selfPids || []);
  const groups = new Map();
  (samples || []).forEach((s) => {
    let g = groups.get(s.name);
    if (!g) {
      g = {
        name: s.name,
        count: 0,
        memBytes: 0,
        cpuSum: 0,
        path: null,
        self: false,
        system: isSystemProc(s.name),
      };
      groups.set(s.name, g);
    }
    g.count += 1;
    g.memBytes += s.memBytes || 0;
    let pct = 0;
    if (prevProcs && prevProcs.has(s.pid)) {
      const prev = prevProcs.get(s.pid);
      const elapsed = (now - prev.at) / 1000;
      const d = (s.cpuSeconds || 0) - (prev.cpuSeconds || 0);
      if (elapsed > 0 && elapsed <= MAX_CPU_DELTA_S && d > 0) pct = (d / elapsed) * 100;
    }
    g.cpuSum += Math.max(0, pct);
    if (!g.path && s.path) g.path = s.path;
    if (selfSet.has(s.pid)) g.self = true;
  });

  const maxPct = 100 * Math.max(1, cores || 1);
  const apps = Array.from(groups.values())
    .map((g) => {
      const cpuPercent = Math.min(maxPct, Math.max(0, g.cpuSum));
      const ic = iconFor(g.name);
      let status = '后台';
      if (g.self) status = '运行中';
      else if (g.system) status = '系统';
      else if (cpuPercent >= 2) status = '运行中';
      return {
        name: friendlyName(g.name, appMap),
        rawName: g.name,
        count: g.count,
        memBytes: g.memBytes,
        cpuPercent: cpuPercent,
        self: g.self,
        system: g.system,
        status: status,
        iconLabel: ic.label,
        iconColor: ic.color,
      };
    })
    .sort((a, b) => b.memBytes - a.memBytes)
    // 取「候选集」而非最终 12 条：渲染层可能默认隐藏系统进程，需要多给一些候选，
    // 免得系统进程把真实应用挤出榜单（最终展示条数由渲染层决定）。
    .slice(0, PROC_CANDIDATES);

  const cpuSum = Math.round(apps.reduce((acc, a) => acc + a.cpuPercent, 0));
  const memSumBytes = apps.reduce((acc, a) => acc + a.memBytes, 0);
  return { apps, cpuSum, memSumBytes, cores: Math.max(1, cores || 1) };
}

// 独立入口：供 Node 端脚本/按需 IPC 直接取一份聚合结果（首次调用 CPU 全为 0，两次调用即得真实占用）。
function collectProcessList(options) {
  const o = options || {};
  const listSamples = o.listSamples || defaultListSamples;
  const getSelfPids = o.getSelfPids || (() => []);
  const cpusFn = o.cpus || (() => os.cpus());
  return Promise.resolve(listSamples(o)).then((samples) => {
    const now = Date.now();
    const prev = new Map(
      (samples || []).map((s) => [s.pid, { cpuSeconds: s.cpuSeconds, at: now }])
    );
    return aggregate(samples, null, now, (cpusFn() || []).length, getSelfPids(), o.appNameMap);
  });
}

/* ------------------------- 采集器 ------------------------- */
// 按需采集：面板展开时 start()，移开鼠标 stop()，不在后台常驻
function createSysMonitor(options) {
  const o = options || {};
  const cpusFn = o.cpus || (() => os.cpus());
  const totalmemFn = o.totalmem || (() => os.totalmem());
  const freememFn = o.freemem || (() => os.freemem());
  const statfsSync = o.statfsSync || fs.statfsSync;
  const listLetters = o.listLetters || (() => listFixedLetters(o));
  // 进程采集默认关闭（返回空，不额外推送一帧）；真正启用由主进程注入 defaultListSamples
  const listSamples = o.listSamples || (() => Promise.resolve([]));
  const getSelfPids = o.getSelfPids || (() => []);
  const appNameMap = o.appNameMap || APP_NAME_MAP;
  const intervalMs = o.intervalMs || 1000;
  const warmupMs = o.warmupMs != null ? o.warmupMs : 500;
  const driveCacheMs = o.driveCacheMs != null ? o.driveCacheMs : DRIVE_CACHE_MS;
  // 进程级采集节流：进程列表变化远慢于 CPU/内存，没必要每秒都起 PowerShell。
  // 缓存 + 节流 + 防重入后，子进程开销从「每秒一次」降到「每 procIntervalMs 一次且不重叠」。
  const procIntervalMs = o.procIntervalMs != null ? o.procIntervalMs : 1500;

  let prev = null;
  let prevAt = 0;
  let timer = null;
  let warmup = null;
  let letters = null;
  let lettersAt = 0;
  let lettersLoading = false;
  let last = null;
  let prevProcs = null; // pid -> { cpuSeconds, at }：用于求进程级 CPU 差值
  let procData = null; // 最近一次聚合结果（缓存），系统帧直接带它，无需等待子进程
  let procDataAt = 0;
  let procInflight = false; // 防重入：同一时刻只允许一个进程采集在途
  let disposed = false; // 退出时置位，彻底停采（防退出后仍起子进程）
  let warmTimer = null;
  const listeners = [];

  function onUpdate(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  function emit(stats) {
    listeners.forEach((cb) => {
      try {
        cb(stats);
      } catch (e) {}
    });
  }

  // 刷新盘符清单（带缓存）。返回 true 表示清单发生变化，需要重新采样
  function refreshLetters(force) {
    if (lettersLoading) return Promise.resolve(false);
    if (!force && letters && Date.now() - lettersAt < driveCacheMs) return Promise.resolve(false);
    lettersLoading = true;
    return Promise.resolve()
      .then(() => listLetters())
      .then((list) => {
        const next = list && list.length ? list.slice() : probeLetters(statfsSync);
        const changed = JSON.stringify(next) !== JSON.stringify(letters || []);
        letters = next;
        lettersAt = Date.now();
        return changed;
      })
      .catch(() => false)
      .then((changed) => {
        lettersLoading = false;
        return changed;
      });
  }

  function readDisks() {
    const list = letters && letters.length ? letters : probeLetters(statfsSync);
    const out = [];
    list.forEach((letter) => {
      try {
        out.push(driveInfo(letter, statfsSync(letter + '\\')));
      } catch (e) {
        /* 盘符刚被拔出 */
      }
    });
    return out;
  }

  // 进程级采集：缓存 + 节流 + 防重入。force=true 时无视节流（预热/建立 CPU 基准时用）。
  function refreshProcesses(force) {
    if (disposed) return Promise.resolve(false);
    if (procInflight) return Promise.resolve(false);
    if (!force && procData && Date.now() - procDataAt < procIntervalMs) return Promise.resolve(false);
    procInflight = true;
    return Promise.resolve(listSamples(o))
      .then((samples) => {
        if (!samples || !samples.length) return false;
        const t = Date.now();
        const procs = aggregate(samples, prevProcs, t, (cpusFn() || []).length, getSelfPids(), appNameMap);
        // 以本次采样作为下一轮的 CPU 基准；首轮 prevProcs 为 null → 各应用 CPU 记为 0
        prevProcs = new Map(samples.map((s) => [s.pid, { cpuSeconds: s.cpuSeconds, at: t }]));
        procData = procs;
        procDataAt = t;
        if (last) {
          last = Object.assign({}, last, { processes: procs });
          emit(last);
        }
        return true;
      })
      .catch(() => false)
      .then((r) => {
        procInflight = false;
        return r;
      });
  }

  // 系统帧：CPU/内存/磁盘全部来自 os（零子进程），毫秒级；进程数据用缓存直接带上。
  // 进程采集异步、节流、不阻塞本帧，保证面板展开瞬间就有内容。
  function sample(opts) {
    const forceProc = Boolean(opts && opts.forceProc);
    const cpus = cpusFn() || [];
    const snap = cpuSnapshot(cpus);
    const cpu = cpuUsage(prev, snap);
    prev = snap;
    prevAt = Date.now();
    const cores = cpus.length;
    last = {
      cpu,
      cores,
      mem: memInfo(totalmemFn(), freememFn()),
      disks: readDisks(),
      at: prevAt,
      processes: procData, // 直接带缓存，避免每帧都等 PowerShell 子进程
    };
    emit(last);
    return refreshProcesses(forceProc).then(() => last);
  }

  function start() {
    if (disposed || timer || warmup) return;
    refreshLetters().then((changed) => {
      if (changed && last) sample();
    });
    sample(); // 首次采样没有 CPU 基准 → cpu 为 null，界面显示 “--”
    warmup = setTimeout(() => {
      warmup = null;
      sample({ forceProc: true }); // 建立进程 CPU 基准，第二帧即给出真实占用
    }, warmupMs);
    if (warmup && typeof warmup.unref === 'function') warmup.unref();
    timer = setInterval(sample, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (warmup) clearTimeout(warmup);
    timer = null;
    warmup = null;
    // 基准保留 3 秒：快速来回悬停时能立刻给出真实占用，长时间收起后重新取基准
    if (prev && Date.now() - prevAt > CPU_BASELINE_MS) prev = null;
  }

  // 预热：应用启动时先跑两次（间隔 ~700ms）建立 CPU 基准并填充进程缓存，
  // 让用户「首次」悬停即可秒显真实占用（含各应用 CPU%），不必等一轮冷启动采集。
  function warm() {
    if (disposed) return Promise.resolve();
    return sample({ forceProc: true })
      .then(
        () =>
          new Promise((res) => {
            warmTimer = setTimeout(() => {
              warmTimer = null;
              if (disposed) return res();
              sample({ forceProc: true }).then(res, res);
            }, 700);
            // unref：预热等待不拖住退出（否则退出时主进程会多活 ~700ms）
            if (warmTimer && typeof warmTimer.unref === 'function') warmTimer.unref();
          })
      )
      .catch(() => {});
  }

  // 彻底停采：清定时器 + 杀在途子进程 + 阻止后续再起采集（退出应用前调用）
  function dispose() {
    disposed = true;
    stop();
    if (warmTimer) {
      clearTimeout(warmTimer);
      warmTimer = null;
    }
    killLiveChildren();
  }

  function getStats() {
    return last;
  }

  function isRunning() {
    return Boolean(timer);
  }

  return { start, stop, sample, getStats, isRunning, onUpdate, refreshLetters, readDisks, warm, dispose };
}

const api = {
  GB,
  MB,
  DRIVE_CACHE_MS,
  MAX_CPU_DELTA_S,
  PROC_CANDIDATES,
  NON_FIXED_KEYS,
  APP_NAME_MAP,
  SYSTEM_PROCS,
  isSystemProc,
  cpuSnapshot,
  cpuUsage,
  memInfo,
  driveInfo,
  decodeOut,
  isFixedDriveText,
  probeLetters,
  listFixedLetters,
  parsePs,
  psScriptText,
  parseWmic,
  parseTasklist,
  defaultListSamples,
  aggregate,
  collectProcessList,
  createSysMonitor,
  killLiveChildren,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
