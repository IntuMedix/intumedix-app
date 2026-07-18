/**
 * IntuMedix App - Database Layer
 * SQLite-based storage using sql.js (browser-compatible SQLite)
 */

let SQL = null;
let db = null;

const DB_KEY = 'intumedix_db';

async function loadSqlJs() {
  if (SQL) return SQL;
  // Load sql.js via script tag if not loaded yet
  if (typeof window.initSqlJs === 'undefined') {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/sql-wasm.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  SQL = await window.initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  return SQL;
}

export async function initDB() {
  if (db) return db;

  await loadSqlJs();

  // Load existing DB from localStorage, or create new
  const saved = localStorage.getItem(DB_KEY);
  if (saved) {
    try {
      const arr = JSON.parse(saved);
      db = new SQL.Database(new Uint8Array(arr));
    } catch (e) {
      db = new SQL.Database();
      createSchema();
      saveDB();
    }
  } else {
    db = new SQL.Database();
    createSchema();
    saveDB();
  }

  return db;
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created INTEGER DEFAULT (strftime('%s','now')),
      modified INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS note_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      fields TEXT NOT NULL,
      template_front TEXT,
      template_back TEXT
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL,
      note_type_id INTEGER,
      fields TEXT NOT NULL,
      tags TEXT DEFAULT '',
      created INTEGER DEFAULT (strftime('%s','now')),
      modified INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (deck_id) REFERENCES decks(id)
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      state INTEGER DEFAULT 0,
      stability REAL,
      difficulty REAL,
      due_date TEXT,
      last_review TEXT,
      scheduled_days INTEGER DEFAULT 0,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      FOREIGN KEY (note_id) REFERENCES notes(id),
      FOREIGN KEY (deck_id) REFERENCES decks(id)
    );

    CREATE TABLE IF NOT EXISTS revlog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      state_before INTEGER,
      stability_before REAL,
      difficulty_before REAL,
      review_time TEXT DEFAULT (datetime('now')),
      scheduled_days INTEGER,
      elapsed_days INTEGER
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      data BLOB
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Insert default settings
  db.run(`INSERT OR IGNORE INTO settings VALUES ('theme', 'dark')`);
  db.run(`INSERT OR IGNORE INTO settings VALUES ('daily_limit', '100')`);
  db.run(`INSERT OR IGNORE INTO settings VALUES ('new_per_day', '20')`);
}

export function saveDB() {
  if (!db) return;
  const data = db.export();
  localStorage.setItem(DB_KEY, JSON.stringify(Array.from(data)));
}

// ─── DECK OPERATIONS ─────────────────────────────────────────
export function getDecks() {
  if (!db) return [];
  const result = db.exec(`
    SELECT d.*, 
      COUNT(DISTINCT c.id) as total_cards,
      COUNT(DISTINCT CASE WHEN c.due_date <= datetime('now') AND c.state != 0 THEN c.id END) as due_cards,
      COUNT(DISTINCT CASE WHEN c.state = 0 THEN c.id END) as new_cards
    FROM decks d
    LEFT JOIN cards c ON c.deck_id = d.id
    GROUP BY d.id
    ORDER BY d.name
  `);
  return result.length > 0 ? rowsToObjects(result[0]) : [];
}

export function createDeck(name, description = '') {
  db.run(`INSERT INTO decks (name, description) VALUES (?, ?)`, [name, description]);
  saveDB();
  return db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
}

export function getDeck(id) {
  const result = db.exec(`SELECT * FROM decks WHERE id = ?`, [id]);
  return result.length > 0 ? rowsToObjects(result[0])[0] : null;
}

export function deleteDeck(id) {
  db.run(`DELETE FROM revlog WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)`, [id]);
  db.run(`DELETE FROM cards WHERE deck_id = ?`, [id]);
  db.run(`DELETE FROM notes WHERE deck_id = ?`, [id]);
  db.run(`DELETE FROM decks WHERE id = ?`, [id]);
  saveDB();
}

// ─── NOTE OPERATIONS ─────────────────────────────────────────
export function createNote(deckId, fields, tags = '') {
  db.run(`INSERT INTO notes (deck_id, fields, tags) VALUES (?, ?, ?)`,
    [deckId, JSON.stringify(fields), tags]);
  const noteId = db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
  
  // Create associated card
  db.run(`INSERT INTO cards (note_id, deck_id, due_date) VALUES (?, ?, datetime('now'))`,
    [noteId, deckId]);
  
  saveDB();
  return noteId;
}

export function getNotes(deckId) {
  const result = db.exec(`SELECT * FROM notes WHERE deck_id = ?`, [deckId]);
  if (result.length === 0) return [];
  return rowsToObjects(result[0]).map(n => ({
    ...n, fields: JSON.parse(n.fields)
  }));
}

export function updateNoteField(noteId, fields) {
  db.run(`UPDATE notes SET fields = ?, modified = strftime('%s','now') WHERE id = ?`,
    [JSON.stringify(fields), noteId]);
  saveDB();
}

// ─── CARD OPERATIONS ─────────────────────────────────────────
export function getDueCards(deckId, limit = 100) {
  const result = db.exec(`
    SELECT c.*, n.fields, n.tags
    FROM cards c
    JOIN notes n ON n.id = c.note_id
    WHERE c.deck_id = ?
      AND (c.due_date IS NULL OR c.due_date <= datetime('now'))
    ORDER BY c.state ASC, c.due_date ASC
    LIMIT ?
  `, [deckId, limit]);
  
  if (result.length === 0) return [];
  return rowsToObjects(result[0]).map(c => ({
    ...c,
    fields: JSON.parse(c.fields)
  }));
}

export function updateCard(card) {
  db.run(`
    UPDATE cards SET
      state = ?, stability = ?, difficulty = ?,
      due_date = ?, last_review = ?, scheduled_days = ?,
      reps = ?, lapses = ?
    WHERE id = ?
  `, [
    card.state, card.stability, card.difficulty,
    card.dueDate, card.lastReview, card.scheduledDays,
    card.reps, card.lapses, card.id
  ]);
  saveDB();
}

export function logReview(cardId, rating, stateBefore, stabilityBefore, difficultyBefore, scheduledDays, elapsedDays) {
  db.run(`
    INSERT INTO revlog (card_id, rating, state_before, stability_before, difficulty_before, scheduled_days, elapsed_days)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [cardId, rating, stateBefore, stabilityBefore, difficultyBefore, scheduledDays, elapsedDays]);
}

export function getCardById(cardId) {
  const result = db.exec(`SELECT c.*, n.fields, n.tags FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.id = ?`, [cardId]);
  if (result.length === 0) return null;
  const row = rowsToObjects(result[0])[0];
  return { ...row, fields: JSON.parse(row.fields) };
}

// ─── STATS ─────────────────────────────────────────
export function getStats(deckId = null) {
  const deckFilter = deckId ? `AND c.deck_id = ${deckId}` : '';
  
  const today = db.exec(`
    SELECT 
      COUNT(*) as reviewed,
      SUM(CASE WHEN r.rating >= 3 THEN 1 ELSE 0 END) as correct,
      AVG(CASE WHEN r.rating >= 3 THEN 100 ELSE 0 END) as retention
    FROM revlog r
    JOIN cards c ON c.id = r.card_id
    WHERE DATE(r.review_time) = DATE('now')
    ${deckFilter}
  `);

  const totals = db.exec(`
    SELECT 
      COUNT(DISTINCT CASE WHEN c.state = 0 THEN c.id END) as new_cards,
      COUNT(DISTINCT CASE WHEN c.state = 2 OR c.state = 3 THEN c.id END) as review_cards,
      COUNT(DISTINCT c.id) as total_cards
    FROM cards c
    WHERE 1=1 ${deckFilter.replace('AND c.', 'AND c.')}
  `);

  const streakResult = db.exec(`
    SELECT COUNT(DISTINCT DATE(review_time)) as streak
    FROM revlog r
    JOIN cards c ON c.id = r.card_id
    WHERE r.review_time >= DATE('now', '-30 days')
    ${deckFilter}
  `);

  return {
    today: today.length > 0 ? rowsToObjects(today[0])[0] : { reviewed: 0, correct: 0, retention: 0 },
    totals: totals.length > 0 ? rowsToObjects(totals[0])[0] : { new_cards: 0, review_cards: 0, total_cards: 0 },
    streak: streakResult.length > 0 ? streakResult[0].values[0][0] : 0,
  };
}

export function getReviewHistory(days = 30) {
  const result = db.exec(`
    SELECT DATE(review_time) as date, COUNT(*) as count,
      AVG(CASE WHEN rating >= 3 THEN 100 ELSE 0 END) as retention
    FROM revlog
    WHERE review_time >= DATE('now', '-${days} days')
    GROUP BY DATE(review_time)
    ORDER BY date ASC
  `);
  return result.length > 0 ? rowsToObjects(result[0]) : [];
}

// ─── SETTINGS ─────────────────────────────────────────
export function getSetting(key, defaultVal = null) {
  const result = db.exec(`SELECT value FROM settings WHERE key = ?`, [key]);
  return result.length > 0 ? result[0].values[0][0] : defaultVal;
}

export function setSetting(key, value) {
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, String(value)]);
  saveDB();
}

// ─── HELPERS ─────────────────────────────────────────
function rowsToObjects(result) {
  return result.values.map(row =>
    result.columns.reduce((obj, col, i) => {
      obj[col] = row[i];
      return obj;
    }, {})
  );
}

export { rowsToObjects };
