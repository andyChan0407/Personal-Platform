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

/* ------------------------- 采集器 ------------------------- */
// 按需采集：面板展开时 start()，移开鼠标 stop()，不在后台常驻
function createSysMonitor(options) {
  const o = options || {};
  const cpusFn = o.cpus || (() => os.cpus());
  const totalmemFn = o.totalmem || (() => os.totalmem());
  const freememFn = o.freemem || (() => os.freemem());
  const statfsSync = o.statfsSync || fs.statfsSync;
  const listLetters = o.listLetters || (() => listFixedLetters(o));
  const intervalMs = o.intervalMs || 1000;
  const warmupMs = o.warmupMs != null ? o.warmupMs : 500;
  const driveCacheMs = o.driveCacheMs != null ? o.driveCacheMs : DRIVE_CACHE_MS;

  let prev = null;
  let prevAt = 0;
  let timer = null;
  let warmup = null;
  let letters = null;
  let lettersAt = 0;
  let lettersLoading = false;
  let last = null;
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

  function sample() {
    const cpus = cpusFn() || [];
    const snap = cpuSnapshot(cpus);
    const cpu = cpuUsage(prev, snap);
    prev = snap;
    prevAt = Date.now();
    last = {
      cpu,
      cores: cpus.length,
      mem: memInfo(totalmemFn(), freememFn()),
      disks: readDisks(),
      at: prevAt,
    };
    emit(last);
    return last;
  }

  function start() {
    if (timer || warmup) return;
    refreshLetters().then((changed) => {
      if (changed && last) sample();
    });
    sample(); // 首次采样没有 CPU 基准 → cpu 为 null，界面显示 “--”
    warmup = setTimeout(() => {
      warmup = null;
      sample();
    }, warmupMs);
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

  function getStats() {
    return last;
  }

  function isRunning() {
    return Boolean(timer);
  }

  return { start, stop, sample, getStats, isRunning, onUpdate, refreshLetters, readDisks };
}

const api = {
  GB,
  DRIVE_CACHE_MS,
  NON_FIXED_KEYS,
  cpuSnapshot,
  cpuUsage,
  memInfo,
  driveInfo,
  decodeOut,
  isFixedDriveText,
  probeLetters,
  listFixedLetters,
  createSysMonitor,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
