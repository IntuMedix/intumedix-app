/**
 * IntuMedix App - Anki .apkg Parser
 * 
 * Supports all Anki formats:
 *   - collection.anki2  (legacy, SQLite)
 *   - collection.anki21 (modern, SQLite)
 *   - collection.anki21b (newest, zstd-compressed SQLite)
 *
 * Each note can have multiple cards (one per template).
 * Notes are deduplicated by anki_id.
 */

import JSZip from 'jszip';
import { decompress as zstdDecompress } from 'fzstd';
import {
  getSQLInstance,
  createDeck,
  createNoteType,
  createNote,
  createCard,
  saveDB,
  saveMedia,
} from './db.js';

// ─── SQL instance ─────────────────────────────────────────────
async function getSql() {
  let SQL = getSQLInstance();
  if (SQL) return SQL;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 100));
    SQL = getSQLInstance();
    if (SQL) return SQL;
  }
  throw new Error('SQL.js not initialized. Please wait for app to fully load.');
}

// ─── Anki epoch helpers ───────────────────────────────────────
// Anki review cards: due = days since 2006-01-01
const ANKI_EPOCH_MS = new Date('2006-01-01T00:00:00Z').getTime();

function ankiDayToISO(due, type) {
  if (type === 0) return null;          // new cards: no due date
  if (type === 1 || type === 3) {       // learning/relearning: epoch seconds
    return new Date(due * 1000).toISOString();
  }
  // review cards: days since Anki epoch
  return new Date(ANKI_EPOCH_MS + due * 86400000).toISOString();
}

// ─── zstd decompression ───────────────────────────────────────
async function decompressZstd(compressedBuffer) {
  const compressed = new Uint8Array(compressedBuffer);
  // fzstd.decompress returns Uint8Array
  return zstdDecompress(compressed);
}

// ─── Main: Parse + Import .apkg ──────────────────────────────
/**
 * Parse an .apkg file and import all decks/notes/cards into IntuMedix.
 * @param {File} apkgFile
 * @param {function} onProgress  0..100
 * @returns {Array<{deckName, count}>}
 */
export async function parseAndImportApkg(apkgFile, onProgress = () => {}) {
  onProgress(2);
  const sql = await getSql();
  onProgress(5);

  // ── 1. Open ZIP ──────────────────────────────────────────────
  const zip = await JSZip.loadAsync(apkgFile);
  onProgress(10);

  // ── 2. Find collection database (try newest format first) ────
  let dbData;
  let isCompressed = false;

  const anki21b = zip.file('collection.anki21b');
  const anki21  = zip.file('collection.anki21');
  const anki2   = zip.file('collection.anki2');

  if (anki21b) {
    // Newest format: zstd-compressed SQLite
    isCompressed = true;
    const raw = await anki21b.async('arraybuffer');
    onProgress(15);
    try {
      dbData = await decompressZstd(raw);
    } catch (e) {
      throw new Error('فشل فك ضغط قاعدة البيانات (zstd). تأكد من أن الملف سليم.');
    }
  } else if (anki21) {
    dbData = new Uint8Array(await anki21.async('arraybuffer'));
  } else if (anki2) {
    dbData = new Uint8Array(await anki2.async('arraybuffer'));
  } else {
    throw new Error('ملف .apkg غير صالح: لا توجد قاعدة بيانات (collection.anki2/21/21b)');
  }
  onProgress(20);

  // ── 3. Open SQLite database ──────────────────────────────────
  let ankiDb;
  try {
    ankiDb = new sql.Database(dbData);
  } catch (e) {
    throw new Error('فشل فتح قاعدة البيانات: ' + e.message);
  }

  // ── 4. Read col table for decks + models ────────────────────
  let decksJson = {}, modelsJson = {};
  try {
    const colResult = ankiDb.exec(`SELECT decks, models FROM col LIMIT 1`);
    if (colResult.length > 0 && colResult[0].values.length > 0) {
      const [decksRaw, modelsRaw] = colResult[0].values[0];
      try { decksJson  = JSON.parse(decksRaw  || '{}'); } catch(e) {}
      try { modelsJson = JSON.parse(modelsRaw || '{}'); } catch(e) {}
    }
  } catch(e) {
    // If table col doesn't have these columns, we'll try tables below
  }

  // Fallback for modern Anki SQLite schema (separate tables for decks, notetypes, fields, templates)
  if (Object.keys(modelsJson).length === 0 || Object.keys(decksJson).length === 0) {
    try {
      const hasNoteTypesTable = ankiDb.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'`);
      if (hasNoteTypesTable.length > 0) {
        const ntResult = ankiDb.exec(`SELECT id, name, config FROM notetypes`);
        if (ntResult.length > 0) {
          ntResult[0].values.forEach(([id, name, config]) => {
            let parsedConfig = {};
            if (typeof config === 'string') {
              try { parsedConfig = JSON.parse(config); } catch(e) {}
            }
            
            // Query fields table
            let flds = [];
            try {
              const fieldsResult = ankiDb.exec(`SELECT name, ord FROM fields WHERE ntid = ? ORDER BY ord`, [id]);
              if (fieldsResult.length > 0) {
                flds = fieldsResult[0].values.map(([fname, ford]) => ({ name: fname, ord: ford }));
              }
            } catch(e) {}
            if (flds.length === 0) flds = parsedConfig.flds || [];

            // Query templates table
            let tmpls = [];
            try {
              const tmplsResult = ankiDb.exec(`SELECT name, ord, qfmt, afmt FROM templates WHERE ntid = ? ORDER BY ord`, [id]);
              if (tmplsResult.length > 0) {
                tmpls = tmplsResult[0].values.map(([tname, tord, tqfmt, tafmt]) => ({
                  name: tname, ord: tord, qfmt: tqfmt, afmt: tafmt
                }));
              }
            } catch(e) {}
            if (tmpls.length === 0) tmpls = parsedConfig.tmpls || [];

            modelsJson[String(id)] = {
              id,
              name,
              flds,
              tmpls,
              css: parsedConfig.css || '',
            };
          });
        }
      }
    } catch (e) {
      console.warn("Failed to parse modern notetypes/fields/templates:", e);
    }

    try {
      const hasDecksTable = ankiDb.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='decks'`);
      if (hasDecksTable.length > 0) {
        const dkResult = ankiDb.exec(`SELECT id, name FROM decks`);
        if (dkResult.length > 0) {
          dkResult[0].values.forEach(([id, name]) => {
            decksJson[String(id)] = { id, name };
          });
        }
      }
    } catch (e) {
      console.warn("Failed to parse modern decks table:", e);
    }
  }

  // ── 5. Build deck map: ankiId → name ────────────────────────
  const deckNameMap = {};
  for (const [id, deck] of Object.entries(decksJson)) {
    if (id !== '1') deckNameMap[id] = deck.name;
  }

  // ── 6. Build model map ───────────────────────────────────────
  const modelMap = {};
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
      name:       model.name || 'Unknown',
      type:       model.type || 0,   // 0=standard, 1=cloze
      fieldNames,
      templates,
      css:        model.css || '',
    };
  }

  // ── 7. Create IntuMedix note types (one per Anki model) ─────
  const noteTypeIdMap = {}; // ankiModelId → intumedixNoteTypeId
  for (const [mid, model] of Object.entries(modelMap)) {
    // Use first template for the main front/back
    const tmpl = model.templates[0] || {};
    noteTypeIdMap[mid] = createNoteType(
      model.name,
      model.fieldNames,
      tmpl.qfmt || '{{Front}}',
      tmpl.afmt || '{{FrontSide}}<hr>{{Back}}',
      model.css || '',
      mid,
    );
  }

  // ── 8. Create IntuMedix decks ────────────────────────────────
  const deckIdMap = {};
  for (const [ankiId, name] of Object.entries(deckNameMap)) {
    deckIdMap[ankiId] = createDeck(name, 'مستورد من Anki', ankiId);
  }
  // Lazy fallback deck
  let _fallbackId = null;
  const getFallbackDeckId = () => {
    if (!_fallbackId) _fallbackId = createDeck('Imported', 'مستورد من Anki');
    return _fallbackId;
  };

  onProgress(30);

  // ── 9. Read ALL notes ────────────────────────────────────────
  let rawNotes = [];
  try {
    const r = ankiDb.exec(`SELECT id, guid, mid, mod, tags, flds FROM notes`);
    if (r.length > 0) rawNotes = r[0].values;
  } catch(e) {
    throw new Error('فشل قراءة الملاحظات: ' + e.message);
  }

  // ── 10. Read ALL cards ───────────────────────────────────────
  let rawCards = [];
  try {
    const r = ankiDb.exec(`SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses FROM cards`);
    if (r.length > 0) rawCards = r[0].values;
  } catch(e) {
    throw new Error('فشل قراءة البطاقات: ' + e.message);
  }

  onProgress(40);

  // ── 11. Parse notes into lookup map ─────────────────────────
  // ankiNoteId (string) → { mid, fields, tags, guid }
  const noteInfoMap = {};
  for (const [id, guid, mid, mod, tags, flds] of rawNotes) {
    const model = modelMap[String(mid)];
    const fieldValues = flds ? flds.split('\x1f') : [];
    const fieldsObj = {};
    if (model) {
      model.fieldNames.forEach((name, i) => { fieldsObj[name] = fieldValues[i] || ''; });
    } else {
      fieldValues.forEach((v, i) => { fieldsObj[`Field${i + 1}`] = v; });
    }
    noteInfoMap[String(id)] = { mid: String(mid), fields: fieldsObj, tags: tags || '', guid };
  }

  // ── 12. Import notes + cards ─────────────────────────────────
  // Track which Anki note IDs we've already inserted (notes are shared across cards)
  const insertedNoteMap = {}; // ankiNoteId → intumedixNoteId

  let totalCards = rawCards.length;
  let processed  = 0;
  const importedDecks = {}; // deckName → card count

  for (const [cardId, nid, did, ord, type, queue, due, ivl, factor, reps, lapses] of rawCards) {
    const noteInfo = noteInfoMap[String(nid)];
    if (!noteInfo) { processed++; continue; }

    const deckId   = deckIdMap[String(did)] || getFallbackDeckId();
    const deckName = deckNameMap[String(did)] || 'Imported';
    const noteTypeId = noteTypeIdMap[noteInfo.mid] || null;

    // Deduplicate: only insert each note ONCE across all its cards
    let intumedixNoteId = insertedNoteMap[String(nid)];
    if (intumedixNoteId === undefined) {
      intumedixNoteId = createNote(
        deckId, noteInfo.fields, noteInfo.tags,
        noteTypeId, nid, noteInfo.guid
      );
      insertedNoteMap[String(nid)] = intumedixNoteId;
    }

    // For multi-template models, use the correct template for this card's ord
    const model = modelMap[noteInfo.mid] || {};
    const tmpl  = (model.templates || [])[ord] || (model.templates || [])[0] || {};
    const cardNoteTypeId = noteTypeId; // we store per-card template in card itself if needed

    createCard(intumedixNoteId, deckId, {
      ord,
      due_date:    ankiDayToISO(due, type),
      anki_ivl:    ivl    || 0,
      anki_factor: factor || 2500,
      anki_type:   type   || 0,
      anki_queue:  queue  || 0,
      state:       type   === 0 ? 0 : (type === 2 ? 2 : 1),
      reps:        reps   || 0,
      lapses:      lapses || 0,
    });

    importedDecks[deckName] = (importedDecks[deckName] || 0) + 1;
    processed++;

    if (processed % 100 === 0) {
      onProgress(40 + Math.round((processed / totalCards) * 45));
    }
  }

  onProgress(85);
  ankiDb.close();

  // ── 13. Extract media → IndexedDB ────────────────────────────
  const mediaManifest = {};
  const mediaFile = zip.file('media');
  if (mediaFile) {
    try {
      Object.assign(mediaManifest, JSON.parse(await mediaFile.async('text')));
    } catch(e) {}
  }

  let mediaCount = 0;
  const mediaEntries = Object.entries(mediaManifest);
  for (const [fileNum, filename] of mediaEntries) {
    const entry = zip.file(fileNum);
    if (!entry) continue;
    try {
      const b64 = await entry.async('base64');
      const ext  = filename.split('.').pop().toLowerCase();
      const mimeMap = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';
      await saveMedia(filename, `data:${mime};base64,${b64}`);
      mediaCount++;
    } catch(e) {}
    if (mediaEntries.length > 0) {
      onProgress(85 + Math.round((mediaCount / mediaEntries.length) * 10));
    }
  }

  saveDB();
  onProgress(100);

  return Object.entries(importedDecks).map(([deckName, count]) => ({ deckName, count }));
}

// ─── Export to .apkg ─────────────────────────────────────────
export async function exportToApkg(notes, deckName) {
  const sql = await getSql();
  const exportDb = new sql.Database();

  exportDb.run(`CREATE TABLE notes (id INTEGER, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT)`);
  exportDb.run(`CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT)`);
  exportDb.run(`CREATE TABLE col (id INTEGER, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER, dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT)`);
  exportDb.run(`CREATE TABLE graves (usn INTEGER, oid INTEGER, type INTEGER)`);
  exportDb.run(`CREATE TABLE revlog (id INTEGER, cid INTEGER, usn INTEGER, ease INTEGER, ivl INTEGER, lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER)`);

  const now     = Math.floor(Date.now() / 1000);
  const deckId  = Date.now();
  const modelId = Date.now() + 1;

  const allFields = new Set();
  notes.forEach(n => Object.keys(n.fields || {}).forEach(k => allFields.add(k)));
  const fieldNames = Array.from(allFields);

  const decksObj = {
    [deckId]: { id: deckId, name: deckName, conf: 1, extendNew: 10, extendRev: 50, mod: now, usn: -1 },
  };
  const modelsObj = {
    [modelId]: {
      id: modelId, name: 'IntuMedix', type: 0, mod: now, usn: -1,
      flds: fieldNames.map((n, i) => ({ name: n, ord: i, sticky: false, rtl: false, font: 'Arial', size: 20 })),
      tmpls: [{
        name: 'Card 1', ord: 0,
        qfmt: `{{${fieldNames[0] || 'Front'}}}`,
        afmt: `{{FrontSide}}<hr>{{${fieldNames[1] || 'Back'}}}`,
      }],
      css: '.card { font-family: Arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
    },
  };

  exportDb.run(`INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, -1, 0, '{}', ?, ?, '{}', '{}')`,
    [now, now, now, JSON.stringify(modelsObj), JSON.stringify(decksObj)]);

  notes.forEach((note, i) => {
    const flds = fieldNames.map(f => String(note.fields[f] || '')).join('\x1f');
    const nid  = note.anki_id || (deckId + i);
    exportDb.run(`INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, 0, 0, '')`,
      [nid, `im-${nid}`, modelId, now, note.tags || '', flds, String(note.fields[fieldNames[0]] || '').substring(0, 100)]);
    exportDb.run(`INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 2500, ?, ?, 0, 0, 0, 0, '')`,
      [deckId + i + 1e6, nid, deckId, now, i + 1, note.reps || 0, note.lapses || 0]);
  });

  const dbData = exportDb.export();
  exportDb.close();

  const zip = new JSZip();
  zip.file('collection.anki2', dbData);
  zip.file('media', '{}');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
