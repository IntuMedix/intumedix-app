import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDecks, createDeck, deleteDeck, getNotes } from '../../lib/db';
import { parseAndImportApkg, exportToApkg } from '../../lib/apkg';

export default function Decks() {
  const navigate = useNavigate();
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importMessage, setImportMessage] = useState('');
  const [showNewDeck, setShowNewDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const load = () => {
    try { setDecks(getDecks()); } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = decks.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ── Import Handler ──────────────────────────────────────────
  const handleImportChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // Reset for re-import

    if (!file.name.endsWith('.apkg')) {
      alert('الملف يجب أن يكون بصيغة .apkg');
      return;
    }

    setImporting(true);
    setImportProgress(0);
    setImportMessage('جاري فتح الملف...');

    try {
      const results = await parseAndImportApkg(file, (p) => {
        setImportProgress(p);
        if (p < 20)       setImportMessage('جاري فتح قاعدة البيانات...');
        else if (p < 40)  setImportMessage('جاري قراءة النماذج والحزم...');
        else if (p < 80)  setImportMessage(`جاري استيراد البطاقات... ${p}%`);
        else if (p < 95)  setImportMessage('جاري استيراد الوسائط...');
        else              setImportMessage('جاري الحفظ...');
      });

      const summary = results.map(d => `📦 ${d.deckName}: ${d.count} بطاقة`).join('\n');
      alert(`✅ تم الاستيراد بنجاح!\n\n${summary}`);
      load();
    } catch (err) {
      console.error('Import error:', err);
      alert('❌ فشل الاستيراد:\n' + (err.message || String(err)));
    } finally {
      setImporting(false);
      setImportProgress(0);
      setImportMessage('');
    }
  };

  // ── Export Handler ──────────────────────────────────────────
  const handleExport = async (deck) => {
    try {
      const notes = getNotes(deck.id);
      const blob = await exportToApkg(notes, deck.name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deck.name}.apkg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('فشل التصدير: ' + err.message);
    }
  };

  // ── Create Deck ──────────────────────────────────────────────
  const handleCreateDeck = () => {
    if (!newDeckName.trim()) return;
    createDeck(newDeckName.trim());
    setNewDeckName('');
    setShowNewDeck(false);
    load();
  };

  // ── Delete Deck ──────────────────────────────────────────────
  const handleDelete = (id) => {
    deleteDeck(id);
    setDeleteConfirm(null);
    load();
  };

  // ── Study ────────────────────────────────────────────────────
  const handleStudy = (deckId, dueCards, newCards) => {
    if (dueCards === 0 && newCards === 0) {
      alert('لا توجد بطاقات للمراجعة في هذه الحزمة الآن 🎉');
      return;
    }
    navigate(`/study/${deckId}`);
  };

  return (
    <div className="page-content">
      {/* Import progress overlay */}
      {importing && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, gap: 20,
        }}>
          <div style={{ background: 'var(--color-surface-1)', borderRadius: 20, padding: '32px 48px', maxWidth: 400, width: '90%', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📦</div>
            <h3 style={{ marginBottom: 8, fontSize: 18 }}>جاري الاستيراد</h3>
            <p style={{ color: 'var(--color-text-sec)', marginBottom: 20, fontSize: 14 }}>{importMessage}</p>
            <div style={{ background: 'var(--color-surface-2)', borderRadius: 8, height: 10, overflow: 'hidden' }}>
              <div style={{
                width: `${importProgress}%`,
                height: '100%',
                background: 'linear-gradient(90deg, var(--color-primary), var(--color-primary-h))',
                borderRadius: 8,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <p style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-dim)' }}>{importProgress}%</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Import button — using a <label> directly on the input so it always works */}
        <label style={{ cursor: 'pointer' }}>
          <span className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>⬆</span> استيراد .apkg
          </span>
          <input
            type="file"
            accept=".apkg"
            onChange={handleImportChange}
            style={{ display: 'none' }}
            disabled={importing}
          />
        </label>

        <button className="btn btn-secondary" onClick={() => setShowNewDeck(true)}>
          + حزمة جديدة
        </button>

        <input
          type="text"
          className="input"
          placeholder="بحث..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ marginRight: 'auto', maxWidth: 240 }}
        />
      </div>

      {/* New deck form */}
      {showNewDeck && (
        <div style={{
          background: 'var(--color-surface-2)', borderRadius: 12, padding: 16,
          marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <input
            type="text"
            className="input"
            placeholder="اسم الحزمة الجديدة..."
            value={newDeckName}
            onChange={e => setNewDeckName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateDeck()}
            autoFocus
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={handleCreateDeck}>إنشاء</button>
          <button className="btn btn-ghost" onClick={() => { setShowNewDeck(false); setNewDeckName(''); }}>إلغاء</button>
        </div>
      )}

      {/* Decks list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="loading-spinner" />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--color-text-sec)' }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>📦</div>
          <h3 style={{ marginBottom: 8 }}>لا توجد حزم</h3>
          <p>استورد ملف .apkg من أنكي أو أنشئ حزمة جديدة للبدء</p>
          <label style={{ cursor: 'pointer', marginTop: 20, display: 'inline-block' }}>
            <span className="btn btn-primary" style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>⬆</span> استيراد .apkg
            </span>
            <input type="file" accept=".apkg" onChange={handleImportChange} style={{ display: 'none' }} disabled={importing} />
          </label>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(deck => (
            <div key={deck.id} style={{
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-border)',
              borderRadius: 14,
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
            }}>
              {/* Deck info */}
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>{deck.name}</div>
                <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-text-sec)' }}>
                  <span title="البطاقات الجديدة" style={{ color: '#60a5fa' }}>
                    🔵 {deck.new_cards || 0} جديدة
                  </span>
                  <span title="للمراجعة" style={{ color: '#f97316' }}>
                    🟠 {deck.due_cards || 0} للمراجعة
                  </span>
                  <span title="الإجمالي">
                    📊 {deck.total_cards || 0} إجمالاً
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleStudy(deck.id, deck.due_cards, deck.new_cards)}
                  style={{ minWidth: 80 }}
                >
                  📖 ذاكر
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => handleExport(deck)}
                  title="تصدير .apkg"
                >
                  ⬇ تصدير
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setDeleteConfirm(deck.id)}
                  title="حذف الحزمة"
                >
                  🗑
                </button>
              </div>

              {/* Delete confirm */}
              {deleteConfirm === deck.id && (
                <div style={{ width: '100%', padding: '10px 0 0', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: '#ef4444', flex: 1, fontSize: 14 }}>⚠️ هل أنت متأكد من حذف "{deck.name}"؟</span>
                  <button className="btn btn-danger" onClick={() => handleDelete(deck.id)}>نعم، احذف</button>
                  <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>إلغاء</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
