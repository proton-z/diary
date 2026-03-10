const path = require("path");
const fs = require("fs");
const express = require("express");
const Database = require("better-sqlite3");

const DEFAULT_TAGS = ["长期", "短期"];

const app = express();
app.use(express.json({ limit: "1mb" }));

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "tasks.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    tag TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
  CREATE INDEX IF NOT EXISTS idx_tasks_tag ON tasks(tag);
`);

// lightweight migration for existing DBs
try {
  const cols = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
  if (!cols.includes("due_date")) {
    db.exec("ALTER TABLE tasks ADD COLUMN due_date TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes("start_date")) {
    db.exec("ALTER TABLE tasks ADD COLUMN start_date TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes("end_date")) {
    db.exec("ALTER TABLE tasks ADD COLUMN end_date TEXT NOT NULL DEFAULT ''");
  }
} catch {
  // ignore migration failures (table may not exist yet)
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTag(tag) {
  const t = typeof tag === "string" ? tag.trim() : "";
  return t;
}

function normalizeText(v) {
  return typeof v === "string" ? v.trim() : "";
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/tags", (_req, res) => {
  const rows = db.prepare("SELECT DISTINCT tag FROM tasks WHERE tag <> '' ORDER BY tag COLLATE NOCASE").all();
  const tags = Array.from(new Set([...DEFAULT_TAGS, ...rows.map((r) => r.tag).filter(Boolean)]));
  res.json({ tags });
});

app.get("/api/tasks", (req, res) => {
  const completedParam = req.query.completed;
  const tagParam = typeof req.query.tag === "string" ? req.query.tag : "";

  const where = [];
  const params = {};

  if (completedParam === "0" || completedParam === "1") {
    where.push("completed = @completed");
    params.completed = Number(completedParam);
  }
  if (tagParam) {
    where.push("tag = @tag");
    params.tag = tagParam;
  }

  const sql = `
    SELECT id, title, goal, tag, due_date, start_date, end_date, completed, created_at, updated_at
    FROM tasks
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY completed ASC, updated_at DESC, id DESC
  `;
  const tasks = db.prepare(sql).all(params);
  res.json({ tasks });
});

app.post("/api/tasks", (req, res) => {
  const title = normalizeText(req.body?.title);
  const goal = normalizeText(req.body?.goal);
  const tag = normalizeTag(req.body?.tag);
  const due_date = normalizeText(req.body?.due_date);
  const start_date = normalizeText(req.body?.start_date);
  const end_date = normalizeText(req.body?.end_date);

  if (!title) return res.status(400).json({ error: "title_required" });

  const ts = nowIso();
  const info = db
    .prepare(
      "INSERT INTO tasks (title, goal, tag, due_date, start_date, end_date, completed, created_at, updated_at) VALUES (@title, @goal, @tag, @due_date, @start_date, @end_date, 0, @ts, @ts)"
    )
    .run({ title, goal, tag, due_date, start_date, end_date, ts });

  const task = db
    .prepare("SELECT id, title, goal, tag, due_date, start_date, end_date, completed, created_at, updated_at FROM tasks WHERE id = ?")
    .get(info.lastInsertRowid);
  res.status(201).json({ task });
});

app.put("/api/tasks/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  const existing = db.prepare("SELECT id FROM tasks WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "not_found" });

  const title = normalizeText(req.body?.title);
  const goal = normalizeText(req.body?.goal);
  const tag = normalizeTag(req.body?.tag);
  const due_date = normalizeText(req.body?.due_date);
  const start_date = normalizeText(req.body?.start_date);
  const end_date = normalizeText(req.body?.end_date);
  const completed = req.body?.completed;

  if (!title) return res.status(400).json({ error: "title_required" });

  const updates = {
    title,
    goal,
    tag,
    due_date,
    start_date,
    end_date,
    updated_at: nowIso()
  };

  let completedClause = "";
  if (completed === 0 || completed === 1 || completed === true || completed === false) {
    updates.completed = completed === true ? 1 : completed === false ? 0 : completed;
    completedClause = ", completed = @completed";
  }

  db.prepare(
    `UPDATE tasks SET title = @title, goal = @goal, tag = @tag, due_date = @due_date, start_date = @start_date, end_date = @end_date${completedClause}, updated_at = @updated_at WHERE id = @id`
  ).run({ ...updates, id });

  const task = db
    .prepare("SELECT id, title, goal, tag, due_date, start_date, end_date, completed, created_at, updated_at FROM tasks WHERE id = ?")
    .get(id);
  res.json({ task });
});

app.patch("/api/tasks/:id/toggle", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  const row = db.prepare("SELECT completed FROM tasks WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "not_found" });

  const next = row.completed ? 0 : 1;
  db.prepare("UPDATE tasks SET completed = ?, updated_at = ? WHERE id = ?").run(next, nowIso(), id);
  const task = db
    .prepare("SELECT id, title, goal, tag, due_date, start_date, end_date, completed, created_at, updated_at FROM tasks WHERE id = ?")
    .get(id);
  res.json({ task });
});

app.delete("/api/tasks/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  const info = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  if (!info.changes) return res.status(404).json({ error: "not_found" });
  res.status(204).end();
});

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const port = process.env.PORT ? Number(process.env.PORT) : 5178;
app.listen(port, () => {
  console.log(`Server running: http://localhost:${port}`);
});

