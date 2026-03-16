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
  journalSaving: false,
  journalUploading: false,
  journalEditorMode: 'edit'
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
    templateReflect: document.querySelector('#btnTplReflect'),
    insertImage: document.querySelector('#btnJournalInsertImage'),
    imageFile: document.querySelector('#journalImageFile'),
    imagePreviewList: document.querySelector('#journalImagePreviewList'),
    markdownPreview: document.querySelector('#journalMarkdownPreview'),
    modeEdit: document.querySelector('#btnJournalModeEdit'),
    modePreview: document.querySelector('#btnJournalModePreview')
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

function escapeHtml(v) {
  return String(v || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
}

function normalizeUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith('/uploads/journals/')) return v;
  return '';
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (_m, alt, rawUrl) => {
        const url = normalizeUrl(rawUrl);
        if (!url) return escapeHtml(_m);
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
      });
  html = html.replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_m, label, rawUrl) => {
        const url = normalizeUrl(rawUrl);
        if (!url) return escapeHtml(_m);
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
      });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

function renderMarkdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  if (!lines.some((line) => line.trim())) {
    return '<p class="journal-markdown-placeholder">预览模式：支持标题、列表、引用、代码、链接和图片。</p>';
  }
  const chunks = [];
  let inCode = false;
  let codeLines = [];
  let listType = '';
  let blockquoteOpen = false;

  const closeList = () => {
    if (listType) {
      chunks.push(`</${listType}>`);
      listType = '';
    }
  };
  const closeBlockquote = () => {
    if (blockquoteOpen) {
      chunks.push('</blockquote>');
      blockquoteOpen = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      closeList();
      closeBlockquote();
      if (!inCode) {
        inCode = true;
        codeLines = [];
      } else {
        chunks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      closeBlockquote();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      closeBlockquote();
      const level = heading[1].length;
      chunks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      if (!blockquoteOpen) {
        chunks.push('<blockquote>');
        blockquoteOpen = true;
      }
      chunks.push(`<p>${renderInlineMarkdown(quote[1])}</p>`);
      continue;
    } else {
      closeBlockquote();
    }

    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') {
        closeList();
        listType = 'ol';
        chunks.push('<ol>');
      }
      chunks.push(`<li>${renderInlineMarkdown(ol[1])}</li>`);
      continue;
    }

    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') {
        closeList();
        listType = 'ul';
        chunks.push('<ul>');
      }
      chunks.push(`<li>${renderInlineMarkdown(ul[1])}</li>`);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList();
      closeBlockquote();
      chunks.push('<hr />');
      continue;
    }

    closeList();
    chunks.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  closeBlockquote();
  if (inCode) {
    chunks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  return chunks.join('');
}

function renderJournalMarkdownPreview(content) {
  const {markdownPreview} = getDrawerEls();
  if (!markdownPreview) return;
  markdownPreview.innerHTML = renderMarkdownToHtml(content);
}

function setJournalEditorMode(mode) {
  const nextMode = mode === 'preview' ? 'preview' : 'edit';
  state.journalEditorMode = nextMode;
  const {input, markdownPreview, imagePreviewList, modeEdit, modePreview} =
      getDrawerEls();
  if (input) input.classList.toggle('hidden', nextMode !== 'edit');
  if (markdownPreview) markdownPreview.classList.toggle('hidden', nextMode !== 'preview');
  if (imagePreviewList) imagePreviewList.classList.toggle('hidden', nextMode !== 'edit');
  if (modeEdit) modeEdit.classList.toggle('is-active', nextMode === 'edit');
  if (modePreview) modePreview.classList.toggle('is-active', nextMode === 'preview');
  if (nextMode === 'preview') renderJournalMarkdownPreview(input?.value || '');
}

function extractImageUrls(text) {
  const raw = String(text || '');
  const list = [];
  const md = /!\[[^\]]*\]\((https?:\/\/[^\s)]+|\/uploads\/journals\/[^\s)]+)\)/g;
  for (const m of raw.matchAll(md)) {
    if (m[1]) list.push(m[1]);
  }
  const plain = /(https?:\/\/\S+\.(?:png|jpg|jpeg|webp|gif)|\/uploads\/journals\/\S+\.(?:png|jpg|jpeg|webp|gif))/gi;
  for (const m of raw.matchAll(plain)) {
    if (m[1]) list.push(m[1]);
  }
  return Array.from(new Set(list)).slice(0, 18);
}

function renderJournalImagePreview(content) {
  const {imagePreviewList} = getDrawerEls();
  if (!imagePreviewList) return;
  const urls = extractImageUrls(content);
  imagePreviewList.innerHTML = '';
  if (!urls.length) return;
  const frag = document.createDocumentFragment();
  for (const url of urls) {
    const item = document.createElement('div');
    item.className = 'journal-image-item';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = url;
    img.alt = '日记图片';
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '打开原图';
    item.appendChild(img);
    item.appendChild(link);
    frag.appendChild(item);
  }
  imagePreviewList.appendChild(frag);
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

function insertTextAtCursor(inputEl, text) {
  if (!inputEl) return;
  const start = Number.isFinite(inputEl.selectionStart) ? inputEl.selectionStart : inputEl.value.length;
  const end = Number.isFinite(inputEl.selectionEnd) ? inputEl.selectionEnd : inputEl.value.length;
  const before = inputEl.value.slice(0, start);
  const after = inputEl.value.slice(end);
  inputEl.value = `${before}${text}${after}`;
  const nextPos = start + text.length;
  inputEl.selectionStart = nextPos;
  inputEl.selectionEnd = nextPos;
}

async function uploadJournalImage(file) {
  const allow = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  if (!allow.has(file.type || '')) throw new Error('仅支持 png/jpg/webp/gif');
  if (file.size > 4 * 1024 * 1024) throw new Error('图片超过 4MB');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
  const data =
      await api('/api/journal-images', {method: 'POST', body: JSON.stringify({dataUrl})});
  if (!data?.image?.url) throw new Error('图片上传失败');
  return data.image.url;
}

async function handleInsertImage() {
  const els = getDrawerEls();
  if (!els.input || !els.imageFile || state.journalUploading) return;
  const file = els.imageFile.files?.[0];
  if (!file) return;
  state.journalUploading = true;
  if (els.insertImage) {
    els.insertImage.disabled = true;
    els.insertImage.textContent = '上传中...';
  }
  setJournalSyncState('saving', '图片上传中');
  try {
    const url = await uploadJournalImage(file);
    const snippet = `\n![图片](${url})\n`;
    insertTextAtCursor(els.input, snippet);
    els.input.dispatchEvent(new Event('input', {bubbles: true}));
    setJournalSyncState('editing', '图片已插入');
  } catch (e) {
    setJournalSyncState('error', '上传失败');
    alert(`插入图片失败：${e.message}`);
  } finally {
    state.journalUploading = false;
    if (els.insertImage) {
      els.insertImage.disabled = false;
      els.insertImage.textContent = '+ 插入图片';
    }
    els.imageFile.value = '';
  }
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
  renderJournalImagePreview('');
  renderJournalMarkdownPreview('');
  setJournalEditorMode('edit');
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
    renderJournalImagePreview(content);
    renderJournalMarkdownPreview(content);
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
    renderJournalImagePreview('');
    renderJournalMarkdownPreview('');
    markJournalDirty();
  });
  document.querySelector('#journalText')?.addEventListener('input', (e) => {
    const text = e?.target?.value || '';
    renderJournalStats(text);
    renderJournalImagePreview(text);
    renderJournalMarkdownPreview(text);
    markJournalDirty();
  });
  document.querySelector('#btnJournalModeEdit')?.addEventListener('click', () => {
    setJournalEditorMode('edit');
  });
  document.querySelector('#btnJournalModePreview')
      ?.addEventListener('click', () => {
        setJournalEditorMode('preview');
      });
  document.querySelector('#btnJournalInsertImage')?.addEventListener('click', () => {
    const {imageFile} = getDrawerEls();
    imageFile?.click();
  });
  document.querySelector('#journalImageFile')?.addEventListener('change', () => {
    handleInsertImage();
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
