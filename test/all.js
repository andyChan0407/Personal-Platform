// 运行所有阶段测试。任一失败则整体退出码非 0。
// 说明：部分阶段（如 Phase 10/11）是异步的，会导出 Promise，这里 await 后按顺序汇总，
// 避免后启动的测试先 process.exit 把前面的汇总结果截断。
const files = [
  'phase1_skeleton.test.js',
  'phase2_data.test.js',
  'phase3_nav.test.js',
  'phase4_todo.test.js',
  'phase5_pomodoro.test.js',
  'phase6_stopwatch.test.js',
  'phase7_calendar.test.js',
  'phase8_integration.test.js',
  'phase9_packaging.test.js',
  'phase10_acceptance.test.js',
  'phase11_ui_design.test.js',
  'phase12_menu_cn.test.js',
  'phase13_capsule.test.js',
  'phase14_sysinfo_panel.test.js',
  'phase15_theme.test.js',
];

(async () => {
  let failed = false;
  for (const f of files) {
    try {
      const m = require('./' + f);
      if (m && typeof m.then === 'function') await m;
    } catch (e) {
      failed = true;
      console.error('FAIL  ' + f + ': ' + (e && e.message ? e.message : e));
    }
  }

  if (failed) {
    console.error('\n=== 存在失败测试 ===');
    process.exit(1);
  } else {
    console.log('\n=== 全部阶段测试通过 ===');
  }
})();
