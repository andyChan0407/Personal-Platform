// 待办数据操作（纯函数，无 DOM / 无 I/O）。
// 所有函数接收旧数组、返回新数组，便于不可变更新与测试。
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalize(todo) {
  return {
    id: todo.id || uid(),
    title: String(todo.title || '').trim(),
    date: todo.date ? String(todo.date) : null, // YYYY-MM-DD 或 null(未排期)
    done: !!todo.done,
    note: todo.note ? String(todo.note) : '',
    createdAt: todo.createdAt || new Date().toISOString(),
  };
}

function addTodo(todos, input) {
  if (!input || !input.title || !String(input.title).trim()) {
    throw new Error('title required');
  }
  return [...todos, normalize(input)];
}

function updateTodo(todos, id, patch) {
  return todos.map((t) => {
    if (t.id !== id) return t;
    const merged = { ...t, ...patch };
    return normalize(merged);
  });
}

function deleteTodo(todos, id) {
  return todos.filter((t) => t.id !== id);
}

function toggleDone(todos, id) {
  return todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
}

// 按状态筛选：'all' | 'active' | 'done'
function filterByStatus(todos, status) {
  if (status === 'done') return todos.filter((t) => t.done);
  if (status === 'active') return todos.filter((t) => !t.done);
  return todos;
}

// 按标题实时搜索（不区分大小写）
function searchByTitle(todos, q) {
  if (!q) return todos;
  const s = String(q).trim().toLowerCase();
  if (!s) return todos;
  return todos.filter((t) => t.title.toLowerCase().includes(s));
}

// 按日期聚合：{ 'YYYY-MM-DD': [todo, ...] }，未排期不计入
function groupByDate(todos) {
  const m = {};
  todos.forEach((t) => {
    if (t.date) {
      if (!m[t.date]) m[t.date] = [];
      m[t.date].push(t);
    }
  });
  return m;
}

// Node（测试/主进程）与浏览器（渲染进程 <script>）双端导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    uid,
    normalize,
    addTodo,
    updateTodo,
    deleteTodo,
    toggleDone,
    filterByStatus,
    searchByTitle,
    groupByDate,
  };
}
if (typeof window !== 'undefined') {
  window.TodoStore = {
    uid,
    normalize,
    addTodo,
    updateTodo,
    deleteTodo,
    toggleDone,
    filterByStatus,
    searchByTitle,
    groupByDate,
  };
}
