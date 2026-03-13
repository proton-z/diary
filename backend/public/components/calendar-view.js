const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll('\'', '&#039;');
}

function addDaysIso(dateIso, days) {
  const d = new Date(dateIso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function taskToEvent(task) {
  const a = (task.start_date || '').trim();
  const b = (task.end_date || '').trim();
  const ddl = (task.due_date || '').trim();

  // prefer range a~b, else fallback to DDL single-day
  const start = a || ddl || '';
  let endExclusive = '';
  if (a && b)
    endExclusive = addDaysIso(b, 1);  // inclusive b -> exclusive b+1
  else if (start)
    endExclusive = addDaysIso(start, 1);

  if (!start) return null;

  const primary = Array.isArray(task.tags) && task.tags.length ?
      String(task.tags[0]).trim() :
      (task.tag || '').trim();
  const title = task.title;
  const done = !!task.completed;

  const tagKey = primary === '长期' ? 'long' :
      primary === '短期'            ? 'short' :
      primary === '作业'            ? 'hw' :
                                      'other';

  return {
    id: String(task.id),
    title,
    start,
    end: endExclusive,
    allDay: true,
    classNames: [done ? 'is-done' : 'is-open', `tag-${tagKey}`],
    extendedProps: {task, tag: primary}
  };
}

function toIsoDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function createCalendarView({
  calendarEl,
  getFilters,
  fetchTasks,
  onTaskClick,
  onDateClick,
  onViewRangeChange
}) {
  let selectedEventEl = null;
  let journalDates = new Set();
  const dayCellEls = new Map();

  function updateCellDot(cellEl, dateIso) {
    if (!cellEl) return;
    const top = cellEl.querySelector('.fc-daygrid-day-top');
    if (!top) return;
    const hasJournal = journalDates.has(dateIso);
    let dot = top.querySelector('.journal-dot');
    if (hasJournal && !dot) {
      dot = document.createElement('span');
      dot.className = 'journal-dot';
      dot.setAttribute('aria-hidden', 'true');
      top.appendChild(dot);
    }
    if (!hasJournal && dot) dot.remove();
  }

  const cal = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    height: 'auto',
    fixedWeekCount: true,
    dayMaxEventRows: 4,
    headerToolbar: {
      left: 'title',
      center: '',
      right: 'prev,today,next dayGridMonth,listMonth'
    },
    buttonText: {today: '今天', month: '月', list: '列表'},
    dayCellContent: (arg) => {
      return String(arg.dayNumberText || '').replace('日', '');
    },
    dayCellDidMount: (arg) => {
      const dateIso = arg.dateStr || toIsoDate(arg.date);
      dayCellEls.set(dateIso, arg.el);
      updateCellDot(arg.el, dateIso);
      arg.el.classList.add('calendar-day-cell');
      arg.el.addEventListener('click', (evt) => {
        const target = evt.target instanceof Element ? evt.target : null;
        if (!target) return;
        if (target.closest('.fc-daygrid-event')) return;
        if (target.closest('.fc-daygrid-more-link')) return;
        if (target.closest('.fc-popover')) return;
        if (typeof onDateClick === 'function') onDateClick(dateIso);
      });
    },
    dayCellWillUnmount: (arg) => {
      const dateIso = arg.dateStr || toIsoDate(arg.date);
      dayCellEls.delete(dateIso);
    },
    locale: 'zh-cn',
    datesSet: (arg) => {
      if (typeof onViewRangeChange === 'function') {
        onViewRangeChange({
          start: toIsoDate(arg.start),
          endExclusive: toIsoDate(arg.end)
        });
      }
    },
    events: async (info, success, failure) => {
      try {
        const {onlyIncomplete, tag} = getFilters();
        const tasks = await fetchTasks({onlyIncomplete, tag});
        const events = tasks.map(taskToEvent).filter(Boolean);
        success(events);
      } catch (e) {
        console.error(e);
        failure(e);
      }
    },
    eventClick: (arg) => {
      const task = arg.event.extendedProps?.task;
      if (!task) return;
      if (selectedEventEl) selectedEventEl.classList.remove('is-selected');
      selectedEventEl = arg.el;
      selectedEventEl.classList.add('is-selected');
      if (typeof onTaskClick === 'function') onTaskClick(task);
    }
  });

  cal.render();

  return {
    refetch() {
      cal.refetchEvents();
    },
    clearSelection() {
      if (!selectedEventEl) return;
      selectedEventEl.classList.remove('is-selected');
      selectedEventEl = null;
    },
    setJournalDates(dates) {
      journalDates = new Set((dates || []).filter(Boolean));
      dayCellEls.forEach((el, dateIso) => {
        updateCellDot(el, dateIso);
      });
    }
  };
}

export function renderTagChips({el, tags, selectedTag, onSelect}) {
  el.innerHTML = tags.map((t) => {
                       const active = t === selectedTag;
                       return `
        <button
          data-tag="${esc(t)}"
          class="tag ${active ? 'active' : ''}"
        >
          ${esc(t)}
        </button>
      `;
                     })
                     .join('');

  el.querySelectorAll('button[data-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-tag') || '';
      onSelect(selectedTag === t ? '' : t);
    });
  });
}
