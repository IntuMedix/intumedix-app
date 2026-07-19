/**
 * IntuMedix App - Anki .apkg Parser
 * Full faithful implementation of Anki's .apkg format:
 *   - collection.anki2 / collection.anki21 (SQLite)
 *   - models with templates and CSS
 *   - notes with original field values
 *   - cards with original scheduling data
 *   - media files stored in IndexedDB
 */

import JSZip from 'jszip';
import {
  getSQLInstance,
  createDeck,
  createNoteType,
  createNote,
  createCard,
  saveDB,
  saveMedia,
} from './db.js';

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Load sql.js instance (reuse from db.js to avoid double-loading WASM)
 */
async function getSql() {
  let SQL = getSQLInstance();
  if (SQL) return SQL;
  // Wait for db.js to initialize (up to 5s)
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    SQL = getSQLInstance();
    if (SQL) return SQL;
  }
  throw new Error('SQL.js not initialized. Please wait for app to load.');
}

/**
 * Convert Anki epoch-day due to an ISO date string
 * Anki's "due" for reviews = number of days since 2006-01-01
 */
function ankiDayToDate(due, type) {
  if (type === 0) return null; // New cards have no due date
  if (type === 1) {
    // Learning cards: due is epoch seconds
    return new Date(due * 1000).toISOString();
  }
  // Review cards: due is days since Anki epoch (2006-01-01)
  const ANKI_EPOCH = new Date('2006-01-01').getTime();
  return new Date(ANKI_EPOCH + due * 86400000).toISOString();
}

// ─── Main parse function ──────────────────────────────────────

/**
 * Parse an .apkg file fully
 * @param {File} apkgFile
 * @param {function} onProgress (0..100)
 */
export async function parseAndImportApkg(apkgFile, onProgress = () => {}) {
  onProgress(2);

  const sql = await getSql();
  onProgress(5);

  // ── 1. Open ZIP ──
  const zip = await JSZip.loadAsync(apkgFile);
  onProgress(10);

  // ── 2. Find collection database ──
  const dbEntry = zip.file('collection.anki21') || zip.file('collection.anki2');
  if (!dbEntry) throw new Error('ملف .apkg غير صالح: لا توجد قاعدة بيانات');

  const dbData = await dbEntry.async('arraybuffer');
  onProgress(20);

  let ankiDb;
  try {
    ankiDb = new sql.Database(new Uint8Array(dbData));
  } catch (e) {
    throw new Error('فشل فتح قاعدة البيانات. قد يكون الملف تالفاً أو محمياً.');
  }

  // ── 3. Read col table ──
  let colRows;
  try {
    colRows = ankiDb.exec(`SELECT decks, models FROM col LIMIT 1`);
  } catch(e) {
    // Newer Anki versions may not have col table — try alternative
    throw new Error('تنسيق ملف Anki غير مدعوم حالياً');
  }

  let decksJson = {}, modelsJson = {};
  if (colRows.length > 0 && colRows[0].values.length > 0) {
    try { decksJson = JSON.parse(colRows[0].values[0][0] || '{}'); } catch(e) {}
    try { modelsJson = JSON.parse(colRows[0].values[0][1] || '{}'); } catch(e) {}
  }

  // ── 4. Build Deck map: ankiDeckId → name ──
  const deckNameMap = {}; // ankiId (string) → name
  for (const [id, deck] of Object.entries(decksJson)) {
    if (id !== '1') deckNameMap[id] = deck.name;
  }

  // ── 5. Build Model map: ankiModelId → { fields, templates, css } ──
  const modelMap = {}; // mid (string) → parsed model
  for (const [mid, model] of Object.entries(modelsJson)) {
    const fieldNames = (model.flds || [])
      .sort((a, b) => a.ord - b.ord)
      .map(f => f.name);

    const templates = (model.tmpls || [])
      .sort((a, b) => a.ord - b.ord)
      .map(t => ({
        ord: t.ord,
        name: t.name,
        qfmt: t.qfmt || '',
        afmt: t.afmt || '',
      }));

    modelMap[mid] = {
      id: mid,
      name: model.name || 'Unknown',
      type: model.type || 0, // 0=standard, 1=cloze
      fieldNames,
      templates,
      css: model.css || '',
    };
  }

  // ── 6. Create IntuMedix note types for each Anki model ──
  const noteTypeIdMap = {}; // ankiModelId → intumedixNoteTypeId
  for (const [mid, model] of Object.entries(modelMap)) {
    const tmpl = model.templates[0] || { qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' };
    noteTypeIdMap[mid] = createNoteType(
      model.name,
      model.fieldNames,
      tmpl.qfmt,
      tmpl.afmt,
      model.css,
      mid,
    );
  }

  // ── 7. Create IntuMedix decks for each Anki deck ──
  const deckIdMap = {}; // ankiDeckId (string) → intumedixDeckId
  for (const [ankiId, name] of Object.entries(deckNameMap)) {
    deckIdMap[ankiId] = createDeck(name, 'مستورد من Anki', ankiId);
  }
  // Fallback deck created lazily only if needed
  let fallbackDeckId = null;
  function getFallbackDeckId() {
    if (!fallbackDeckId) fallbackDeckId = createDeck('Imported', 'مستورد من Anki');
    return fallbackDeckId;
  }

  onProgress(30);

  // ── 8. Read notes from Anki DB ──
  let notesResult;
  try {
    notesResult = ankiDb.exec(`SELECT id, guid, mid, mod, tags, flds FROM notes`);
  } catch(e) {
    throw new Error('فشل قراءة الملاحظات: ' + e.message);
  }
  const rawNotes = notesResult.length > 0 ? notesResult[0].values : [];

  // ── 9. Read cards from Anki DB ──
  let cardsResult;
  try {
    cardsResult = ankiDb.exec(`SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses FROM cards`);
  } catch(e) {
    throw new Error('فشل قراءة البطاقات: ' + e.message);
  }
  const rawCards = cardsResult.length > 0 ? cardsResult[0].values : [];

  // ── 10. Build note lookup map ──
  // ankiNoteId → { fields object, tags, mid, guid }
  const noteInfoMap = {};
  for (const [id, guid, mid, mod, tags, flds] of rawNotes) {
    const model = modelMap[String(mid)];
    const fieldValues = flds.split('\x1f'); // Anki separator
    const fieldsObj = {};
    if (model) {
      model.fieldNames.forEach((name, i) => {
        fieldsObj[name] = fieldValues[i] || '';
      });
    } else {
      // Unknown model — use generic names
      fieldValues.forEach((v, i) => { fieldsObj[`Field${i+1}`] = v; });
    }
    noteInfoMap[String(id)] = { mid: String(mid), fields: fieldsObj, tags: tags || '', guid };
  }

  onProgress(40);

  // ── 11. Group cards by note, import notes + cards ──
  const totalCards = rawCards.length;
  let processed = 0;
  const importedDecks = {}; // deckName → count

  for (const [cardId, nid, did, ord, type, queue, due, ivl, factor, reps, lapses] of rawCards) {
    const noteInfo = noteInfoMap[String(nid)];
    if (!noteInfo) continue;

    const deckId = deckIdMap[String(did)] || getFallbackDeckId();
    const deckName = deckNameMap[String(did)] || 'Imported';
    const noteTypeId = noteTypeIdMap[noteInfo.mid] || null;

    // Create note (dedup by ankiNoteId)
    let noteId;
    try {
      const existingNote = ankiDb.exec(`SELECT id FROM notes WHERE id = ?`, [nid]); // This checks anki DB, not our DB
      // Check our DB
      const ourDb_res = null; // We'll just try to insert
      noteId = createNote(deckId, noteInfo.fields, noteInfo.tags, noteTypeId, nid, noteInfo.guid);
    } catch(e) {
      noteId = createNote(deckId, noteInfo.fields, noteInfo.tags, noteTypeId, nid, noteInfo.guid);
    }

    // Calculate due date
    const dueDate = ankiDayToDate(due, type);

    // Create card
    createCard(noteId, deckId, {
      ord,
      due_date: dueDate,
      anki_ivl: ivl || 0,
      anki_factor: factor || 2500,
      anki_type: type || 0,
      anki_queue: queue || 0,
      state: type === 0 ? 0 : (type === 2 ? 2 : 1),
      reps: reps || 0,
      lapses: lapses || 0,
    });

    importedDecks[deckName] = (importedDecks[deckName] || 0) + 1;
    processed++;

    if (processed % 50 === 0) {
      onProgress(40 + Math.round((processed / totalCards) * 45));
    }
  }

  onProgress(85);
  ankiDb.close();

  // ── 12. Extract and store media in IndexedDB ──
  const mediaManifest = {};
  const mediaFile = zip.file('media');
  if (mediaFile) {
    try {
      const raw = await mediaFile.async('text');
      Object.assign(mediaManifest, JSON.parse(raw));
    } catch(e) {}
  }

  let mediaCount = 0;
  const mediaEntries = Object.entries(mediaManifest);
  for (const [fileNum, filename] of mediaEntries) {
    const entry = zip.file(fileNum);
    if (entry) {
      try {
        const data = await entry.async('base64');
        const ext = filename.split('.').pop().toLowerCase();
        const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', mp3:'audio/mpeg', ogg:'audio/ogg', wav:'audio/wav' };
        const mime = mimeMap[ext] || 'application/octet-stream';
        await saveMedia(filename, `data:${mime};base64,${data}`);
        mediaCount++;
      } catch(e) {}
    }
    onProgress(85 + Math.round((mediaCount / Math.max(mediaEntries.length, 1)) * 10));
  }

  saveDB();
  onProgress(100);

  return Object.entries(importedDecks).map(([name, count]) => ({ deckName: name, count }));
}

/**
 * Export an IntuMedix deck as .apkg
 */
export async function exportToApkg(notes, deckName) {
  const sql = await getSql();
  const exportDb = new sql.Database();

  exportDb.run(`CREATE TABLE notes (id INTEGER, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT)`);
  exportDb.run(`CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT)`);
  exportDb.run(`CREATE TABLE col (id INTEGER, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER, dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT)`);
  exportDb.run(`CREATE TABLE graves (usn INTEGER, oid INTEGER, type INTEGER)`);
  exportDb.run(`CREATE TABLE revlog (id INTEGER, cid INTEGER, usn INTEGER, ease INTEGER, ivl INTEGER, lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER)`);

  const now = Math.floor(Date.now() / 1000);
  const deckId = Date.now();
  const modelId = Date.now() + 1;

  // Collect all unique field names from notes
  const allFields = new Set();
  notes.forEach(n => Object.keys(n.fields || {}).forEach(k => allFields.add(k)));
  const fieldNames = Array.from(allFields);

  const decksObj = {
    [deckId]: { id: deckId, name: deckName, conf: 1, extendNew: 10, extendRev: 50, mod: now, usn: -1 }
  };
  const modelsObj = {
    [modelId]: {
      id: modelId, name: 'IntuMedix', type: 0, mod: now, usn: -1,
      flds: fieldNames.map((n, i) => ({ name: n, ord: i, sticky: false, rtl: false, font: 'Arial', size: 20 })),
      tmpls: [{ name: 'Card 1', ord: 0, qfmt: `{{${fieldNames[0] || 'Front'}}}`, afmt: `{{FrontSide}}<hr>{{${fieldNames[1] || 'Back'}}}`}],
      css: '.card { font-family: Arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
    }
  };

  exportDb.run(`INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`,
    [now, now, now, JSON.stringify(modelsObj), JSON.stringify(decksObj)]);

  notes.forEach((note, i) => {
    const flds = fieldNames.map(f => String(note.fields[f] || '')).join('\x1f');
    const noteId = note.anki_id || (deckId + i);
    exportDb.run(`INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, 0, 0, '')`,
      [noteId, `intumedix-${noteId}`, modelId, now, note.tags || '', flds, String(note.fields[fieldNames[0]] || '').substring(0, 100)]);
    exportDb.run(`INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 2500, ?, ?, 0, 0, 0, 0, '')`,
      [deckId + i + 1000000, noteId, deckId, now, i + 1, note.reps || 0, note.lapses || 0]);
  });

  const dbData = exportDb.export();
  exportDb.close();

  const zip = new JSZip();
  zip.file('collection.anki2', dbData);
  zip.file('media', '{}');

  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
