/**
 * IntuMedix App - .apkg File Parser
 * Reads Anki .apkg files (ZIP containing SQLite) and imports them
 */

import JSZip from 'jszip';
import { createDeck, createNote, saveDB } from './db.js';

let SQL = null;
async function getSql() {
  if (SQL) return SQL;
  if (typeof window.initSqlJs !== 'undefined') {
    SQL = await window.initSqlJs({ locateFile: () => './sql-wasm.wasm' });
  } else {
    await new Promise((resolve) => setTimeout(resolve, 500));
    SQL = await window.initSqlJs({ locateFile: () => './sql-wasm.wasm' });
  }
  return SQL;
}

/**
 * Parse an .apkg file and return deck/note data
 * @param {File|ArrayBuffer} apkgFile
 * @returns {Object} { deckName, notes, media }
 */
export async function parseApkg(apkgFile) {
  const sql = await getSql();
  
  // Read the zip
  const zip = await JSZip.loadAsync(apkgFile);
  
  // Find the collection database (could be collection.anki2 or collection.anki21)
  const dbFile = zip.file('collection.anki21') || zip.file('collection.anki2');
  if (!dbFile) throw new Error('Invalid .apkg file: no collection database found');
  
  const dbData = await dbFile.async('arraybuffer');
  const ankiDb = new sql.Database(new Uint8Array(dbData));
  
  // Read media manifest
  const mediaMap = {};
  const mediaFile = zip.file('media');
  if (mediaFile) {
    const mediaJson = await mediaFile.async('text');
    try {
      Object.assign(mediaMap, JSON.parse(mediaJson));
    } catch (e) {}
  }

  // ── Read collection info ──
  const colResult = ankiDb.exec(`SELECT decks, models, flds FROM col LIMIT 1`);
  let decksJson = {}, modelsJson = {};
  if (colResult.length > 0) {
    const row = colResult[0].values[0];
    decksJson = JSON.parse(row[0] || '{}');
    modelsJson = JSON.parse(row[1] || '{}');
  }
  
  // ── Build deck map ──
  const deckMap = {};
  for (const [id, deck] of Object.entries(decksJson)) {
    if (id !== '1') { // Skip the default deck placeholder
      deckMap[id] = deck.name;
    }
  }

  // ── Read notes ──
  const notesResult = ankiDb.exec(`SELECT id, mid, flds, tags FROM notes`);
  const rawNotes = notesResult.length > 0 ? notesResult[0].values : [];

  // ── Read cards to get deck assignment ──
  const cardsResult = ankiDb.exec(`SELECT nid, did FROM cards`);
  const cardDeckMap = {};
  if (cardsResult.length > 0) {
    for (const [nid, did] of cardsResult[0].values) {
      cardDeckMap[nid] = String(did);
    }
  }

  // ── Parse model field names ──
  const modelFields = {};
  for (const [mid, model] of Object.entries(modelsJson)) {
    modelFields[mid] = (model.flds || []).map(f => f.name);
  }

  // ── Assemble notes with field names ──
  const notesByDeck = {};
  for (const [nid, mid, flds, tags] of rawNotes) {
    const deckId = cardDeckMap[nid];
    const deckName = deckMap[deckId] || 'Imported';
    const fields = flds.split('\x1f'); // Anki field separator
    const fieldNames = modelFields[String(mid)] || fields.map((_, i) => `Field${i + 1}`);
    
    const fieldsObj = {};
    fieldNames.forEach((name, i) => {
      fieldsObj[name] = fields[i] || '';
    });

    if (!notesByDeck[deckName]) notesByDeck[deckName] = [];
    notesByDeck[deckName].push({ id: nid, fields: fieldsObj, tags: tags || '' });
  }

  // ── Extract media files ──
  const mediaFiles = [];
  for (const [fileNum, filename] of Object.entries(mediaMap)) {
    const mediaZipEntry = zip.file(fileNum);
    if (mediaZipEntry) {
      const data = await mediaZipEntry.async('base64');
      mediaFiles.push({ filename, data: `data:application/octet-stream;base64,${data}` });
    }
  }

  ankiDb.close();
  
  return { notesByDeck, mediaFiles, deckCount: Object.keys(notesByDeck).length };
}

/**
 * Import parsed .apkg data into IntuMedix database
 * @param {Object} parsedData - Result from parseApkg()
 * @param {Function} onProgress - Progress callback (0-100)
 */
export async function importApkg(parsedData, onProgress = () => {}) {
  const { notesByDeck, mediaFiles } = parsedData;
  const importedDecks = [];
  
  let totalNotes = Object.values(notesByDeck).reduce((sum, n) => sum + n.length, 0);
  let processed = 0;
  
  for (const [deckName, notes] of Object.entries(notesByDeck)) {
    // Create or get deck
    const deckId = createDeck(deckName, `Imported from Anki`);
    importedDecks.push({ deckId, deckName, count: notes.length });
    
    // Map Anki field names to IntuMedix field names
    for (const note of notes) {
      const mappedFields = mapAnkiFieldsToIntuMedix(note.fields);
      createNote(deckId, mappedFields, note.tags);
      
      processed++;
      if (processed % 10 === 0) {
        onProgress(Math.round((processed / totalNotes) * 90));
      }
    }
  }
  
  // Store media in localStorage (for small files)
  for (const media of mediaFiles.slice(0, 50)) { // limit to 50 for memory
    localStorage.setItem(`media_${media.filename}`, media.data);
  }

  saveDB();
  onProgress(100);
  
  return importedDecks;
}

/**
 * Map Anki field names to IntuMedix field names
 * Handles various common Anki deck naming conventions
 */
function mapAnkiFieldsToIntuMedix(fields) {
  const normalized = {};
  
  for (const [key, value] of Object.entries(fields)) {
    const lk = key.toLowerCase().trim();
    
    // Map common field names to IntuMedix schema
    if (lk === 'question' || lk === 'question_stem' || lk === 'front' || lk === 'stem') {
      normalized.Question_Stem = value;
    } else if (lk === 'answer' || lk === 'answer_a' || lk === 'a' || lk === 'choice a') {
      normalized.answer_A = value;
    } else if (lk === 'answer_b' || lk === 'b' || lk === 'choice b') {
      normalized.answer_B = value;
    } else if (lk === 'answer_c' || lk === 'c' || lk === 'choice c') {
      normalized.answer_C = value;
    } else if (lk === 'answer_d' || lk === 'd' || lk === 'choice d') {
      normalized.answer_D = value;
    } else if (lk === 'answer_e' || lk === 'e') {
      normalized.answer_E = value;
    } else if (lk === 'correct' || lk === 'correct_answer' || lk === 'answer key') {
      normalized.correct_answer = value;
    } else if (lk === 'explanation' || lk === 'explanation_text' || lk === 'back' || lk === 'extra') {
      normalized.Explanation_Text = value;
    } else if (lk === 'tag' || lk === 'tags' || lk === 'topic') {
      normalized.Tag = value;
    } else if (lk === 'my notes' || lk === 'personal notes' || lk === 'notes') {
      normalized['My Notes'] = value;
    } else if (lk === 'images' || lk === 'image') {
      normalized.Images = value;
    } else if (lk === 'key words' || lk === 'keywords') {
      normalized['Key Words'] = value;
    } else {
      // Keep original field name
      normalized[key] = value;
    }
  }
  
  // If no Question_Stem found, use first field
  if (!normalized.Question_Stem) {
    const firstKey = Object.keys(fields)[0];
    if (firstKey) normalized.Question_Stem = fields[firstKey];
  }
  
  return normalized;
}

/**
 * Export IntuMedix deck to .apkg format
 * @param {Array} notes - notes from the deck
 * @param {string} deckName - deck name
 */
export async function exportToApkg(notes, deckName) {
  const sql = await getSql();
  const exportDb = new sql.Database();
  
  // Create Anki-compatible schema
  exportDb.run(`CREATE TABLE notes (id INTEGER, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT)`);
  exportDb.run(`CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT)`);
  exportDb.run(`CREATE TABLE col (id INTEGER, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER, dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT)`);
  
  const now = Math.floor(Date.now() / 1000);
  const deckId = Date.now();
  const modelId = Date.now() + 1;
  
  const fieldNames = ['Question_Stem', 'answer_A', 'answer_B', 'answer_C', 'answer_D', 'answer_E', 'correct_answer', 'Explanation_Text', 'Tag', 'Key Words', 'Images', 'My Notes'];
  
  const decks = { [deckId]: { id: deckId, name: deckName, conf: 1, extendNew: 10, extendRev: 50 } };
  const models = { [modelId]: { id: modelId, name: 'IntuMedix', flds: fieldNames.map((n, i) => ({ name: n, ord: i })), tmpls: [{ name: 'Card 1', ord: 0, qfmt: '', afmt: '' }] } };
  
  exportDb.run(`INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`,
    [now, now, now, JSON.stringify(models), JSON.stringify(decks)]);
  
  notes.forEach((note, i) => {
    const flds = fieldNames.map(f => note.fields[f] || '').join('\x1f');
    exportDb.run(`INSERT INTO notes VALUES (?, ?, ?, -1, ?, ?, '', 0, 0, '')`,
      [note.id || (deckId + i), modelId, now, note.tags || '', flds]);
    exportDb.run(`INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 2500, 0, 0, 0, 0, 0, 0, '')`,
      [deckId + i + 1000, note.id || (deckId + i), deckId, now, i + 1]);
  });
  
  const dbData = exportDb.export();
  exportDb.close();
  
  const zip = new JSZip();
  zip.file('collection.anki2', dbData);
  zip.file('media', '{}');
  
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  return blob;
}
