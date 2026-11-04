import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Ensure persistent data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'homie.db');
const db = new Database(dbPath);

// Enable WAL mode for concurrent performance & durability
db.pragma('journal_mode = WAL');

// Initialize SQLite Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS roommates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL,
    color TEXT NOT NULL,
    upi TEXT
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    payer_id TEXT NOT NULL,
    split_mode TEXT NOT NULL,
    r1_share REAL NOT NULL,
    r2_share REAL NOT NULL,
    date TEXT NOT NULL,
    settled INTEGER DEFAULT 0,
    settlement_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    date TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calendar_presence (
    date_str TEXT NOT NULL,
    roommate_id TEXT NOT NULL,
    status TEXT NOT NULL,
    work_mode TEXT,
    PRIMARY KEY (date_str, roommate_id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    val TEXT
  );
`);

function seedDatabaseIfEmpty() {
  const roomCount = db.prepare('SELECT count(*) as count FROM roommates').get().count;
  if (roomCount === 0) {
    const insertRoom = db.prepare('INSERT INTO roommates (id, name, avatar, color, upi) VALUES (?, ?, ?, ?, ?)');
    insertRoom.run('r1', 'Rohan', '☕', '#E07A5F', 'rohan@okhdfcbank');
    insertRoom.run('r2', 'Kabir', '🪴', '#81B29A', 'kabir@icici');

    db.prepare('INSERT OR REPLACE INTO app_settings (key, val) VALUES (?, ?)').run('active_user_id', 'r1');

    // Initial calendar presence
    const insertCal = db.prepare('INSERT OR REPLACE INTO calendar_presence (date_str, roommate_id, status, work_mode) VALUES (?, ?, ?, ?)');
    const todayStr = formatD(today);
    insertCal.run(todayStr, 'r1', 'bangalore', 'wfh');
    insertCal.run(todayStr, 'r2', 'bangalore', 'wfo');
  }
}

seedDatabaseIfEmpty();

// Helper to assemble full state
function getFullState() {
  const rooms = db.prepare('SELECT * FROM roommates').all();
  const roommatesObj = {};
  rooms.forEach(r => {
    roommatesObj[r.id] = r;
  });

  const activeUserRow = db.prepare('SELECT val FROM app_settings WHERE key = ?').get('active_user_id');
  const activeUserId = activeUserRow ? activeUserRow.val : 'r1';

  const expensesRows = db.prepare('SELECT * FROM expenses ORDER BY created_at DESC').all();
  const expenses = expensesRows.map(e => ({
    id: e.id,
    title: e.title,
    amount: e.amount,
    category: e.category,
    payerId: e.payer_id,
    splitMode: e.split_mode,
    shares: { r1: e.r1_share, r2: e.r2_share },
    date: e.date,
    settled: Boolean(e.settled),
    settlementId: e.settlement_id,
    createdAt: e.created_at
  }));

  const settlements = db.prepare('SELECT * FROM settlements ORDER BY created_at DESC').all().map(s => ({
    id: s.id,
    fromId: s.from_id,
    toId: s.to_id,
    amount: s.amount,
    note: s.note,
    date: s.date,
    createdAt: s.created_at
  }));

  const calRows = db.prepare('SELECT * FROM calendar_presence').all();
  const calendar = {};
  calRows.forEach(c => {
    if (!calendar[c.date_str]) calendar[c.date_str] = {};
    calendar[c.date_str][c.roommate_id] = {
      status: c.status,
      workMode: c.work_mode
    };
  });

  return {
    roommates: roommatesObj,
    activeUserId,
    expenses,
    settlements,
    calendar
  };
}

// REST API Endpoints
app.get('/api/state', (req, res) => {
  try {
    const state = getFullState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/active-user', (req, res) => {
  const { id } = req.body;
  db.prepare('INSERT OR REPLACE INTO app_settings (key, val) VALUES (?, ?)').run('active_user_id', id);
  res.json({ success: true, activeUserId: id });
});

app.post('/api/expenses', (req, res) => {
  try {
    const { title, amount, category, payerId, splitMode, shares, date } = req.body;
    const id = 'exp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const createdAt = Date.now();

    db.prepare(`
      INSERT INTO expenses (id, title, amount, category, payer_id, split_mode, r1_share, r2_share, date, settled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      title,
      Number(amount),
      category,
      payerId,
      splitMode,
      shares?.r1 ?? (amount / 2),
      shares?.r2 ?? (amount / 2),
      date || new Date().toISOString().split('T')[0],
      createdAt
    );

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settle', (req, res) => {
  try {
    const { fromId, toId, amount, note } = req.body;
    const id = 'set_' + Date.now();
    const createdAt = Date.now();
    const date = new Date().toISOString().split('T')[0];

    const insert = db.transaction(() => {
      db.prepare(`
        INSERT INTO settlements (id, from_id, to_id, amount, note, date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, fromId, toId, amount, note || 'Settled balance', date, createdAt);

      db.prepare('UPDATE expenses SET settled = 1, settlement_id = ? WHERE settled = 0').run(id);
    });

    insert();
    res.json({ success: true, settlementId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/day', (req, res) => {
  try {
    const { dateStr, roommateId, status, workMode } = req.body;
    
    // Check existing
    const existing = db.prepare('SELECT * FROM calendar_presence WHERE date_str = ? AND roommate_id = ?').get(dateStr, roommateId);
    const finalStatus = status !== undefined ? status : (existing ? existing.status : 'bangalore');
    const finalWorkMode = workMode !== undefined ? workMode : (existing ? existing.work_mode : null);

    db.prepare(`
      INSERT OR REPLACE INTO calendar_presence (date_str, roommate_id, status, work_mode)
      VALUES (?, ?, ?, ?)
    `).run(dateStr, roommateId, finalStatus, finalStatus === 'home' ? null : finalWorkMode);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/range', (req, res) => {
  try {
    const { startDateStr, endDateStr, roommateId, status } = req.body;
    let cur = new Date(startDateStr);
    const end = new Date(endDateStr);

    const updateMany = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO calendar_presence (date_str, roommate_id, status, work_mode)
        VALUES (?, ?, ?, NULL)
      `);
      while (cur <= end) {
        const ds = cur.toISOString().split('T')[0];
        stmt.run(ds, roommateId, status);
        cur.setDate(cur.getDate() + 1);
      }
    });

    updateMany();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roommates/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, avatar, upi } = req.body;
    db.prepare(`
      UPDATE roommates SET name = coalesce(?, name), avatar = coalesce(?, avatar), upi = coalesce(?, upi)
      WHERE id = ?
    `).run(name, avatar, upi, id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', (req, res) => {
  try {
    db.exec(`
      DELETE FROM expenses;
      DELETE FROM settlements;
      DELETE FROM calendar_presence;
      DELETE FROM roommates;
    `);
    seedDatabaseIfEmpty();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend build if dist folder exists
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Homie SQLite Backend running at http://localhost:${PORT}`);
  console.log(`Database stored at: ${dbPath}`);
});
