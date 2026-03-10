import { createCalendarView, renderTagChips } from "/components/calendar-view.js";

const state = {
  tags: [],
  selectedTag: "",
  onlyIncomplete: true,
  calendar: null,
  selectedTask: null
};

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "request_failed");
  return data;
}

async function fetchTags() {
  const data = await api("/api/tags");
  state.tags = data.tags || [];
}

async function fetchTasks({ onlyIncomplete, tag }) {
  const qs = new URLSearchParams();
  if (onlyIncomplete) qs.set("completed", "0");
  if (tag) qs.set("tag", tag);
  const data = await api(`/api/tasks?${qs.toString()}`);
  return data.tasks || [];
}

function getFilters() {
  return { onlyIncomplete: state.onlyIncomplete, tag: state.selectedTag };
}

function formatDateLabel(v) {
  const s = (v || "").trim();
  if (!s) return "—";
  return s;
}

function renderTaskDetail() {
  const task = state.selectedTask;
  const box = document.querySelector("#taskDetail");
  const empty = document.querySelector("#taskDetailEmpty");
  if (!box || !empty) return;
  if (!task) {
    box.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  box.classList.remove("hidden");

  const tags = Array.isArray(task.tags) ? task.tags : (task.tag ? [task.tag] : []);
  document.querySelector("#detailTitle").textContent = task.title || "未命名任务";
  document.querySelector("#detailGoal").textContent = task.goal || "未填写";
  document.querySelector("#detailTags").textContent = tags.length ? tags.join(" · ") : "无";
  document.querySelector("#detailDue").textContent = formatDateLabel(task.due_date);
  document.querySelector("#detailRange").textContent =
    task.start_date || task.end_date
      ? `${formatDateLabel(task.start_date)} ~ ${formatDateLabel(task.end_date)}`
      : "未设置";
  document.querySelector("#detailState").textContent = task.completed ? "已完成" : "进行中";
}

function render() {
  renderTagChips({
    el: document.querySelector("#tagList"),
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

  const calendarEl = document.querySelector("#calendar");
  state.calendar = createCalendarView({
    calendarEl,
    getFilters,
    fetchTasks,
    onTaskClick: (task) => {
      state.selectedTask = task || null;
      renderTaskDetail();
    }
  });

  document.querySelector("#chkOnlyIncomplete").addEventListener("change", (e) => {
    state.onlyIncomplete = e.target.checked;
    state.calendar?.refetch();
  });

  document.querySelector("#btnReset").addEventListener("click", () => {
    state.selectedTag = "";
    state.onlyIncomplete = true;
    state.selectedTask = null;
    document.querySelector("#chkOnlyIncomplete").checked = true;
    state.calendar?.clearSelection();
    render();
    state.calendar?.refetch();
    renderTaskDetail();
  });

  render();
  renderTaskDetail();
}

bootstrap().catch((e) => {
  console.error(e);
  alert("日历启动失败：" + e.message);
});
