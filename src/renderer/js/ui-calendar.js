// 日历模块 UI。月视图 + 按日期聚待办数量 + 点击日查看/新增/删除当天计划（支持多笔）。
(function () {
  const Views = (window.Views = window.Views || {});

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function render(ctx) {
    const { state, api, save, refresh } = ctx;
    const { buildMonthGrid, dayKey, isToday, groupByDate } = api.calendar;
    const grid = buildMonthGrid(state.calYear, state.calMonth);
    const grouped = groupByDate(state.data.todos);
    const dow = ['一', '二', '三', '四', '五', '六', '日'];

    const cells = grid.weeks
      .map((week) =>
        week
          .map((day) => {
            if (day === null) return '<div class="cal-cell empty"></div>';
            const key = dayKey(grid.year, grid.month, day);
            const cnt = (grouped[key] || []).length;
            const dot = cnt > 0 ? '<span class="cal-dot"></span>' : '';
            const count = cnt > 0 ? `<span class="cal-count">${cnt}</span>` : '';
            const cls = ['cal-cell'];
            if (isToday(grid.year, grid.month, day)) cls.push('today');
            if (state.calSelected === key) cls.push('selected');
            return `<div class="${cls.join(' ')}" data-key="${key}">${day}${dot}${count}</div>`;
          })
          .join('')
      )
      .join('');

    const selectedTodos = state.calSelected ? grouped[state.calSelected] || [] : [];
    const sideRows = selectedTodos
      .map(
        (t) => `
      <div class="todo-row ${t.done ? 'done' : ''}">
        <div class="todo-check ${t.done ? 'done' : ''}" data-id="${t.id}"></div>
        <div class="todo-main"><div class="todo-title">${escapeHtml(t.title)}</div></div>
        <div class="todo-actions">
          <button class="icon-btn" data-act="cal-del" data-id="${t.id}">删除</button>
        </div>
      </div>`
      )
      .join('') || '<div class="empty">这一天还没有计划，点下方按钮新增</div>';
    const sideActions = state.calSelected
      ? '<button class="btn btn-primary" id="cal-add">+ 新增计划</button>'
      : '';

    const root = document.getElementById('view-calendar');
    root.innerHTML = `
      <div class="cal-wrap">
        <div class="cal-main">
          <div class="cal-head">
            <span class="cal-nav" data-nav="-1">‹</span>
            <span class="cal-title">${grid.year}年${grid.month + 1}月</span>
            <span class="cal-nav" data-nav="1">›</span>
            <span class="cal-today" id="cal-today">今天</span>
          </div>
          <div class="cal-grid">
            ${dow.map((d) => `<div class="cal-dow">${d}</div>`).join('')}
            ${cells}
          </div>
        </div>
        <div class="cal-side">
          <h3>${state.calSelected ? state.calSelected + ' 计划' : '选择日期查看/新增计划'}</h3>
          ${sideRows}
          ${sideActions}
        </div>
      </div>`;

    root.querySelectorAll('.cal-nav').forEach((n) => {
      n.onclick = () => changeMonth(ctx, parseInt(n.dataset.nav, 10));
    });
    root.querySelector('#cal-today').onclick = () => {
      const now = new Date();
      state.calYear = now.getFullYear();
      state.calMonth = now.getMonth();
      state.calSelected = null;
      render(ctx);
    };
    root.querySelectorAll('.cal-cell:not(.empty)').forEach((c) => {
      c.onclick = () => {
        state.calSelected = c.dataset.key;
        render(ctx);
      };
    });
    root.querySelectorAll('.cal-side .todo-check').forEach((ch) => {
      ch.onclick = () => {
        state.data.todos = api.store.toggleDone(state.data.todos, ch.dataset.id);
        save();
        refresh();
      };
    });
    const addBtn = root.querySelector('#cal-add');
    if (addBtn) addBtn.onclick = () => openCalModal(ctx);
    root.querySelectorAll('.cal-side [data-act="cal-del"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (confirm('确定删除该计划？')) {
          state.data.todos = api.store.deleteTodo(state.data.todos, btn.dataset.id);
          save();
          render(ctx);
        }
      };
    });
  }

  // 在日历侧栏直接新增当天计划：日期默认为选中日，可连续添加多笔
  function openCalModal(ctx) {
    const { state, api, save } = ctx;
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-mask"><div class="modal">
      <h3>新增计划 · ${state.calSelected}</h3>
      <div class="field"><label>标题（必填）</label><input id="f-title" /></div>
      <div class="field"><label>日期</label><input id="f-date" type="date" value="${state.calSelected}" /></div>
      <div class="field"><label>备注（可选）</label><textarea id="f-note"></textarea></div>
      <div class="modal-actions">
        <button class="btn" id="m-cancel">取消</button>
        <button class="btn btn-primary" id="m-save">保存</button>
      </div>
    </div></div>`;
    root.querySelector('#m-cancel').onclick = () => (root.innerHTML = '');
    root.querySelector('#m-save').onclick = () => {
      const title = root.querySelector('#f-title').value.trim();
      const date = root.querySelector('#f-date').value || state.calSelected;
      const note = root.querySelector('#f-note').value;
      if (!title) {
        alert('标题不能为空');
        return;
      }
      try {
        state.data.todos = api.store.addTodo(state.data.todos, { title, date, note });
        save();
        root.innerHTML = '';
        render(ctx);
      } catch (err) {
        alert(err.message);
      }
    };
  }

  function changeMonth(ctx, delta) {
    const { state } = ctx;
    let m = state.calMonth + delta;
    let y = state.calYear;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    state.calMonth = m;
    state.calYear = y;
    render(ctx);
  }

  Views.calendar = { render };
})();
