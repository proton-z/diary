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
  const btn = document.querySelector("#btnDetailToggleComplete");
  const stateEl = document.querySelector("#detailState");
  if (!box || !empty) return;
  if (!task) {
    box.classList.add("hidden");
    empty.classList.remove("hidden");
    if (btn) btn.disabled = true;
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
  if (stateEl) {
    stateEl.textContent = task.completed ? "已完成" : "进行中";
    stateEl.classList.toggle("is-done", !!task.completed);
    stateEl.classList.toggle("is-open", !task.completed);
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = task.completed ? "标记为未完成" : "完成任务";
    btn.classList.toggle("btn-primary", !task.completed);
    btn.classList.toggle("btn-secondary", !!task.completed);
  }
}

async function toggleSelectedTask() {
  const task = state.selectedTask;
  const btn = document.querySelector("#btnDetailToggleComplete");
  if (!task || !btn) return;
  btn.disabled = true;
  try {
    const data = await api(`/api/tasks/${task.id}/toggle`, { method: "PATCH" });
    const nextTask = data?.task || null;
    const hiddenByFilter = state.onlyIncomplete && !!nextTask?.completed;
    state.selectedTask = hiddenByFilter ? null : nextTask;
    renderTaskDetail();
    state.calendar?.clearSelection();
    state.calendar?.refetch();
  } catch (e) {
    alert("更新任务状态失败：" + e.message);
    btn.disabled = false;
  }
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
  document.querySelector("#btnDetailToggleComplete").addEventListener("click", () => {
    toggleSelectedTask();
  });

  render();
  renderTaskDetail();
}

bootstrap().catch((e) => {
  console.error(e);
  alert("日历启动失败：" + e.message);
});
