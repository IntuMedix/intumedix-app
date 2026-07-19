import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDecks, getDueCards, updateCard, logReview } from '../../lib/db';
import { getMedia } from '../../lib/db';
import { scheduleCard, getNextReview } from '../../lib/fsrs';

// ─── Anki Template Renderer ──────────────────────────────────
/**
 * Renders an Anki template by substituting {{FieldName}} with actual values.
 * Supports:
 *   {{FieldName}}         — basic substitution
 *   {{FrontSide}}         — inserts rendered front HTML (back template only)
 *   {{#FieldName}}...{{/FieldName}}  — conditional blocks
 *   {{^FieldName}}...{{/FieldName}}  — negation blocks
 *   {{cloze:FieldName}}   — cloze (simplified)
 */
function renderAnkiTemplate(template, fields, frontHtml = '') {
  if (!template) return '';
  let html = template;

  // Replace {{FrontSide}}
  html = html.replace(/\{\{FrontSide\}\}/g, frontHtml);

  // Replace conditional blocks {{#Field}}...{{/Field}}
  html = html.replace(/\{\{#(\w[\w\s]*?)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, fieldName, content) => {
    const val = fields[fieldName];
    return (val && val.trim()) ? content : '';
  });

  // Replace negation blocks {{^Field}}...{{/Field}}
  html = html.replace(/\{\{\^(\w[\w\s]*?)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, fieldName, content) => {
    const val = fields[fieldName];
    return (!val || !val.trim()) ? content : '';
  });

  // Replace cloze {{cloze:Field}}
  html = html.replace(/\{\{cloze:(\w[\w\s]*?)\}\}/g, (_, fieldName) => {
    const val = fields[fieldName] || '';
    // Reveal all cloze deletions
    return val.replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, (__, answer) => `<span class="cloze">${answer}</span>`);
  });

  // Replace all remaining {{FieldName}}
  html = html.replace(/\{\{(\w[\w\s]*?)\}\}/g, (match, fieldName) => {
    if (fieldName in fields) return fields[fieldName] || '';
    return ''; // Empty for unknown fields
  });

  return html;
}

/**
 * Resolve media references in HTML (e.g. <img src="image.png">) 
 * by replacing filenames with IndexedDB data URIs
 */
async function resolveMediaInHtml(html, mediaCache) {
  if (!html) return html;
  
  // Find all src="filename" and src='filename' references
  const promises = [];
  const refs = new Set();
  
  // Collect all media references
  const imgRegex = /src=["']([^"'<>]+)["']/g;
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    const filename = m[1];
    if (!filename.startsWith('data:') && !filename.startsWith('http') && !filename.startsWith('/')) {
      refs.add(filename);
    }
  }
  
  // Also handle [sound:filename]
  const soundRegex = /\[sound:([^\]]+)\]/g;
  while ((m = soundRegex.exec(html)) !== null) {
    refs.add(m[1]);
  }

  // Load from IndexedDB (use cache to avoid repeated lookups)
  for (const filename of refs) {
    if (!mediaCache.has(filename)) {
      const data = await getMedia(filename);
      mediaCache.set(filename, data);
    }
  }

  // Replace references in HTML
  let resolved = html;
  for (const filename of refs) {
    const dataUri = mediaCache.get(filename);
    if (dataUri) {
      // Replace src="filename"
      resolved = resolved.replace(
        new RegExp(`src=["']${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'g'),
        `src="${dataUri}"`
      );
      // Replace [sound:filename] with audio element
      resolved = resolved.replace(
        new RegExp(`\\[sound:${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'g'),
        `<audio controls autoplay><source src="${dataUri}"></audio>`
      );
    }
  }

  return resolved;
}

/**
 * Build a complete HTML document for rendering in an iframe
 */
function buildCardDocument(bodyHtml, css) {
  return `<!DOCTYPE html>
<html dir="auto">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { 
    height: 100%; 
    overflow: auto;
    background: transparent;
  }
  .card {
    font-family: Arial, 'Noto Sans Arabic', sans-serif;
    font-size: 20px;
    text-align: center;
    color: #e0e0e0;
    padding: 20px;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }
  img { max-width: 100%; height: auto; border-radius: 8px; }
  audio { width: 100%; margin: 8px 0; }
  hr { border: none; border-top: 1px solid rgba(255,255,255,0.2); margin: 16px 0; width: 100%; }
  .cloze { color: #60a5fa; font-weight: bold; }
  b, strong { color: #93c5fd; }
  
  /* Anki highlight colors */
  .nightMode .card { color: #e0e0e0; background: transparent; }
  
  ${css || ''}
</style>
</head>
<body class="nightMode">
<div class="card">
${bodyHtml}
</div>
</body>
</html>`;
}

// ─── Rating Buttons ───────────────────────────────────────────
const RATINGS = [
  { value: 1, label: 'مرة أخرى', color: '#ef4444', shortcut: '1' },
  { value: 2, label: 'صعب',      color: '#f97316', shortcut: '2' },
  { value: 3, label: 'جيد',      color: '#22c55e', shortcut: '3' },
  { value: 4, label: 'سهل',      color: '#3b82f6', shortcut: '4' },
];

// ─── Main Study Component ─────────────────────────────────────
export default function Study() {
  const { deckId } = useParams();
  const navigate = useNavigate();

  const [deck, setDeck] = useState(null);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [showBack, setShowBack] = useState(false);
  const [frontHtml, setFrontHtml] = useState('');
  const [backHtml, setBackHtml] = useState('');
  const [sessionStats, setSessionStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const mediaCache = useRef(new Map());
  const frontFrameRef = useRef();
  const backFrameRef = useRef();

  // Load deck and due cards
  useEffect(() => {
    if (!deckId) {
      // If no deck, show all due cards
      const decks = getDecks();
      if (decks.length > 0) navigate(`/study/${decks[0].id}`);
      else { setDone(true); setLoading(false); }
      return;
    }

    const cards = getDueCards(parseInt(deckId));
    setQueue(cards);
    setLoading(false);

    if (cards.length === 0) { setDone(true); return; }
    loadCard(cards[0]);
  }, [deckId]);

  const loadCard = useCallback(async (card) => {
    setCurrent(card);
    setShowBack(false);

    // Determine templates
    const qfmt = card.template_front || `{{${Object.keys(card.fields)[0] || 'Front'}}}`;
    const afmt = card.template_back  || `{{FrontSide}}<hr>{{${Object.keys(card.fields)[1] || 'Back'}}}`;
    const css  = card.css || '';

    // Render front
    const rawFront = renderAnkiTemplate(qfmt, card.fields, '');
    const resolvedFront = await resolveMediaInHtml(rawFront, mediaCache.current);
    const frontDoc = buildCardDocument(resolvedFront, css);
    setFrontHtml(frontDoc);

    // Render back (with FrontSide = rendered front)
    const rawBack = renderAnkiTemplate(afmt, card.fields, resolvedFront);
    const resolvedBack = await resolveMediaInHtml(rawBack, mediaCache.current);
    const backDoc = buildCardDocument(resolvedBack, css);
    setBackHtml(backDoc);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space' || e.code === 'Enter') {
        if (!showBack) setShowBack(true);
      }
      if (showBack) {
        if (e.key === '1') rate(1);
        if (e.key === '2') rate(2);
        if (e.key === '3') rate(3);
        if (e.key === '4') rate(4);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showBack, current]);

  const rate = useCallback((rating) => {
    if (!current) return;

    const statsBefore = {
      state: current.state || 0,
      stability: current.stability,
      difficulty: current.difficulty,
    };

    const scheduled = scheduleCard(current, rating);
    updateCard(scheduled);
    logReview(current.id, rating, statsBefore.state, statsBefore.stability, statsBefore.difficulty, scheduled.scheduledDays, 0);

    setSessionStats(prev => {
      const key = ['', 'again', 'hard', 'good', 'easy'][rating];
      return { ...prev, [key]: (prev[key] || 0) + 1 };
    });

    // Advance queue
    const newQueue = queue.slice(1);
    // If rating=1 (Again), push card back to review later
    if (rating === 1 && newQueue.length > 0) {
      const insertAt = Math.min(3, newQueue.length);
      newQueue.splice(insertAt, 0, { ...current, state: 1 });
    }

    if (newQueue.length === 0) {
      setDone(true);
    } else {
      setQueue(newQueue);
      loadCard(newQueue[0]);
    }
  }, [current, queue, loadCard]);

  // ── Render: Loading ──
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 16 }}>
        <div className="loading-spinner" />
        <p style={{ color: 'var(--color-text-sec)' }}>جاري تحميل البطاقات...</p>
      </div>
    );
  }

  // ── Render: Done ──
  if (done) {
    const total = Object.values(sessionStats).reduce((a, b) => a + b, 0);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', gap: 24, padding: 24 }}>
        <div style={{ fontSize: 64 }}>🎉</div>
        <h2 style={{ fontSize: 24, fontWeight: 700 }}>انتهت جلسة المراجعة!</h2>
        {total > 0 && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
            {RATINGS.map(r => (
              <div key={r.value} style={{ textAlign: 'center', background: 'var(--color-surface-2)', borderRadius: 12, padding: '12px 20px' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: r.color }}>
                  {sessionStats[['','again','hard','good','easy'][r.value]] || 0}
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-sec)', marginTop: 4 }}>{r.label}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={() => navigate('/')}>العودة للرئيسية</button>
          <button className="btn btn-ghost" onClick={() => navigate('/decks')}>الحزم</button>
        </div>
      </div>
    );
  }

  // ── Render: Study ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0 16px 16px' }}>
      {/* Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1, height: 6, background: 'var(--color-surface-2)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: `${100 - (queue.length / (queue.length + Object.values(sessionStats).reduce((a,b)=>a+b,0))) * 100}%`,
            height: '100%',
            background: 'var(--color-primary)',
            borderRadius: 3,
            transition: 'width 0.3s ease',
          }} />
        </div>
        <span style={{ fontSize: 13, color: 'var(--color-text-sec)', whiteSpace: 'nowrap' }}>
          {queue.length} متبقية
        </span>
      </div>

      {/* Card display */}
      <div style={{
        flex: 1,
        background: 'var(--color-surface-1)',
        borderRadius: 16,
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
        position: 'relative',
        minHeight: 300,
      }}>
        {/* Front */}
        <iframe
          ref={frontFrameRef}
          srcDoc={frontHtml}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: 'transparent',
            display: showBack ? 'none' : 'block',
            minHeight: 300,
          }}
          sandbox="allow-scripts allow-same-origin"
          title="card-front"
        />

        {/* Back */}
        {showBack && (
          <iframe
            ref={backFrameRef}
            srcDoc={backHtml}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: 'transparent',
              minHeight: 300,
            }}
            sandbox="allow-scripts allow-same-origin"
            title="card-back"
          />
        )}
      </div>

      {/* Action buttons */}
      <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        {!showBack ? (
          <button
            className="btn btn-primary"
            onClick={() => setShowBack(true)}
            style={{ minWidth: 200, fontSize: 16, padding: '14px 32px' }}
          >
            إظهار الإجابة (Space)
          </button>
        ) : (
          RATINGS.map(r => {
            const next = getNextReview(current, r.value);
            return (
              <button
                key={r.value}
                onClick={() => rate(r.value)}
                style={{
                  background: r.color + '22',
                  border: `2px solid ${r.color}`,
                  color: r.color,
                  borderRadius: 10,
                  padding: '10px 20px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  minWidth: 80,
                  transition: 'all 0.15s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => e.currentTarget.style.background = r.color + '44'}
                onMouseLeave={e => e.currentTarget.style.background = r.color + '22'}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>{r.label}</span>
                <span style={{ fontSize: 11, opacity: 0.8 }}>{next}</span>
              </button>
            );
          })
        )}
      </div>

      {/* Keyboard hint */}
      {showBack && (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-dim)', marginTop: 8 }}>
          اضغط 1-4 لتقييم البطاقة
        </p>
      )}
    </div>
  );
}
