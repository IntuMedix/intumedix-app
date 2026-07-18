import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDecks, getDueCards, updateCard, logReview, getCardById } from '../../lib/db';
import { scheduleCard, getNextIntervals, Rating, State, isDue } from '../../lib/fsrs';
import { renderCardToBlob, loadTemplates } from '../../lib/templateEngine';

export default function Study() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const [decks, setDecks] = useState([]);
  const [selectedDeckId, setSelectedDeckId] = useState(deckId ? parseInt(deckId) : null);
  const [queue, setQueue] = useState([]);
  const [currentCard, setCurrentCard] = useState(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [iframeSrc, setIframeSrc] = useState('');
  const [intervals, setIntervals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, correct: 0 });
  const [sessionDone, setSessionDone] = useState(false);
  const iframeRef = useRef();
  const blobUrlRef = useRef('');

  // Load decks for selector
  useEffect(() => {
    try { setDecks(getDecks()); } catch (e) {}
    loadTemplates().catch(() => {}); // Warm up template cache
    setLoading(false);
  }, []);

  // Load queue when deck selected
  useEffect(() => {
    if (!selectedDeckId) return;
    try {
      const cards = getDueCards(selectedDeckId, 50);
      if (cards.length === 0) {
        setSessionDone(true);
        setQueue([]);
      } else {
        setQueue(cards);
        setCardIndex(0);
        setSessionDone(false);
      }
    } catch (e) { console.error(e); }
  }, [selectedDeckId]);

  // Render current card
  useEffect(() => {
    const card = queue[cardIndex];
    if (!card) return;
    setCurrentCard(card);
    setShowBack(false);
    renderCurrentCard(card, 'front');
  }, [cardIndex, queue]);

  const renderCurrentCard = useCallback(async (card, side) => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const fields = card.fields || {};
    const savedNotes = localStorage.getItem(`notes_${card.note_id}`) || '';
    const savedErrors = parseInt(localStorage.getItem(`errors_${card.note_id}`) || '0');
    
    try {
      const blobUrl = await renderCardToBlob(side, fields, {
        notes: savedNotes,
        errorCount: savedErrors,
      });
      blobUrlRef.current = blobUrl;
      setIframeSrc(blobUrl);
    } catch (e) {
      console.error('Render error:', e);
    }
  }, []);

  // Listen for messages from card iframe
  useEffect(() => {
    const handler = (event) => {
      const { type, data, from } = event.data || {};
      if (from !== 'intumedix-card') return;

      if (type === 'pycmd') {
        handlePycmd(data);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [currentCard]);

  const handlePycmd = (cmd) => {
    if (!currentCard) return;
    
    if (cmd.startsWith('saveNotes:')) {
      const notes = cmd.slice('saveNotes:'.length);
      localStorage.setItem(`notes_${currentCard.note_id}`, notes);
    } else if (cmd.startsWith('saveErrors:')) {
      const count = cmd.slice('saveErrors:'.length);
      localStorage.setItem(`errors_${currentCard.note_id}`, count);
    } else if (cmd.startsWith('saveImage:')) {
      // Handle image save on desktop/PWA
      const [, payload] = cmd.split(':');
      const [name, ...dataParts] = payload.split(',');
      const dataUrl = dataParts.join(',');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${name || 'IntuMedix'}.png`;
      a.click();
    }
  };

  const flipCard = async () => {
    if (showBack || !currentCard) return;
    setShowBack(true);
    await renderCurrentCard(currentCard, 'back');
    const ivs = getNextIntervals(currentCard);
    setIntervals(ivs);
  };

  const rate = (rating) => {
    if (!currentCard) return;
    
    const updatedCard = scheduleCard(currentCard, rating);
    updateCard({ ...updatedCard, id: currentCard.id });
    logReview(currentCard.id, rating, currentCard.state, currentCard.stability, currentCard.difficulty,
      updatedCard.scheduledDays, 0);

    setSessionStats(s => ({
      reviewed: s.reviewed + 1,
      correct: s.correct + (rating >= Rating.Good ? 1 : 0),
    }));

    // Move to next card
    const nextIndex = cardIndex + 1;
    if (nextIndex >= queue.length) {
      // Check if there are relearning cards due
      const relearning = queue.filter((c, i) => i < cardIndex && isDue({ ...c, dueDate: c.dueDate }));
      if (relearning.length > 0) {
        setQueue(relearning);
        setCardIndex(0);
      } else {
        setSessionDone(true);
      }
    } else {
      setCardIndex(nextIndex);
    }
  };

  // ─── Deck Selector ───────────────────────────────
  if (!selectedDeckId) {
    return (
      <div className="page-content">
        <h2 className="section-title">🧠 اختر حزمة للدراسة</h2>
        {decks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📦</div>
            <div className="empty-title">لا توجد حزم</div>
            <div className="empty-desc">أضف حزمة أولاً من صفحة الحزم</div>
            <button className="btn btn-primary" onClick={() => navigate('/decks')}>إضافة حزمة</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {decks.map(deck => (
              <div key={deck.id} className="deck-card" onClick={() => setSelectedDeckId(deck.id)}>
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
                  {deck.due_cards > 0 && <span className="count-badge count-due">{deck.due_cards}</span>}
                  {deck.new_cards > 0 && <span className="count-badge count-new">{deck.new_cards}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Session Done ────────────────────────────────
  if (sessionDone) {
    const retention = sessionStats.reviewed > 0
      ? Math.round((sessionStats.correct / sessionStats.reviewed) * 100) : 0;

    return (
      <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 80, marginBottom: 20 }}>🎉</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>أحسنت! انتهت الجلسة</h2>
          <p style={{ color: 'var(--color-text-sec)', marginBottom: 28 }}>
            راجعت {sessionStats.reviewed} بطاقة بمعدل إجابة {retention}%
          </p>
          <div className="metric-grid" style={{ marginBottom: 28, gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-value" style={{ color: 'var(--color-primary)', fontSize: 24 }}>{sessionStats.reviewed}</div>
              <div className="metric-label">راجعتها</div>
            </div>
            <div className="metric-card">
              <div className="metric-value" style={{ color: '#10b981', fontSize: 24 }}>{sessionStats.correct}</div>
              <div className="metric-label">صحيحة</div>
            </div>
            <div className="metric-card">
              <div className="metric-value" style={{ color: '#f59e0b', fontSize: 24 }}>{retention}%</div>
              <div className="metric-label">معدل الإجابة</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => { setSelectedDeckId(null); navigate('/study'); }}>
              حزمة أخرى
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/')}>الرئيسية</button>
          </div>
        </div>
      </div>
    );
  }

  const total = queue.length;
  const progress = total > 0 ? (cardIndex / total) * 100 : 0;

  // ─── Study Screen ─────────────────────────────────
  return (
    <div className="study-layout">
      {/* Top Bar */}
      <div style={{
        padding: '8px 16px',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border2)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedDeckId(null); navigate('/study'); }}>
          ← رجوع
        </button>
        <div className="progress-bar-outer" style={{ flex: 1 }}>
          <div className="progress-bar-inner" style={{ width: `${progress}%` }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--color-text-sec)', whiteSpace: 'nowrap' }}>
          {cardIndex + 1} / {total}
        </span>
        <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>
          ✅ {sessionStats.reviewed}
        </span>
      </div>

      {/* Card Frame */}
      <div className="card-frame-wrapper" onClick={!showBack ? flipCard : undefined}
        style={{ cursor: showBack ? 'default' : 'pointer' }}>
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            key={iframeSrc}
            src={iframeSrc}
            className="card-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
            title="IntuMedix Card"
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 16 }}>
            <div className="loading-spinner" />
            <p style={{ color: 'var(--color-text-sec)' }}>جاري تحميل البطاقة...</p>
          </div>
        )}

        {/* Flip hint */}
        {!showBack && iframeSrc && (
          <div style={{
            position: 'absolute',
            bottom: 20, left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.7)',
            color: 'white',
            padding: '8px 18px',
            borderRadius: 20,
            fontSize: 13,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}>
            👆 اضغط لعرض الإجابة
          </div>
        )}
      </div>

      {/* Rating Bar */}
      {showBack && (
        <div className="rating-bar">
          {[
            { key: 'again', label: '🔴 مرة أخرى', rating: Rating.Again },
            { key: 'hard',  label: '🟡 صعب',       rating: Rating.Hard },
            { key: 'good',  label: '🟢 جيد',        rating: Rating.Good },
            { key: 'easy',  label: '🔵 سهل',        rating: Rating.Easy },
          ].map(({ key, label, rating }) => (
            <button
              key={key}
              className={`rating-btn ${key}`}
              onClick={() => rate(rating)}
            >
              {label}
              {intervals && (
                <span className="rating-interval">
                  {intervals[key.charAt(0).toUpperCase() + key.slice(1)]?.label || ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
