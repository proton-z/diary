import {createCalendarView, renderTagChips} from '/components/calendar-view.js';

const state = {
  tags: [],
  selectedTag: '',
  onlyIncomplete: true,
  calendar: null,
  selectedTask: null,
  selectedJournalDate: '',
  journalMarks: new Map(),
  journalLoadSeq: 0,
  journalDotSeq: 0,
  journalDirty: false,
  journalAutoSaveTimer: 0,
  journalSaving: false
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
  return new Intl
      .DateTimeFormat('zh-CN', {year: 'numeric', month: 'long', day: 'numeric'})
      .format(date);
}

function getDrawerEls() {
  return {
    root: document.querySelector('#journalDrawer'),
    backdrop: document.querySelector('#journalDrawerBackdrop'),
    panel: document.querySelector('#journalDrawerPanel'),
    title: document.querySelector('#journalDateTitle'),
    subMeta: document.querySelector('#journalSubMeta'),
    input: document.querySelector('#journalText'),
    save: document.querySelector('#btnJournalSave'),
    close: document.querySelector('#btnDrawerClose'),
    clear: document.querySelector('#btnJournalClear'),
    meta: document.querySelector('#journalMeta'),
    statChars: document.querySelector('#journalStatChars'),
    statWords: document.querySelector('#journalStatWords'),
    sync: document.querySelector('#journalSyncState'),
    templateSummary: document.querySelector('#btnTplSummary'),
    templatePlan: document.querySelector('#btnTplPlan'),
    templateReflect: document.querySelector('#btnTplReflect')
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
  if (state.journalAutoSaveTimer) {
    clearTimeout(state.journalAutoSaveTimer);
    state.journalAutoSaveTimer = 0;
  }
  state.journalDirty = false;
  state.selectedJournalDate = '';
  setDrawerOpen(false);
}

function getJournalLevelByLength(length) {
  const len = Number(length) || 0;
  return len >= 360 ? 'rich' : len >= 120 ? 'regular' : 'tiny';
}

function commitJournalMark(mark) {
  if (!mark?.date) return;
  state.journalMarks.set(mark.date, mark);
  state.calendar?.setJournalMarks(Array.from(state.journalMarks.values()));
}

function removeJournalMark(dateIso) {
  if (!dateIso) return;
  state.journalMarks.delete(dateIso);
  state.calendar?.setJournalMarks(Array.from(state.journalMarks.values()));
}

function applyJournalDotByContent(dateIso, content, updatedAt) {
  const len = String(content || '').trim().length;
  const hasContent = String(content || '').trim().length > 0;
  if (hasContent) {
    commitJournalMark({
      date: dateIso,
      level: getJournalLevelByLength(len),
      length: len,
      updated_at: updatedAt || ''
    });
    return;
  }
  removeJournalMark(dateIso);
}

function formatIsoDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl
      .DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
      .format(d);
}

function analyzeJournalText(text) {
  const raw = String(text || '');
  const chars = raw.trim().length;
  const words = raw.trim().split(/\s+/).filter(Boolean).length;
  return {chars, words};
}

function renderJournalStats(content) {
  const {statChars, statWords} = getDrawerEls();
  const {chars, words} = analyzeJournalText(content);
  if (statChars) statChars.textContent = `字数 ${chars}`;
  if (statWords) statWords.textContent = `词数 ${words}`;
}

function setJournalSyncState(kind, text) {
  const {sync} = getDrawerEls();
  if (!sync) return;
  sync.dataset.state = kind;
  sync.textContent = text;
}

function markJournalDirty() {
  state.journalDirty = true;
  setJournalSyncState('editing', '编辑中');
  if (state.journalAutoSaveTimer) clearTimeout(state.journalAutoSaveTimer);
  state.journalAutoSaveTimer = setTimeout(() => {
    saveJournal({mode: 'auto'});
  }, 1000);
}

async function fetchJournalDotDates(range) {
  if (!range?.start || !range?.endExclusive) return;
  const seq = ++state.journalDotSeq;
  try {
    const qs = new URLSearchParams({from: range.start, to: range.endExclusive});
    const data = await api(`/api/journals?${qs.toString()}`);
    if (seq !== state.journalDotSeq) return;
    const marks = Array.isArray(data?.marks) ? data.marks : [];
    if (marks.length) {
      state.journalMarks =
          new Map(marks.filter((m) => m?.date).map((m) => [m.date, m]));
      state.calendar?.setJournalMarks(Array.from(state.journalMarks.values()));
      return;
    }
    const dates = Array.isArray(data?.dates) ? data.dates : [];
    state.journalMarks =
        new Map(dates.map((date) => [date, {date, level: 'tiny', length: 1}]));
    state.calendar?.setJournalMarks(Array.from(state.journalMarks.values()));
  } catch (e) {
    console.error(e);
  }
}

async function openJournalDrawer(dateIso) {
  const els = getDrawerEls();
  if (!els.root || !els.title || !els.input || !els.save || !els.meta) return;
  state.selectedJournalDate = dateIso;
  state.journalDirty = false;
  els.title.textContent = formatCnDate(dateIso);
  if (els.subMeta) els.subMeta.textContent = `${dateIso} · 每日日记`;
  els.meta.textContent = '加载中...';
  els.input.value = '';
  els.input.disabled = true;
  els.save.disabled = true;
  if (els.clear) els.clear.disabled = true;
  renderJournalStats('');
  setJournalSyncState('loading', '加载中');
  setDrawerOpen(true);
  state.calendar?.clearSelection();
  state.selectedTask = null;
  renderTaskDetail();

  const seq = ++state.journalLoadSeq;
  try {
    const data = await api(`/api/journals/${dateIso}`);
    if (seq !== state.journalLoadSeq || state.selectedJournalDate !== dateIso)
      return;
    const content = data?.entry?.content || '';
    els.input.value = content;
    els.input.disabled = false;
    els.save.disabled = false;
    if (els.clear) els.clear.disabled = false;
    els.meta.textContent = data?.entry?.updated_at ?
        `最近更新：${formatIsoDateTime(data.entry.updated_at)}` :
        '还没有记录，写点什么吧。';
    renderJournalStats(content);
    setJournalSyncState('synced', content.trim() ? '已同步' : '待记录');
    applyJournalDotByContent(dateIso, content, data?.entry?.updated_at || '');
  } catch (e) {
    if (seq !== state.journalLoadSeq) return;
    els.meta.textContent = '加载失败';
    els.input.disabled = false;
    els.save.disabled = true;
    setJournalSyncState('error', '加载失败');
    alert('加载日记失败：' + e.message);
  }
}

async function saveJournal({mode = 'manual'} = {}) {
  const els = getDrawerEls();
  const dateIso = state.selectedJournalDate;
  if (!dateIso || !els.input || !els.save || !els.meta) return;
  if (mode === 'auto' && !state.journalDirty) return;
  if (state.journalSaving) return;
  if (state.journalAutoSaveTimer) {
    clearTimeout(state.journalAutoSaveTimer);
    state.journalAutoSaveTimer = 0;
  }
  state.journalSaving = true;
  els.save.disabled = true;
  setJournalSyncState('saving', mode === 'auto' ? '自动保存中' : '保存中');
  if (mode === 'manual') els.meta.textContent = '保存中...';
  const content = els.input.value || '';
  try {
    const data = await api(
        `/api/journals/${dateIso}`,
        {method: 'PUT', body: JSON.stringify({content})});
    if (state.selectedJournalDate !== dateIso) return;
    state.journalDirty = false;
    const ts = data?.entry?.updated_at || '';
    els.meta.textContent = ts ? `最近更新：${formatIsoDateTime(ts)}` : '已保存';
    setJournalSyncState('synced', mode === 'auto' ? '自动保存完成' : '已同步');
    applyJournalDotByContent(dateIso, content, ts);
  } catch (e) {
    if (state.selectedJournalDate !== dateIso) return;
    els.meta.textContent = '保存失败';
    setJournalSyncState('error', '保存失败');
    alert('保存日记失败：' + e.message);
  } finally {
    state.journalSaving = false;
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
    saveJournal({mode: 'manual'});
  });
  document.querySelector('#btnJournalClear')?.addEventListener('click', () => {
    const {input} = getDrawerEls();
    if (!input) return;
    input.value = '';
    renderJournalStats('');
    markJournalDirty();
  });
  document.querySelector('#journalText')?.addEventListener('input', (e) => {
    const text = e?.target?.value || '';
    renderJournalStats(text);
    markJournalDirty();
  });
  document.querySelector('#btnTplSummary')?.addEventListener('click', () => {
    const {input} = getDrawerEls();
    if (!input) return;
    const block = '\n【今日总结】\n- \n';
    input.value = `${input.value}${block}`.trimStart();
    input.dispatchEvent(new Event('input', {bubbles: true}));
  });
  document.querySelector('#btnTplPlan')?.addEventListener('click', () => {
    const {input} = getDrawerEls();
    if (!input) return;
    const block = '\n【明日计划】\n1. \n2. \n';
    input.value = `${input.value}${block}`.trimStart();
    input.dispatchEvent(new Event('input', {bubbles: true}));
  });
  document.querySelector('#btnTplReflect')?.addEventListener('click', () => {
    const {input} = getDrawerEls();
    if (!input) return;
    const block = '\n【复盘反思】\n- 做得好的：\n- 可改进的：\n';
    input.value = `${input.value}${block}`.trimStart();
    input.dispatchEvent(new Event('input', {bubbles: true}));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeJournalDrawer();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' &&
        state.selectedJournalDate) {
      e.preventDefault();
      saveJournal({mode: 'manual'});
    }
  });

  render();
  renderTaskDetail();
}

bootstrap().catch((e) => {
  console.error(e);
  alert('日历启动失败：' + e.message);
});
