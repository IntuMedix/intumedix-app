import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDecks, createDeck, deleteDeck } from '../../lib/db';
import { parseApkg, importApkg, exportToApkg } from '../../lib/apkg';
import { useApp } from '../../App';

export default function Decks() {
  const navigate = useNavigate();
  const { setStudyDeckId } = useApp();
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [showNewDeck, setShowNewDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef();

  const load = () => {
    try { setDecks(getDecks()); } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = decks.filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.apkg')) {
      alert('الملف يجب أن يكون بصيغة .apkg');
      return;
    }

    setImporting(true);
    setImportProgress(0);

    try {
      const parsed = await parseApkg(file);
      const imported = await importApkg(parsed, (p) => setImportProgress(p));
      alert(`✅ تم الاستيراد بنجاح!\n${imported.map(d => `📦 ${d.deckName}: ${d.count} بطاقة`).join('\n')}`);
      load();
    } catch (err) {
      console.error(err);
      alert('❌ فشل الاستيراد: ' + err.message);
    } finally {
      setImporting(false);
      setImportProgress(0);
      e.target.value = '';
    }
  };

  const handleCreateDeck = () => {
    if (!newDeckName.trim()) return;
    createDeck(newDeckName.trim());
    setNewDeckName('');
    setShowNewDeck(false);
    load();
  };

  const handleDelete = (deck) => {
    if (!confirm(`حذف "${deck.name}"؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;
    deleteDeck(deck.id);
    load();
  };

  const handleExport = async (deck) => {
    try {
      const { getNotes } = await import('../../lib/db');
      const notes = getNotes(deck.id);
      const blob = await exportToApkg(notes, deck.name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${deck.name.replace(/\s+/g, '_')}.apkg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('فشل التصدير: ' + e.message);
    }
  };

  if (loading) return <div className="loading-spinner" style={{ marginTop: 60 }} />;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h2 className="section-title" style={{ marginBottom: 0 }}>📦 الحزم</h2>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="input"
            style={{ width: 200 }}
            placeholder="🔍 بحث..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <input ref={fileInputRef} type="file" accept=".apkg" style={{ display: 'none' }} onChange={handleImport} />
          <button className="btn btn-cyan" onClick={() => fileInputRef.current.click()} disabled={importing}>
            {importing ? `⬆️ ${importProgress}%` : '⬆️ استيراد .apkg'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowNewDeck(true)}>
            ＋ حزمة جديدة
          </button>
        </div>
      </div>

      {/* Import progress */}
      {importing && (
        <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
            <span>⬆️ جاري الاستيراد...</span>
            <span>{importProgress}%</span>
          </div>
          <div className="progress-bar-outer">
            <div className="progress-bar-inner" style={{ width: `${importProgress}%` }} />
          </div>
        </div>
      )}

      {/* New Deck Modal */}
      {showNewDeck && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowNewDeck(false)}>
          <div className="modal-box" style={{ position: 'relative' }}>
            <button className="modal-close" onClick={() => setShowNewDeck(false)}>×</button>
            <div className="modal-title">📦 إنشاء حزمة جديدة</div>
            <input
              className="input"
              placeholder="اسم الحزمة..."
              value={newDeckName}
              onChange={e => setNewDeckName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateDeck()}
              autoFocus
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary btn-block" onClick={handleCreateDeck}>إنشاء</button>
              <button className="btn btn-ghost btn-block" onClick={() => setShowNewDeck(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* Decks List */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📦</div>
          <div className="empty-title">{decks.length === 0 ? 'لا توجد حزم' : 'لا نتائج للبحث'}</div>
          <div className="empty-desc">
            {decks.length === 0
              ? 'استورد ملف .apkg من أنكي أو أنشئ حزمة جديدة للبدء'
              : 'جرب كلمة بحث مختلفة'}
          </div>
          {decks.length === 0 && (
            <button className="btn btn-cyan" onClick={() => fileInputRef.current.click()}>
              ⬆️ استيراد .apkg
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(deck => (
            <DeckRow
              key={deck.id}
              deck={deck}
              onStudy={() => { setStudyDeckId(deck.id); navigate(`/study/${deck.id}`); }}
              onExport={() => handleExport(deck)}
              onDelete={() => handleDelete(deck)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckRow({ deck, onStudy, onExport, onDelete }) {
  const [hover, setHover] = useState(false);

  return (
    <div
      className="deck-card"
      style={{ borderColor: hover ? 'var(--color-primary)' : undefined }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="deck-icon">📚</div>

      <div className="deck-info">
        <div className="deck-name">{deck.name}</div>
        <div className="deck-meta">
          <span>📄 {deck.total_cards || 0} بطاقة</span>
          {deck.due_cards > 0 && <span style={{ color: '#fca5a5' }}>🔴 {deck.due_cards} للمراجعة</span>}
          {deck.new_cards > 0 && <span style={{ color: 'var(--color-primary-h)' }}>🆕 {deck.new_cards} جديد</span>}
        </div>
      </div>

      <div className="deck-counts">
        <button className="btn btn-primary btn-sm" onClick={onStudy}
          disabled={!deck.due_cards && !deck.new_cards}>
          دراسة
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onExport} title="تصدير .apkg">⬇️</button>
        <button className="btn btn-danger btn-sm" onClick={onDelete} title="حذف">🗑️</button>
      </div>
    </div>
  );
}
