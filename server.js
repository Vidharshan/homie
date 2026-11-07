import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize LibSQL Client (Turso Cloud or Local SQLite fallback)
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();

let db;
if (tursoUrl) {
  console.log('Connecting to Turso Cloud Database:', tursoUrl);
  db = createClient({
    url: tursoUrl,
    authToken: tursoToken || undefined,
  });
} else {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const localDbPath = path.join(dataDir, 'homie.db').replace(/\\/g, '/');
  console.log('Connecting to Local SQLite Database:', localDbPath);
  db = createClient({
    url: 'file:' + localDbPath,
  });
}

// Database schema initialization
async function initDb() {
  await db.executeMultiple(`
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

  // Seed default roommates if empty (Clean slate: zero expenses)
  const roomRes = await db.execute('SELECT count(*) as count FROM roommates');
  const count = roomRes.rows[0]?.count ?? 0;
  if (Number(count) === 0) {
    await db.batch([
      {
        sql: 'INSERT INTO roommates (id, name, avatar, color, upi) VALUES (?, ?, ?, ?, ?)',
        args: ['r1', 'Rohan', '☕', '#E07A5F', 'rohan@okhdfcbank']
      },
      {
        sql: 'INSERT INTO roommates (id, name, avatar, color, upi) VALUES (?, ?, ?, ?, ?)',
        args: ['r2', 'Kabir', '🪴', '#81B29A', 'kabir@icici']
      },
      {
        sql: 'INSERT OR REPLACE INTO app_settings (key, val) VALUES (?, ?)',
        args: ['active_user_id', 'r1']
      }
    ]);
  }
}

initDb().catch(err => console.error('Database initialization error:', err));

// Assemble full reactive state
async function getFullState() {
  const roomsRes = await db.execute('SELECT * FROM roommates');
  const roommatesObj = {};
  roomsRes.rows.forEach(r => {
    roommatesObj[r.id] = r;
  });

  const activeRes = await db.execute({
    sql: 'SELECT val FROM app_settings WHERE key = ?',
    args: ['active_user_id']
  });
  const activeUserId = activeRes.rows[0]?.val || 'r1';

  const expensesRes = await db.execute('SELECT * FROM expenses ORDER BY date DESC, created_at DESC');
  const expenses = expensesRes.rows.map(e => ({
    id: e.id,
    title: e.title,
    amount: Number(e.amount),
    category: e.category,
    payerId: e.payer_id,
    splitMode: e.split_mode,
    shares: { r1: Number(e.r1_share), r2: Number(e.r2_share) },
    date: e.date,
    settled: Boolean(e.settled),
    settlementId: e.settlement_id,
    createdAt: Number(e.created_at)
  }));

  const settlementsRes = await db.execute('SELECT * FROM settlements ORDER BY created_at DESC');
  const settlements = settlementsRes.rows.map(s => ({
    id: s.id,
    fromId: s.from_id,
    toId: s.to_id,
    amount: Number(s.amount),
    note: s.note,
    date: s.date,
    createdAt: Number(s.created_at)
  }));

  const calRes = await db.execute('SELECT * FROM calendar_presence');
  const calendar = {};
  calRes.rows.forEach(c => {
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

// REST Endpoints
app.get('/api/state', async (req, res) => {
  try {
    const state = await getFullState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/active-user', async (req, res) => {
  try {
    const { id } = req.body;
    await db.execute({
      sql: 'INSERT OR REPLACE INTO app_settings (key, val) VALUES (?, ?)',
      args: ['active_user_id', id]
    });
    res.json({ success: true, activeUserId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const { title, amount, category, payerId, splitMode, shares, date } = req.body;
    const id = 'exp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const createdAt = Date.now();

    await db.execute({
      sql: `INSERT INTO expenses (id, title, amount, category, payer_id, split_mode, r1_share, r2_share, date, settled, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      args: [
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
      ]
    });

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    await db.execute({
      sql: 'DELETE FROM expenses WHERE id = ?',
      args: [req.params.id]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settle', async (req, res) => {
  try {
    const { fromId, toId, amount, note } = req.body;
    const id = 'set_' + Date.now();
    const createdAt = Date.now();
    const date = new Date().toISOString().split('T')[0];

    await db.batch([
      {
        sql: `INSERT INTO settlements (id, from_id, to_id, amount, note, date, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, fromId, toId, Number(amount), note || 'Settled balance', date, createdAt]
      },
      {
        sql: 'UPDATE expenses SET settled = 1, settlement_id = ? WHERE settled = 0',
        args: [id]
      }
    ]);

    res.json({ success: true, settlementId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/day', async (req, res) => {
  try {
    const { dateStr, roommateId, status, workMode } = req.body;
    const existingRes = await db.execute({
      sql: 'SELECT * FROM calendar_presence WHERE date_str = ? AND roommate_id = ?',
      args: [dateStr, roommateId]
    });
    const existing = existingRes.rows[0];
    const finalStatus = status !== undefined ? status : (existing ? existing.status : 'bangalore');
    const finalWorkMode = workMode !== undefined ? workMode : (existing ? existing.work_mode : null);

    await db.execute({
      sql: `INSERT OR REPLACE INTO calendar_presence (date_str, roommate_id, status, work_mode)
             VALUES (?, ?, ?, ?)`,
      args: [dateStr, roommateId, finalStatus, finalStatus === 'home' ? null : finalWorkMode]
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar/range', async (req, res) => {
  try {
    const { startDateStr, endDateStr, roommateId, status } = req.body;
    let cur = new Date(startDateStr);
    const end = new Date(endDateStr);
    const statements = [];

    while (cur <= end) {
      const ds = cur.toISOString().split('T')[0];
      statements.push({
        sql: 'INSERT OR REPLACE INTO calendar_presence (date_str, roommate_id, status, work_mode) VALUES (?, ?, ?, NULL)',
        args: [ds, roommateId, status]
      });
      cur.setDate(cur.getDate() + 1);
    }

    if (statements.length > 0) {
      await db.batch(statements);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roommates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, avatar, upi } = req.body;
    await db.execute({
      sql: `UPDATE roommates SET name = coalesce(?, name), avatar = coalesce(?, avatar), upi = coalesce(?, upi)
             WHERE id = ?`,
      args: [name || null, avatar || null, upi || null, id]
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', async (req, res) => {
  try {
    await db.executeMultiple(`
      DELETE FROM expenses;
      DELETE FROM settlements;
      DELETE FROM calendar_presence;
      DELETE FROM roommates;
    `);
    await initDb();
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

// Export app for Vercel Serverless Function
export default app;

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Homie Server running at http://localhost:${PORT}`);
  });
}
