import {createCalendarView, renderTagChips} from '/components/calendar-view.js';

const state = {
  tags: [],
  selectedTag: '',
  onlyIncomplete: true,
  calendar: null,
  selectedTask: null,
  journalDate: '',
  journalLoadedDate: '',
  journalDirty: false,
  journalLoadingToken: 0
};

async function api(path, opts) {
  const res = await fetch(
      path, {headers: {'content-type': 'application/json'}, ...opts});
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'request_failed');
  return data;
}

async function fetchTags() {
  const data = await api('/api/tags');
  state.tags = data.tags || [];
}

async function fetchTasks({onlyIncomplete, tag}) {
  const qs = new URLSearchParams();
  if (onlyIncomplete) qs.set('completed', '0');
  if (tag) qs.set('tag', tag);
  const data = await api(`/api/tasks?${qs.toString()}`);
  return data.tasks || [];
}

function getFilters() {
  return {onlyIncomplete: state.onlyIncomplete, tag: state.selectedTag};
}

function formatDateLabel(v) {
  const s = (v || '').trim();
  if (!s) return '—';
  return s;
}

function localTodayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTs(v) {
  if (!v) return '尚未保存';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '已保存';
  return d.toLocaleString('zh-CN', {hour12: false});
}

function setJournalMeta(text) {
  const el = document.querySelector('#journalMeta');
  if (!el) return;
  el.textContent = text;
}

function renderTaskDetail() {
  const task = state.selectedTask;
  const box = document.querySelector('#taskDetail');
  const empty = document.querySelector('#taskDetailEmpty');
  const btn = document.querySelector('#btnDetailToggleComplete');
  const stateEl = document.querySelector('#detailState');
  if (!box || !empty) return;
  if (!task) {
    box.classList.add('hidden');
    empty.classList.remove('hidden');
    if (btn) btn.disabled = true;
    return;
  }
  empty.classList.add('hidden');
  box.classList.remove('hidden');

  const tags =
      Array.isArray(task.tags) ? task.tags : (task.tag ? [task.tag] : []);
  document.querySelector('#detailTitle').textContent =
      task.title || '未命名任务';
  document.querySelector('#detailGoal').textContent = task.goal || '未填写';
  document.querySelector('#detailTags').textContent =
      tags.length ? tags.join(' · ') : '无';
  document.querySelector('#detailDue').textContent =
      formatDateLabel(task.due_date);
  document.querySelector('#detailRange').textContent =
      task.start_date || task.end_date ?
      `${formatDateLabel(task.start_date)} ~ ${
          formatDateLabel(task.end_date)}` :
      '未设置';
  if (stateEl) {
    stateEl.textContent = task.completed ? '已完成' : '进行中';
    stateEl.classList.toggle('is-done', !!task.completed);
    stateEl.classList.toggle('is-open', !task.completed);
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = task.completed ? '标记为未完成' : '完成任务';
    btn.classList.toggle('btn-primary', !task.completed);
    btn.classList.toggle('btn-secondary', !!task.completed);
  }
}

async function toggleSelectedTask() {
  const task = state.selectedTask;
  const btn = document.querySelector('#btnDetailToggleComplete');
  if (!task || !btn) return;
  btn.disabled = true;
  try {
    const data = await api(`/api/tasks/${task.id}/toggle`, {method: 'PATCH'});
    const nextTask = data?.task || null;
    const hiddenByFilter = state.onlyIncomplete && !!nextTask?.completed;
    state.selectedTask = hiddenByFilter ? null : nextTask;
    renderTaskDetail();
    state.calendar?.clearSelection();
    state.calendar?.refetch();
  } catch (e) {
    alert('更新任务状态失败：' + e.message);
    btn.disabled = false;
  }
}

async function loadJournal(date) {
  const dateEl = document.querySelector('#journalDate');
  const contentEl = document.querySelector('#journalContent');
  const saveBtn = document.querySelector('#btnSaveJournal');
  if (!dateEl || !contentEl || !saveBtn) return;
  const value = (date || '').trim();
  if (!value) return;
  const token = ++state.journalLoadingToken;
  saveBtn.disabled = true;
  setJournalMeta('正在加载...');
  try {
    const data = await api(`/api/journals/${value}`);
    if (token !== state.journalLoadingToken) return;
    const entry = data?.entry || {};
    contentEl.value = entry.content || '';
    state.journalDate = value;
    state.journalLoadedDate = value;
    state.journalDirty = false;
    setJournalMeta(`最后保存：${formatTs(entry.updated_at)}`);
  } catch (e) {
    setJournalMeta('加载失败');
    alert('读取日记失败：' + e.message);
  } finally {
    if (token === state.journalLoadingToken) saveBtn.disabled = false;
  }
}

async function saveJournal() {
  const dateEl = document.querySelector('#journalDate');
  const contentEl = document.querySelector('#journalContent');
  const saveBtn = document.querySelector('#btnSaveJournal');
  if (!dateEl || !contentEl || !saveBtn) return;
  const value = (dateEl.value || '').trim();
  if (!value) {
    dateEl.focus();
    return;
  }
  saveBtn.disabled = true;
  setJournalMeta('正在保存...');
  try {
    const data = await api(`/api/journals/${value}`, {
      method: 'PUT',
      body: JSON.stringify({content: contentEl.value || ''})
    });
    state.journalDate = value;
    state.journalLoadedDate = value;
    state.journalDirty = false;
    setJournalMeta(`最后保存：${formatTs(data?.entry?.updated_at)}`);
  } catch (e) {
    setJournalMeta('保存失败');
    alert('保存日记失败：' + e.message);
  } finally {
    saveBtn.disabled = false;
  }
}

function render() {
  renderTagChips({
    el: document.querySelector('#tagList'),
    tags: state.tags,
    selectedTag: state.selectedTag,
    onSelect: (t) => {
      state.selectedTag = t;
      render();
      state.calendar?.refetch();
    }
  });
}

async function bootstrap() {
  await fetchTags();

  const calendarEl = document.querySelector('#calendar');
  state.calendar = createCalendarView({
    calendarEl,
    getFilters,
    fetchTasks,
    onTaskClick: (task) => {
      state.selectedTask = task || null;
      renderTaskDetail();
    }
  });

  document.querySelector('#chkOnlyIncomplete')
      .addEventListener('change', (e) => {
        state.onlyIncomplete = e.target.checked;
        state.calendar?.refetch();
      });

  document.querySelector('#btnReset').addEventListener('click', () => {
    state.selectedTag = '';
    state.onlyIncomplete = true;
    state.selectedTask = null;
    document.querySelector('#chkOnlyIncomplete').checked = true;
    state.calendar?.clearSelection();
    render();
    state.calendar?.refetch();
    renderTaskDetail();
  });
  document.querySelector('#btnDetailToggleComplete')
      .addEventListener('click', () => {
        toggleSelectedTask();
      });
  document.querySelector('#journalDate').addEventListener('change', (e) => {
    const nextDate = (e.target.value || '').trim();
    if (!nextDate) return;
    state.journalDate = nextDate;
    loadJournal(nextDate);
  });
  document.querySelector('#journalContent').addEventListener('input', () => {
    state.journalDirty = true;
    setJournalMeta('未保存更改');
  });
  document.querySelector('#btnSaveJournal').addEventListener('click', () => {
    saveJournal();
  });
  document.querySelector('#btnTodayJournal').addEventListener('click', () => {
    const today = localTodayIso();
    const dateEl = document.querySelector('#journalDate');
    dateEl.value = today;
    state.journalDate = today;
    loadJournal(today);
  });

  render();
  renderTaskDetail();
  const today = localTodayIso();
  const dateEl = document.querySelector('#journalDate');
  dateEl.value = today;
  state.journalDate = today;
  await loadJournal(today);
}

bootstrap().catch((e) => {
  console.error(e);
  alert('日历启动失败：' + e.message);
});
