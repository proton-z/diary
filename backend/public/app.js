const $ = (sel) => document.querySelector(sel);

const state = {
  tags: [],
  selectedTag: "",
  onlyIncomplete: true,
  tasks: [],
  editingTask: null,
  editorOpen: false,
  edSelectedTag: ""
};

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

async function loadTags() {
  const data = await api("/api/tags");
  state.tags = data.tags || [];
  renderTags();
  renderEdTagChips();
}

function renderTags() {
  const el = $("#tagList");
  const tags = state.tags;
  el.innerHTML = tags
    .map((t) => {
      const active = t === state.selectedTag;
      return `
        <button
          data-tag="${esc(t)}"
          class="chip ${active ? "active" : ""}"
        >
          ${esc(t)}
        </button>
      `;
    })
    .join("");

  el.querySelectorAll("button[data-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-tag") || "";
      state.selectedTag = state.selectedTag === t ? "" : t;
      renderTags();
      refresh();
    });
  });
}

function ensureTagInList(tag) {
  const t = (tag || "").trim();
  if (!t) return;
  if (!state.tags.includes(t)) state.tags = [t, ...state.tags];
}

function setEdSelectedTag(tag) {
  state.edSelectedTag = (tag || "").trim();
  renderEdTagChips();
}

function renderEdTagChips() {
  const el = $("#edTagChips");
  if (!el) return;
  const tags = state.tags;
  el.innerHTML = tags
    .map((t) => {
      const active = t === state.edSelectedTag;
      return `
        <button
          type="button"
          data-ed-tag="${esc(t)}"
          class="chip ${active ? "active" : ""}"
          title="选择标签"
        >
          ${esc(t)}
        </button>
      `;
    })
    .join("");

  el.querySelectorAll("button[data-ed-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-ed-tag") || "";
      setEdSelectedTag(state.edSelectedTag === t ? "" : t);
    });
  });
}

function viewTitle() {
  const base = state.onlyIncomplete ? "未完成任务" : "全部任务";
  const tag = state.selectedTag ? ` · 标签：${state.selectedTag}` : "";
  $("#viewTitle").textContent = base + tag;
}

async function loadTasks() {
  const qs = new URLSearchParams();
  if (state.onlyIncomplete) qs.set("completed", "0");
  if (state.selectedTag) qs.set("tag", state.selectedTag);
  const data = await api(`/api/tasks?${qs.toString()}`);
  state.tasks = data.tasks || [];
  renderTasks();
}

function tagPill(tag) {
  if (!tag) return "";
  return `<span class="pill">${esc(tag)}</span>`;
}

function dueMeta(due_date, completed) {
  const d = (due_date || "").trim();
  if (!d) return "";
  if (completed) return `<span class="text-xs text-slate-500">DDL：${esc(d)}</span>`;

  const due = new Date(d + "T23:59:59");
  const now = new Date();
  const diffDays = Math.ceil((due - now) / (24 * 3600 * 1000));

  if (Number.isNaN(diffDays)) return `<span class="text-xs text-slate-500">DDL：${esc(d)}</span>`;
  if (diffDays < 0) return `<span class="text-xs font-medium text-rose-200">逾期：${esc(d)}</span>`;
  if (diffDays <= 2) return `<span class="text-xs font-medium text-amber-200">临期（${diffDays} 天）：${esc(d)}</span>`;
  return `<span class="text-xs text-slate-400">DDL：${esc(d)}（${diffDays} 天）</span>`;
}

function rangeMeta(start_date, end_date) {
  const a = (start_date || "").trim();
  const b = (end_date || "").trim();
  if (!a && !b) return "";
  if (a && b) return `<span class="text-xs text-slate-400">持续：${esc(a)} ~ ${esc(b)}</span>`;
  if (a) return `<span class="text-xs text-slate-400">开始：${esc(a)}</span>`;
  return `<span class="text-xs text-slate-400">结束：${esc(b)}</span>`;
}

function renderTasks() {
  viewTitle();
  $("#viewMeta").textContent = state.tasks.length ? `共 ${state.tasks.length} 条` : "";
  const list = $("#taskList");
  const empty = $("#emptyState");

  if (!state.tasks.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML = state.tasks
    .map((t) => {
      const done = !!t.completed;
      return `
        <div class="group flex items-start gap-3 px-4 py-4 hover:bg-black/5">
          <button
            class="${
              done ? "bg-emerald-500/20 border-emerald-500/30" : "bg-white border-black/10 hover:bg-black/5"
            } mt-0.5 h-5 w-5 rounded-md border"
            data-action="toggle"
            data-id="${t.id}"
            title="切换完成"
          ></button>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <div class="${done ? "line-through text-slate-500" : ""} text-sm font-medium">
                ${esc(t.title)}
              </div>
              ${tagPill(t.tag)}
            </div>
            ${
              t.goal
                ? `<div class="mt-1 text-xs leading-5 text-slate-700"><span class="text-slate-500">目标：</span>${esc(t.goal)}</div>`
                : ""
            }
            <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>更新：${esc(new Date(t.updated_at).toLocaleString())}</span>
              ${dueMeta(t.due_date, done)}
              ${rangeMeta(t.start_date, t.end_date)}
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100">
            <button
              class="btn btn-secondary"
              style="height:28px;font-size:12px"
              data-action="edit"
              data-id="${t.id}"
            >
              编辑
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll("button[data-action]").forEach((btn) => {
    const action = btn.getAttribute("data-action");
    const id = Number(btn.getAttribute("data-id"));
    btn.addEventListener("click", async () => {
      const task = state.tasks.find((x) => x.id === id);
      if (!task) return;
      if (action === "toggle") {
        await api(`/api/tasks/${id}/toggle`, { method: "PATCH" });
        await refresh();
      } else if (action === "edit") {
        openEditor(task);
      }
    });
  });
}

function showEditor(open) {
  state.editorOpen = !!open;
  const panel = $("#editorPanel");
  if (!panel) return;
  if (state.editorOpen) panel.classList.remove("hidden");
  else panel.classList.add("hidden");
}

function resetEditorForNew() {
  state.editingTask = null;
  $("#editorTitle").textContent = "新建任务";
  $("#edTitle").value = "";
  $("#edGoal").value = "";
  $("#edDue").value = "";
  $("#edStart").value = "";
  $("#edEnd").value = "";
  $("#edNewTag").value = "";
  setEdSelectedTag("");
  $("#btnEdDelete").classList.add("hidden");
}

function openEditor(task) {
  state.editingTask = task || null;

  $("#editorTitle").textContent = task ? "编辑任务" : "新建任务";
  $("#edTitle").value = task?.title || "";
  $("#edGoal").value = task?.goal || "";
  $("#edDue").value = (task?.due_date || "").trim();
  $("#edStart").value = (task?.start_date || "").trim();
  $("#edEnd").value = (task?.end_date || "").trim();
  $("#edNewTag").value = "";
  ensureTagInList(task?.tag || "");
  state.edSelectedTag = (task?.tag || "").trim();
  renderEdTagChips();

  const btnDelete = $("#btnEdDelete");
  if (task) btnDelete.classList.remove("hidden");
  else btnDelete.classList.add("hidden");

  showEditor(true);
  setTimeout(() => $("#edTitle").focus(), 0);
}

async function saveEditor() {
  const title = $("#edTitle").value.trim();
  const goal = $("#edGoal").value.trim();
  const due_date = $("#edDue").value.trim();
  const start_date = $("#edStart").value.trim();
  const end_date = $("#edEnd").value.trim();
  const pendingNewTag = $("#edNewTag").value.trim();
  if (pendingNewTag) {
    ensureTagInList(pendingNewTag);
    state.edSelectedTag = pendingNewTag;
    $("#edNewTag").value = "";
  }
  const tag = (state.edSelectedTag || "").trim();

  if (!title) {
    $("#edTitle").focus();
    return;
  }
  if (start_date && end_date && start_date > end_date) {
    alert("持续时间不合法：开始日期不能晚于结束日期。");
    $("#edStart").focus();
    return;
  }

  if (state.editingTask) {
    await api(`/api/tasks/${state.editingTask.id}`, {
      method: "PUT",
      body: JSON.stringify({ title, goal, tag, due_date, start_date, end_date, completed: state.editingTask.completed })
    });
  } else {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title, goal, tag, due_date, start_date, end_date })
    });
  }

  await loadTags();
  await refresh();
  resetEditorForNew();
}

async function deleteEditor() {
  if (!state.editingTask) return;
  const ok = confirm("确定删除这个任务吗？");
  if (!ok) return;
  await api(`/api/tasks/${state.editingTask.id}`, { method: "DELETE" });
  await loadTags();
  await refresh();
  resetEditorForNew();
}

async function refresh() {
  await loadTasks();
}

function wire() {
  $("#btnAdd").addEventListener("click", () => {
    showEditor(true);
    resetEditorForNew();
    setTimeout(() => $("#edTitle").focus(), 0);
  });
  $("#btnEditorClose")?.addEventListener("click", () => showEditor(false));
  $("#btnEdNew")?.addEventListener("click", () => {
    showEditor(true);
    resetEditorForNew();
    setTimeout(() => $("#edTitle").focus(), 0);
  });
  $("#btnEdSave")?.addEventListener("click", async () => {
    await saveEditor();
  });
  $("#btnEdDelete")?.addEventListener("click", async () => {
    await deleteEditor();
  });
  $("#btnRefresh").addEventListener("click", async () => {
    await refresh();
  });
  $("#btnResetTag").addEventListener("click", async () => {
    state.selectedTag = "";
    renderTags();
    await refresh();
  });

  $("#chkOnlyIncomplete").addEventListener("change", async (e) => {
    state.onlyIncomplete = e.target.checked;
    await refresh();
  });

  $("#btnEdAddTag")?.addEventListener("click", () => {
    const v = $("#edNewTag").value.trim();
    if (!v) {
      $("#edNewTag").focus();
      return;
    }
    ensureTagInList(v);
    $("#edNewTag").value = "";
    setEdSelectedTag(v);
  });
  $("#edNewTag")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("#btnEdAddTag")?.click();
    }
  });
  $("#btnEdClearTag")?.addEventListener("click", () => setEdSelectedTag(""));

  // Ctrl/⌘+Enter to save while editing
  document.addEventListener("keydown", async (e) => {
    if (!state.editorOpen) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      await saveEditor();
    }
  });
}

async function bootstrap() {
  wire();
  await loadTags();
  await refresh();
  // default: keep panel closed until user acts
  showEditor(false);
}

bootstrap().catch((e) => {
  console.error(e);
  alert("启动失败：" + e.message);
});

