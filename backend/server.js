const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');

const DEFAULT_TAGS = ['长期', '短期'];

const app = express();
app.use(express.json({limit: '1mb'}));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, {recursive: true});

const dbPath = path.join(dataDir, 'tasks.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    tag TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    due_date TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
  CREATE INDEX IF NOT EXISTS idx_tasks_tag ON tasks(tag);
  CREATE TABLE IF NOT EXISTS journals (
    entry_date TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// lightweight migration for existing DBs
try {
  const cols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
  if (!cols.includes('due_date')) {
    db.exec('ALTER TABLE tasks ADD COLUMN due_date TEXT NOT NULL DEFAULT \'\'');
  }
  if (!cols.includes('start_date')) {
    db.exec(
        'ALTER TABLE tasks ADD COLUMN start_date TEXT NOT NULL DEFAULT \'\'');
  }
  if (!cols.includes('end_date')) {
    db.exec('ALTER TABLE tasks ADD COLUMN end_date TEXT NOT NULL DEFAULT \'\'');
  }
  if (!cols.includes('tags')) {
    db.exec('ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT \'[]\'');
  }
} catch {
  // ignore migration failures (table may not exist yet)
}
try {
  db.exec(
      'UPDATE tasks SET tags = json_array(tag) WHERE (tags IS NULL OR tags = \'\' OR tags = \'[]\') AND tag <> \'\'');
} catch {
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTag(tag) {
  const t = typeof tag === 'string' ? tag.trim() : '';
  return t;
}

function normalizeTags(input) {
  if (Array.isArray(input)) {
    return input.map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter((x) => x)
        .slice(0, 12);
  }
  const t = normalizeTag(input);
  return t ? [t] : [];
}

function normalizeText(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeLongText(v) {
  return typeof v === 'string' ? v : '';
}

function isDateIso(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '');
}

app.get('/api/health', (_req, res) => {
  res.json({ok: true});
});

app.get('/api/tags', (_req, res) => {
  const tagRows =
      db.prepare('SELECT DISTINCT tag FROM tasks WHERE tag <> \'\'').all();
  const rows =
      db.prepare(
            'SELECT tags FROM tasks WHERE tags IS NOT NULL AND tags <> \'\'')
          .all();
  const fromJson = rows.map((r) => {
                         try {
                           const arr = JSON.parse(r.tags || '[]');
                           return Array.isArray(arr) ? arr : [];
                         } catch {
                           return [];
                         }
                       })
                       .flat()
                       .filter((x) => typeof x === 'string' && x.trim());
  const tags = Array.from(new Set([
    ...DEFAULT_TAGS, ...tagRows.map((r) => r.tag).filter(Boolean), ...fromJson
  ]));
  tags.sort((a, b) => a.localeCompare(b, 'zh-CN', {sensitivity: 'base'}));
  res.json({tags});
});

app.get('/api/tasks', (req, res) => {
  const completedParam = req.query.completed;
  const tagParam = typeof req.query.tag === 'string' ? req.query.tag : '';

  const where = [];
  const params = {};

  if (completedParam === '0' || completedParam === '1') {
    where.push('completed = @completed');
    params.completed = Number(completedParam);
  }
  if (tagParam) {
    where.push(
        '(tag = @tag OR EXISTS (SELECT 1 FROM json_each(tasks.tags) WHERE value = @tag))');
    params.tag = tagParam;
  }

  const sql = `
    SELECT id, title, goal, tag, tags, due_date, start_date, end_date, completed, created_at, updated_at
    FROM tasks
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY completed ASC, updated_at DESC, id DESC
  `;
  const rows = db.prepare(sql).all(params);
  const tasks = rows.map((r) => {
    let tags = [];
    try {
      tags = JSON.parse(r.tags || '[]');
      if (!Array.isArray(tags)) tags = [];
    } catch {
      tags = [];
    }
    if ((!tags || !tags.length) && r.tag) tags = [r.tag];
    return {...r, tags};
  });
  res.json({tasks});
});

app.get('/api/journals/:date', (req, res) => {
  const date = typeof req.params.date === 'string' ? req.params.date.trim() : '';
  if (!isDateIso(date)) return res.status(400).json({error: 'invalid_date'});
  const row = db.prepare(
                    'SELECT entry_date, content, created_at, updated_at FROM journals WHERE entry_date = ?')
                  .get(date);
  if (!row) return res.json({entry: {entry_date: date, content: '', created_at: '', updated_at: ''}});
  res.json({entry: row});
});

app.put('/api/journals/:date', (req, res) => {
  const date = typeof req.params.date === 'string' ? req.params.date.trim() : '';
  if (!isDateIso(date)) return res.status(400).json({error: 'invalid_date'});
  const content = normalizeLongText(req.body?.content).slice(0, 20000);
  const ts = nowIso();
  db.prepare(
        `INSERT INTO journals (entry_date, content, created_at, updated_at)
         VALUES (@entry_date, @content, @ts, @ts)
         ON CONFLICT(entry_date) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`)
      .run({entry_date: date, content, ts});
  const row = db.prepare(
                    'SELECT entry_date, content, created_at, updated_at FROM journals WHERE entry_date = ?')
                  .get(date);
  res.json({entry: row});
});

app.post('/api/tasks', (req, res) => {
  const title = normalizeText(req.body?.title);
  const goal = normalizeText(req.body?.goal);
  const tagsArr = normalizeTags(req.body?.tags ?? req.body?.tag);
  const tag = tagsArr[0] || '';
  const tags = JSON.stringify(tagsArr);
  const due_date = normalizeText(req.body?.due_date);
  const start_date = normalizeText(req.body?.start_date);
  const end_date = normalizeText(req.body?.end_date);

  if (!title) return res.status(400).json({error: 'title_required'});

  const ts = nowIso();
  const info =
      db.prepare(
            'INSERT INTO tasks (title, goal, tag, tags, due_date, start_date, end_date, completed, created_at, updated_at) VALUES (@title, @goal, @tag, @tags, @due_date, @start_date, @end_date, 0, @ts, @ts)')
          .run({title, goal, tag, tags, due_date, start_date, end_date, ts});

  const task =
      db.prepare(
            'SELECT id, title, goal, tag, tags, due_date, start_date, end_date, completed, created_at, updated_at FROM tasks WHERE id = ?')
          .get(info.lastInsertRowid);
  let parsed = [];
  try {
    parsed = JSON.parse(task.tags || '[]');
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    parsed = [];
  }
  if ((!parsed || !parsed.length) && task.tag) parsed = [task.tag];
  res.status(201).json({task: {...task, tags: parsed}});
});

app.put('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({error: 'invalid_id'});

  const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({error: 'not_found'});

  const title = normalizeText(req.body?.title);
  const goal = normalizeText(req.body?.goal);
  const tagsArr = normalizeTags(req.body?.tags ?? req.body?.tag);
  const tag = tagsArr[0] || '';
  const tags = JSON.stringify(tagsArr);
  const due_date = normalizeText(req.body?.due_date);
  const start_date = normalizeText(req.body?.start_date);
  const end_date = normalizeText(req.body?.end_date);
  const completed = req.body?.completed;

  if (!title) return res.status(400).json({error: 'title_required'});

  const updates = {
    title,
    goal,
    tag,
    tags,
    due_date,
    start_date,
    end_date,
    updated_at: nowIso()
  };

  let completedClause = '';
  if (completed === 0 || completed === 1 || completed === true ||
      completed === false) {
    updates.completed = completed === true ? 1 :
        completed === false                ? 0 :
                                             completed;
    completedClause = ', completed = @completed';
  }

  db.prepare(
        `UPDATE tasks SET title = @title, goal = @goal, tag = @tag, tags = @tags, due_date = @due_date, start_date = @start_date, end_date = @end_date${
            completedClause}, updated_at = @updated_at WHERE id = @id`)
      .run({...updates, id});

  const task =
      db.prepare(
            'SELECT id, title, goal, tag, tags, due_date, start_date, end_date, completed, created_at, updated_at FROM tasks WHERE id = ?')
          .get(id);
  let parsed = [];
  try {
    parsed = JSON.parse(task.tags || '[]');
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    parsed = [];
  }
  if ((!parsed || !parsed.length) && task.tag) parsed = [task.tag];
  res.json({task: {...task, tags: parsed}});
});

app.patch('/api/tasks/:id/toggle', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({error: 'invalid_id'});

  const row = db.prepare('SELECT completed FROM tasks WHERE id = ?').get(id);
  if (!row) return res.status(404).json({error: 'not_found'});

  const next = row.completed ? 0 : 1;
  db.prepare('UPDATE tasks SET completed = ?, updated_at = ? WHERE id = ?')
      .run(next, nowIso(), id);
  const task =
      db.prepare(
            'SELECT id, title, goal, tag, tags, due_date, start_date, end_date, completed, created_at, updated_at FROM tasks WHERE id = ?')
          .get(id);
  let parsed = [];
  try {
    parsed = JSON.parse(task.tags || '[]');
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    parsed = [];
  }
  if ((!parsed || !parsed.length) && task.tag) parsed = [task.tag];
  res.json({task: {...task, tags: parsed}});
});

app.delete('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({error: 'invalid_id'});
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (!info.changes) return res.status(404).json({error: 'not_found'});
  res.status(204).end();
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const port = process.env.PORT ? Number(process.env.PORT) : 5178;
app.listen(port, () => {
  console.log(`Server running: http://localhost:${port}`);
});
