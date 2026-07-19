/**
 * IntuMedix App - Database Layer
 * SQLite-based storage using sql.js (browser-compatible SQLite)
 * Fully compatible with Anki's data model
 */

let SQL = null;
let db = null;

const DB_KEY = 'intumedix_db_v2';

// ─── SQL.js loader ───────────────────────────────────────────
async function loadSqlJs() {
  if (SQL) return SQL;
  if (typeof window.initSqlJs === 'undefined') {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './sql-wasm.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  SQL = await window.initSqlJs({ locateFile: () => './sql-wasm.wasm' });
  return SQL;
}

/** Export the SQL instance for use in apkg.js */
export function getSQLInstance() { return SQL; }

// ─── IndexedDB for media ──────────────────────────────────────
const IDB_NAME = 'intumedix_media';
const IDB_STORE = 'files';
let idb = null;

function openIDB() {
  if (idb) return Promise.resolve(idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = e => { idb = e.target.result; resolve(idb); };
    req.onerror = () => reject(req.error);
  });
}

export async function saveMedia(filename, dataBase64) {
  const db_ = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db_.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(dataBase64, filename);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMedia(filename) {
  const db_ = await openIDB();
  return new Promise((resolve) => {
    const tx = db_.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(filename);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export async function clearAllMedia() {
  const db_ = await openIDB();
  return new Promise((resolve) => {
    const tx = db_.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
    tx.oncomplete = resolve;
  });
}

// ─── DB Init ──────────────────────────────────────────────────
export async function initDB() {
  if (db) return db;
  await loadSqlJs();

  const saved = localStorage.getItem(DB_KEY);
  if (saved) {
    try {
      const arr = JSON.parse(saved);
      db = new SQL.Database(new Uint8Array(arr));
      // Run migrations
      migrateSchema();
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

function migrateSchema() {
  // Add new columns if they don't exist (migration)
  try { db.run(`ALTER TABLE decks ADD COLUMN anki_id TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE note_types ADD COLUMN css TEXT DEFAULT ''`); } catch(e) {}
  try { db.run(`ALTER TABLE note_types ADD COLUMN anki_model_id TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE notes ADD COLUMN guid TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE notes ADD COLUMN sfld TEXT DEFAULT ''`); } catch(e) {}
  try { db.run(`ALTER TABLE cards ADD COLUMN anki_ivl INTEGER DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE cards ADD COLUMN anki_factor INTEGER DEFAULT 2500`); } catch(e) {}
  try { db.run(`ALTER TABLE cards ADD COLUMN anki_type INTEGER DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE cards ADD COLUMN anki_queue INTEGER DEFAULT 0`); } catch(e) {}
  try { db.run(`ALTER TABLE cards ADD COLUMN ord INTEGER DEFAULT 0`); } catch(e) {}
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS decks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      anki_id     TEXT,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      created     INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS note_types (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      anki_model_id   TEXT,
      name            TEXT NOT NULL,
      fields          TEXT NOT NULL,
      template_front  TEXT DEFAULT '{{Front}}',
      template_back   TEXT DEFAULT '{{FrontSide}}<hr>{{Back}}',
      css             TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      anki_id     INTEGER,
      guid        TEXT,
      deck_id     INTEGER NOT NULL,
      note_type_id INTEGER,
      fields      TEXT NOT NULL,
      sfld        TEXT DEFAULT '',
      tags        TEXT DEFAULT '',
      created     INTEGER DEFAULT (strftime('%s','now')),
      modified    INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (deck_id) REFERENCES decks(id)
    );

    CREATE TABLE IF NOT EXISTS cards (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      anki_id         INTEGER,
      note_id         INTEGER NOT NULL,
      deck_id         INTEGER NOT NULL,
      ord             INTEGER DEFAULT 0,
      state           INTEGER DEFAULT 0,
      -- FSRS fields
      stability       REAL,
      difficulty      REAL,
      due_date        TEXT,
      last_review     TEXT,
      scheduled_days  INTEGER DEFAULT 0,
      reps            INTEGER DEFAULT 0,
      lapses          INTEGER DEFAULT 0,
      -- Anki compatibility fields
      anki_ivl        INTEGER DEFAULT 0,
      anki_factor     INTEGER DEFAULT 2500,
      anki_type       INTEGER DEFAULT 0,
      anki_queue      INTEGER DEFAULT 0,
      FOREIGN KEY (note_id) REFERENCES notes(id),
      FOREIGN KEY (deck_id) REFERENCES decks(id)
    );

    CREATE TABLE IF NOT EXISTS revlog (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id         INTEGER NOT NULL,
      rating          INTEGER NOT NULL,
      state_before    INTEGER,
      stability_before REAL,
      difficulty_before REAL,
      review_time     TEXT DEFAULT (datetime('now')),
      scheduled_days  INTEGER,
      elapsed_days    INTEGER
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  db.run(`INSERT OR IGNORE INTO settings VALUES ('theme', 'dark')`);
  db.run(`INSERT OR IGNORE INTO settings VALUES ('daily_limit', '100')`);
  db.run(`INSERT OR IGNORE INTO settings VALUES ('new_per_day', '20')`);
}

export function saveDB() {
  if (!db) return;
  const data = db.export();
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(Array.from(data)));
  } catch(e) {
    console.warn('localStorage full, DB not saved:', e);
  }
}

// ─── DECK OPERATIONS ──────────────────────────────────────────
export function getDecks() {
  if (!db) return [];
  const result = db.exec(`
    SELECT d.*,
      COUNT(DISTINCT c.id) as total_cards,
      COUNT(DISTINCT CASE WHEN c.anki_queue = 2 AND c.due_date <= datetime('now') THEN c.id END) as due_cards,
      COUNT(DISTINCT CASE WHEN c.anki_queue = 0 OR c.state = 0 THEN c.id END) as new_cards
    FROM decks d
    LEFT JOIN cards c ON c.deck_id = d.id
    GROUP BY d.id
    ORDER BY d.name
  `);
  return result.length > 0 ? rowsToObjects(result[0]) : [];
}

export function createDeck(name, description = '', ankiId = null) {
  // Check if deck already exists
  const existing = db.exec(`SELECT id FROM decks WHERE name = ?`, [name]);
  if (existing.length > 0 && existing[0].values.length > 0) {
    return existing[0].values[0][0];
  }
  db.run(`INSERT INTO decks (name, description, anki_id) VALUES (?, ?, ?)`,
    [name, description, ankiId ? String(ankiId) : null]);
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

// ─── NOTE TYPE OPERATIONS ─────────────────────────────────────
export function createNoteType(name, fields, templateFront, templateBack, css = '', ankiModelId = null) {
  // Check if exists
  const existing = db.exec(`SELECT id FROM note_types WHERE anki_model_id = ?`, [String(ankiModelId)]);
  if (ankiModelId && existing.length > 0 && existing[0].values.length > 0) {
    return existing[0].values[0][0];
  }
  db.run(
    `INSERT INTO note_types (name, fields, template_front, template_back, css, anki_model_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, JSON.stringify(fields), templateFront || '{{Front}}', templateBack || '{{FrontSide}}<hr>{{Back}}', css || '', ankiModelId ? String(ankiModelId) : null]
  );
  return db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
}

export function getNoteType(id) {
  const result = db.exec(`SELECT * FROM note_types WHERE id = ?`, [id]);
  if (result.length === 0) return null;
  const nt = rowsToObjects(result[0])[0];
  nt.fields = JSON.parse(nt.fields || '[]');
  return nt;
}

// ─── NOTE OPERATIONS ──────────────────────────────────────────
export function createNote(deckId, fields, tags = '', noteTypeId = null, ankiId = null, guid = null) {
  const sfld = fields[Object.keys(fields)[0]] || '';
  db.run(
    `INSERT INTO notes (deck_id, note_type_id, fields, sfld, tags, anki_id, guid) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [deckId, noteTypeId || null, JSON.stringify(fields), String(sfld).substring(0, 255), tags, ankiId || null, guid || null]
  );
  return db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
}

export function getNotes(deckId) {
  const result = db.exec(`SELECT n.*, nt.template_front, nt.template_back, nt.css FROM notes n LEFT JOIN note_types nt ON nt.id = n.note_type_id WHERE n.deck_id = ?`, [deckId]);
  if (result.length === 0) return [];
  return rowsToObjects(result[0]).map(n => ({ ...n, fields: JSON.parse(n.fields || '{}') }));
}

// ─── CARD OPERATIONS ──────────────────────────────────────────
export function createCard(noteId, deckId, opts = {}) {
  db.run(`
    INSERT INTO cards (note_id, deck_id, ord, due_date, anki_ivl, anki_factor, anki_type, anki_queue, state, reps, lapses)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    noteId, deckId,
    opts.ord || 0,
    opts.due_date || null,
    opts.anki_ivl || 0,
    opts.anki_factor || 2500,
    opts.anki_type || 0,
    opts.anki_queue || 0,
    opts.state || 0,
    opts.reps || 0,
    opts.lapses || 0,
  ]);
  return db.exec(`SELECT last_insert_rowid() as id`)[0].values[0][0];
}

export function getDueCards(deckId, limit = 200) {
  const result = db.exec(`
    SELECT c.*, n.fields, n.tags, n.note_type_id,
           nt.template_front, nt.template_back, nt.css, nt.name as note_type_name
    FROM cards c
    JOIN notes n ON n.id = c.note_id
    LEFT JOIN note_types nt ON nt.id = n.note_type_id
    WHERE c.deck_id = ?
      AND c.anki_queue >= 0
      AND (
        c.due_date IS NULL
        OR c.due_date <= datetime('now')
        OR c.anki_type = 0
        OR c.state = 0
      )
    ORDER BY c.anki_type ASC, c.due_date ASC
    LIMIT ?
  `, [deckId, limit]);

  if (result.length === 0) return [];
  return rowsToObjects(result[0]).map(c => ({
    ...c,
    fields: JSON.parse(c.fields || '{}'),
  }));
}

export function getCardById(cardId) {
  const result = db.exec(`
    SELECT c.*, n.fields, n.tags, n.note_type_id,
           nt.template_front, nt.template_back, nt.css
    FROM cards c
    JOIN notes n ON n.id = c.note_id
    LEFT JOIN note_types nt ON nt.id = n.note_type_id
    WHERE c.id = ?
  `, [cardId]);
  if (result.length === 0) return null;
  const row = rowsToObjects(result[0])[0];
  row.fields = JSON.parse(row.fields || '{}');
  return row;
}

export function updateCard(card) {
  db.run(`
    UPDATE cards SET
      state = ?, stability = ?, difficulty = ?,
      due_date = ?, last_review = ?, scheduled_days = ?,
      reps = ?, lapses = ?, anki_type = ?, anki_ivl = ?
    WHERE id = ?
  `, [
    card.state, card.stability, card.difficulty,
    card.dueDate || card.due_date,
    card.lastReview || card.last_review,
    card.scheduledDays || card.scheduled_days || 0,
    card.reps, card.lapses,
    card.state >= 2 ? 2 : 1,
    card.scheduledDays || 0,
    card.id
  ]);
  saveDB();
}

export function logReview(cardId, rating, stateBefore, stabilityBefore, difficultyBefore, scheduledDays, elapsedDays) {
  db.run(`
    INSERT INTO revlog (card_id, rating, state_before, stability_before, difficulty_before, scheduled_days, elapsed_days)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [cardId, rating, stateBefore, stabilityBefore, difficultyBefore, scheduledDays, elapsedDays]);
}

// ─── STATS ────────────────────────────────────────────────────
export function getStats() {
  if (!db) return {};
  const total = db.exec(`SELECT COUNT(*) as n FROM cards`);
  const reviewed = db.exec(`SELECT COUNT(*) as n FROM revlog WHERE DATE(review_time) = DATE('now')`);
  const learned = db.exec(`SELECT COUNT(DISTINCT card_id) as n FROM revlog`);
  const due = db.exec(`SELECT COUNT(*) as n FROM cards WHERE (due_date <= datetime('now') OR state = 0) AND anki_queue >= 0`);

  return {
    total: total[0]?.values[0][0] || 0,
    reviewed_today: reviewed[0]?.values[0][0] || 0,
    learned: learned[0]?.values[0][0] || 0,
    due: due[0]?.values[0][0] || 0,
  };
}

export function getReviewHistory(days = 14) {
  if (!db) return [];
  const result = db.exec(`
    SELECT DATE(review_time) as date, COUNT(*) as count, AVG(rating) as avg_rating
    FROM revlog
    WHERE review_time >= datetime('now', '-${days} days')
    GROUP BY DATE(review_time)
    ORDER BY date ASC
  `);
  return result.length > 0 ? rowsToObjects(result[0]) : [];
}

// ─── SETTINGS ─────────────────────────────────────────────────
export function getSetting(key) {
  if (!db) return null;
  const result = db.exec(`SELECT value FROM settings WHERE key = ?`, [key]);
  return result.length > 0 ? result[0].values[0][0] : null;
}

export function setSetting(key, value) {
  if (!db) return;
  db.run(`INSERT OR REPLACE INTO settings VALUES (?, ?)`, [key, String(value)]);
  saveDB();
}

// ─── UTILITIES ────────────────────────────────────────────────
function rowsToObjects(result) {
  const { columns, values } = result;
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}
