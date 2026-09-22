// 待办清单模块（首页）。渲染列表、筛选、搜索、新建/编辑弹窗、勾选完成、删除。
(function () {
  const Views = (window.Views = window.Views || {});
  let filter = 'all';
  let query = '';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // 空状态插画（内联 SVG，离线可用；取色走 CSS 变量，三套主题各配一套）
  const EMPTY_TODO = `<div class="empty">
    <svg viewBox="0 0 120 90" fill="none" aria-hidden="true">
      <rect x="26" y="14" width="68" height="62" rx="10" fill="var(--empty-fill)" stroke="var(--empty-line)" stroke-width="2"/>
      <rect x="38" y="30" width="34" height="5" rx="2.5" fill="var(--empty-bar-1)"/>
      <rect x="38" y="44" width="44" height="5" rx="2.5" fill="var(--empty-bar-2)"/>
      <rect x="38" y="58" width="24" height="5" rx="2.5" fill="var(--empty-bar-2)"/>
      <circle cx="82" cy="60" r="16" fill="var(--empty-dot)" stroke="var(--empty-dot-line)" stroke-width="2"/>
      <path d="M75 60l5 5 9-10" stroke="var(--tomato)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <b>还没有待办</b>
    <span>点右上角「+ 新建待办」开始规划这一天</span>
  </div>`;

  function renderTodo(ctx) {
    const { state, api, save, refresh } = ctx;
    const root = document.getElementById('view-todo');
    let list = api.store.filterByStatus(state.data.todos, filter);
    list = api.store.searchByTitle(list, query);

    const rows = list
      .map((t) => {
        const dateHtml = t.date
          ? `<span class="todo-date">${t.date.slice(5).replace('-', '月')}日</span>`
          : `<span class="todo-date undated">未排期</span>`;
        const noteHtml = t.note
          ? `<span class="todo-note">${escapeHtml(t.note)}</span>`
          : '';
        return `<div class="todo-row ${t.done ? 'done' : ''}" data-id="${t.id}">
          <div class="todo-check ${t.done ? 'done' : ''}" data-act="toggle" role="checkbox" aria-checked="${t.done}"></div>
          <div class="todo-main">
            <div class="todo-title">${escapeHtml(t.title)}</div>
            ${noteHtml}
          </div>
          ${dateHtml}
          <div class="todo-actions">
            <button class="icon-btn" data-act="edit">编辑</button>
            <button class="icon-btn" data-act="del">删除</button>
          </div>
        </div>`;
      })
      .join('');

    const total = state.data.todos.length;
    const undone = state.data.todos.filter((t) => !t.done).length;

    root.innerHTML = `
      <div class="todo-header">
        <div class="todo-heading">
          <h2>待办清单</h2>
          <span class="todo-sub">共 ${total} 项 · 未完成 ${undone} 项</span>
        </div>
        <div class="todo-tools">
          <div class="search-wrap">
            <input class="search" id="todo-search" placeholder="搜索待办" value="${escapeHtml(query)}" />
          </div>
          <button class="btn btn-primary" id="new-todo">+ 新建待办</button>
        </div>
      </div>
      <div class="filters">
        <span class="filter ${filter === 'all' ? 'active' : ''}" data-f="all">全部</span>
        <span class="filter ${filter === 'active' ? 'active' : ''}" data-f="active">未完成</span>
        <span class="filter ${filter === 'done' ? 'active' : ''}" data-f="done">已完成</span>
      </div>
      <div class="todo-list">${rows || EMPTY_TODO}</div>
    `;

    root.querySelector('#new-todo').onclick = () => openModal(ctx, null);
    root.querySelector('#todo-search').oninput = (e) => {
      query = e.target.value;
      renderTodo(ctx);
    };
    root.querySelectorAll('.filter').forEach((f) => {
      f.onclick = () => {
        filter = f.dataset.f;
        renderTodo(ctx);
      };
    });
    root.querySelectorAll('.todo-row').forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('[data-act="toggle"]').onclick = (e) => {
        e.stopPropagation();
        state.data.todos = api.store.toggleDone(state.data.todos, id);
        save();
        refresh();
      };
      row.querySelector('[data-act="edit"]').onclick = () => openModal(ctx, id);
      row.querySelector('[data-act="del"]').onclick = () => {
        if (confirm('确定删除该待办？')) {
          state.data.todos = api.store.deleteTodo(state.data.todos, id);
          save();
          refresh();
        }
      };
    });
  }

  function openModal(ctx, id) {
    const { state, api, save, refresh } = ctx;
    const editing = id ? state.data.todos.find((t) => t.id === id) : null;
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-mask"><div class="modal">
      <h3>${editing ? '编辑待办' : '新建待办'}</h3>
      <div class="field"><label>标题（必填）</label><input id="f-title" value="${editing ? escapeHtml(editing.title) : ''}" /></div>
      <div class="field"><label>日期（可选）</label><input id="f-date" type="date" value="${editing ? escapeHtml(editing.date || '') : ''}" /></div>
      <div class="field"><label>备注（可选）</label><textarea id="f-note">${editing ? escapeHtml(editing.note || '') : ''}</textarea></div>
      <div class="modal-actions">
        <button class="btn" id="m-cancel">取消</button>
        <button class="btn btn-primary" id="m-save">保存</button>
      </div>
    </div></div>`;
    root.querySelector('#m-cancel').onclick = () => (root.innerHTML = '');
    root.querySelector('#m-save').onclick = () => {
      const title = root.querySelector('#f-title').value.trim();
      const date = root.querySelector('#f-date').value || null;
      const note = root.querySelector('#f-note').value;
      if (!title) {
        alert('标题不能为空');
        return;
      }
      try {
        if (editing) {
          state.data.todos = api.store.updateTodo(state.data.todos, id, { title, date, note });
        } else {
          state.data.todos = api.store.addTodo(state.data.todos, { title, date, note });
        }
        save();
        root.innerHTML = '';
        refresh();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  Views.todo = { render: renderTodo };
})();
