import { createCalendarView, renderTagChips } from "/components/calendar-view.js";

const state = {
  tags: [],
  selectedTag: "",
  onlyIncomplete: true,
  calendar: null
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
    fetchTasks
  });

  document.querySelector("#chkOnlyIncomplete").addEventListener("change", (e) => {
    state.onlyIncomplete = e.target.checked;
    state.calendar?.refetch();
  });

  document.querySelector("#btnReset").addEventListener("click", () => {
    state.selectedTag = "";
    state.onlyIncomplete = true;
    document.querySelector("#chkOnlyIncomplete").checked = true;
    render();
    state.calendar?.refetch();
  });

  render();
}

bootstrap().catch((e) => {
  console.error(e);
  alert("日历启动失败：" + e.message);
});

