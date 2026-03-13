import {createCalendarView, renderTagChips} from '/components/calendar-view.js';

const state = {
  tags: [],
  selectedTag: '',
  onlyIncomplete: true,
  calendar: null,
  selectedTask: null,
  selectedJournalDate: '',
  journalDates: new Set(),
  journalLoadSeq: 0,
  journalDotSeq: 0
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

function formatCnDate(dateIso) {
  const date = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

function getDrawerEls() {
  return {
    root: document.querySelector('#journalDrawer'),
    backdrop: document.querySelector('#journalDrawerBackdrop'),
    panel: document.querySelector('#journalDrawerPanel'),
    title: document.querySelector('#journalDateTitle'),
    input: document.querySelector('#journalText'),
    save: document.querySelector('#btnJournalSave'),
    close: document.querySelector('#btnDrawerClose'),
    meta: document.querySelector('#journalMeta')
  };
}

function setDrawerOpen(open) {
  const {root, input} = getDrawerEls();
  if (!root) return;
  root.classList.toggle('open', !!open);
  root.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open && input) {
    setTimeout(() => input.focus(), 40);
  }
}

function closeJournalDrawer() {
  state.selectedJournalDate = '';
  setDrawerOpen(false);
}

function applyJournalDotByContent(dateIso, content) {
  const hasContent = String(content || '').trim().length > 0;
  if (hasContent) state.journalDates.add(dateIso);
  else state.journalDates.delete(dateIso);
  state.calendar?.setJournalDates(Array.from(state.journalDates));
}

async function fetchJournalDotDates(range) {
  if (!range?.start || !range?.endExclusive) return;
  const seq = ++state.journalDotSeq;
  try {
    const qs = new URLSearchParams({from: range.start, to: range.endExclusive});
    const data = await api(`/api/journals?${qs.toString()}`);
    if (seq !== state.journalDotSeq) return;
    state.journalDates = new Set(data?.dates || []);
    state.calendar?.setJournalDates(Array.from(state.journalDates));
  } catch (e) {
    console.error(e);
  }
}

async function openJournalDrawer(dateIso) {
  const els = getDrawerEls();
  if (!els.root || !els.title || !els.input || !els.save || !els.meta) return;
  state.selectedJournalDate = dateIso;
  els.title.textContent = formatCnDate(dateIso);
  els.meta.textContent = '加载中...';
  els.input.value = '';
  els.input.disabled = true;
  els.save.disabled = true;
  setDrawerOpen(true);
  state.calendar?.clearSelection();
  state.selectedTask = null;
  renderTaskDetail();

  const seq = ++state.journalLoadSeq;
  try {
    const data = await api(`/api/journals/${dateIso}`);
    if (seq !== state.journalLoadSeq || state.selectedJournalDate !== dateIso) return;
    const content = data?.entry?.content || '';
    els.input.value = content;
    els.input.disabled = false;
    els.save.disabled = false;
    els.meta.textContent = data?.entry?.updated_at ? `最近保存：${data.entry.updated_at}` : '还没有记录，写点什么吧。';
    applyJournalDotByContent(dateIso, content);
  } catch (e) {
    if (seq !== state.journalLoadSeq) return;
    els.meta.textContent = '加载失败';
    els.input.disabled = false;
    els.save.disabled = true;
    alert('加载日记失败：' + e.message);
  }
}

async function saveJournal() {
  const els = getDrawerEls();
  const dateIso = state.selectedJournalDate;
  if (!dateIso || !els.input || !els.save || !els.meta) return;
  els.save.disabled = true;
  els.meta.textContent = '保存中...';
  const content = els.input.value || '';
  try {
    const data = await api(`/api/journals/${dateIso}`, {
      method: 'PUT',
      body: JSON.stringify({content})
    });
    if (state.selectedJournalDate !== dateIso) return;
    els.meta.textContent = data?.entry?.updated_at ? `最近保存：${data.entry.updated_at}` : '已保存';
    applyJournalDotByContent(dateIso, content);
  } catch (e) {
    if (state.selectedJournalDate !== dateIso) return;
    els.meta.textContent = '保存失败';
    alert('保存日记失败：' + e.message);
  } finally {
    if (state.selectedJournalDate === dateIso) els.save.disabled = false;
  }
}

function formatDateLabel(v) {
  const s = (v || '').trim();
  if (!s) return '—';
  return s;
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
    },
    onDateClick: (dateIso) => {
      openJournalDrawer(dateIso);
    },
    onViewRangeChange: (range) => {
      fetchJournalDotDates(range);
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
  document.querySelector('#journalDrawerBackdrop')
      ?.addEventListener('click', () => {
        closeJournalDrawer();
      });
  document.querySelector('#btnDrawerClose')?.addEventListener('click', () => {
    closeJournalDrawer();
  });
  document.querySelector('#btnJournalSave')?.addEventListener('click', () => {
    saveJournal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeJournalDrawer();
  });

  render();
  renderTaskDetail();
}

bootstrap().catch((e) => {
  console.error(e);
  alert('日历启动失败：' + e.message);
});
