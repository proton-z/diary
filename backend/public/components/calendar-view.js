const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function addDaysIso(dateIso, days) {
  const d = new Date(dateIso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function taskToEvent(task) {
  const a = (task.start_date || "").trim();
  const b = (task.end_date || "").trim();
  const ddl = (task.due_date || "").trim();

  // prefer range a~b, else fallback to DDL single-day
  const start = a || ddl || "";
  let endExclusive = "";
  if (a && b) endExclusive = addDaysIso(b, 1); // inclusive b -> exclusive b+1
  else if (start) endExclusive = addDaysIso(start, 1);

  if (!start) return null;

  const tag = (task.tag || "").trim();
  const title = task.title;
  const done = !!task.completed;

  const tagKey = tag === "长期" ? "long" : tag === "短期" ? "short" : tag === "作业" ? "hw" : "other";

  return {
    id: String(task.id),
    title,
    start,
    end: endExclusive,
    allDay: true,
    classNames: [done ? "is-done" : "is-open", `tag-${tagKey}`],
    extendedProps: { task, tag }
  };
}

export function createCalendarView({ calendarEl, getFilters, fetchTasks }) {
  const cal = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    height: "auto",
    fixedWeekCount: false,
    dayMaxEventRows: 4,
    headerToolbar: {
      left: "title",
      center: "",
      right: "prev,today,next dayGridMonth,listMonth"
    },
    buttonText: { today: "今天", month: "月", list: "列表" },
    locale: "zh-cn",
    events: async (info, success, failure) => {
      try {
        const { onlyIncomplete, tag } = getFilters();
        const tasks = await fetchTasks({ onlyIncomplete, tag });
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
      const lines = [
        `任务：${task.title}`,
        task.goal ? `目标：${task.goal}` : "",
        task.tag ? `标签：${task.tag}` : "",
        task.start_date || task.end_date ? `持续：${task.start_date || "?"} ~ ${task.end_date || "?"}` : "",
        task.due_date ? `DDL：${task.due_date}` : ""
      ].filter(Boolean);
      alert(lines.join("\n"));
    },
    eventDidMount: (info) => {
      // subtle styling for completed tasks
      if (info.event.classNames.includes("is-done")) {
        info.el.style.opacity = "0.55";
        info.el.style.filter = "grayscale(0.2)";
      }
    }
  });

  cal.render();

  return {
    refetch() {
      cal.refetchEvents();
    }
  };
}

export function renderTagChips({ el, tags, selectedTag, onSelect }) {
  el.innerHTML = tags
    .map((t) => {
      const active = t === selectedTag;
      return `
        <button
          data-tag="${esc(t)}"
          class="tag ${active ? "active" : ""}"
        >
          ${esc(t)}
        </button>
      `;
    })
    .join("");

  el.querySelectorAll("button[data-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-tag") || "";
      onSelect(selectedTag === t ? "" : t);
    });
  });
}

