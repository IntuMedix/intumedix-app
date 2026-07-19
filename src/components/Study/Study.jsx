import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDecks, getDueCards, updateCard, logReview, getMedia } from '../../lib/db';
import { scheduleCard, getNextReview } from '../../lib/fsrs';

// ─── Templates bundled at compile time via Vite ?raw imports ──
// This avoids ALL service-worker / fetch / cache issues.
import _imFront from '../../templates/im_front.html?raw';
import _imBack  from '../../templates/im_back.html?raw';
import _imCss   from '../../templates/im_style.css?raw';

// ─── Detect IntuMedix MCQ cards ───────────────────────────────
function isIntuMedixMCQ(card) {
  const fields = card.fields || {};
  const noteTypeName = (card.note_type_name || '').toLowerCase();
  
  if (noteTypeName.includes('intumedix') || noteTypeName.includes('mcq')) {
    return true;
  }
  
  const keys = Object.keys(fields).map(k => k.toLowerCase().replace(/[\s_-]/g, ''));
  return keys.some(k => 
    k === 'questionstem' || 
    k === 'answera' || 
    k === 'correctanswer' || 
    k === 'intumedixnotes'
  );
}

// ─── Anki Template Renderer ───────────────────────────────────
function renderAnkiTemplate(template, fields, frontHtml = '') {
  if (!template) return '';
  let html = template;

  // {{FrontSide}}
  html = html.replace(/\{\{FrontSide\}\}/g, frontHtml);

  // Conditional blocks: {{#Field}}...{{/Field}}
  // Repeat a few times to handle nested blocks
  for (let pass = 0; pass < 4; pass++) {
    html = html.replace(/\{\{#([\w][\w\s]*?)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, fieldName, content) => {
      // Case-insensitive check
      const lowerName = fieldName.toLowerCase().replace(/[\s_-]/g, '');
      const foundKey = Object.keys(fields).find(k => k.toLowerCase().replace(/[\s_-]/g, '') === lowerName);
      const val = foundKey ? fields[foundKey] : null;
      return (val && String(val).trim()) ? content : '';
    });
    // Negation blocks: {{^Field}}...{{/Field}}
    html = html.replace(/\{\{\^([\w][\w\s]*?)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, fieldName, content) => {
      // Case-insensitive check
      const lowerName = fieldName.toLowerCase().replace(/[\s_-]/g, '');
      const foundKey = Object.keys(fields).find(k => k.toLowerCase().replace(/[\s_-]/g, '') === lowerName);
      const val = foundKey ? fields[foundKey] : null;
      return (!val || !String(val).trim()) ? content : '';
    });
  }

  // Cloze: {{cloze:Field}}
  html = html.replace(/\{\{cloze:([\w][\w\s]*?)\}\}/g, (_, fieldName) => {
    // Case-insensitive check
    const lowerName = fieldName.toLowerCase().replace(/[\s_-]/g, '');
    const foundKey = Object.keys(fields).find(k => k.toLowerCase().replace(/[\s_-]/g, '') === lowerName);
    const val = foundKey ? fields[foundKey] : '';
    return val.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (__, n, answer) =>
      `<span class="cloze" data-cloze="${n}">${answer}</span>`
    );
  });

  // Simple field substitution: {{FieldName}}
  html = html.replace(/\{\{([\w][\w\s]*?)\}\}/g, (match, fieldName) => {
    if (fieldName === 'Tags' || fieldName === 'Deck' || fieldName === 'CardFlag') return match;
    if (fieldName in fields) return fields[fieldName] || '';
    
    // Case-insensitive lookup fallback
    const lowerName = fieldName.toLowerCase().replace(/[\s_-]/g, '');
    const foundKey = Object.keys(fields).find(k => k.toLowerCase().replace(/[\s_-]/g, '') === lowerName);
    if (foundKey) return fields[foundKey] || '';
    
    return '';
  });

  return html;
}

// ─── Resolve media references → IndexedDB ────────────────────
async function resolveMediaInHtml(html, mediaCache) {
  if (!html) return html;
  const refs = new Set();
  const imgRegex = /src=["']([^"'<>]+)["']/g;
  const soundRegex = /\[sound:([^\]]+)\]/g;
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    const f = m[1];
    if (!f.startsWith('data:') && !f.startsWith('http') && !f.startsWith('/')) refs.add(f);
  }
  while ((m = soundRegex.exec(html)) !== null) refs.add(m[1]);

  for (const filename of refs) {
    if (!mediaCache.has(filename)) {
      const data = await getMedia(filename).catch(() => null);
      mediaCache.set(filename, data);
    }
  }

  let resolved = html;
  for (const filename of refs) {
    const uri = mediaCache.get(filename);
    if (uri) {
      const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      resolved = resolved
        .replace(new RegExp(`src=["']${escaped}["']`, 'g'), `src="${uri}"`)
        .replace(new RegExp(`\\[sound:${escaped}\\]`, 'g'),
          `<audio controls autoplay><source src="${uri}"></audio>`);
    }
  }
  return resolved;
}

// ─── Build full HTML document for iframe ─────────────────────
function buildCardDocument(bodyHtml, css, isIntuMedix = false) {
  const baseCss = isIntuMedix ? '' : `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: auto; background: #0d1117; }
    .card {
      font-family: Arial, 'Noto Sans Arabic', sans-serif;
      font-size: 20px; text-align: center; color: #e0e0e0;
      padding: 20px; min-height: 100%;
      display: flex; flex-direction: column;
      justify-content: center; align-items: center;
    }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    audio { width: 100%; margin: 8px 0; }
    hr { border: none; border-top: 1px solid rgba(255,255,255,0.2); margin: 16px 0; width: 100%; }
    .cloze { color: #60a5fa; font-weight: bold; }
    b, strong { color: #93c5fd; }
  `;

  return `<!DOCTYPE html>
<html dir="auto">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${baseCss}
${css || ''}
</style>
</head>
<body${isIntuMedix ? '' : ' class="nightMode"'}>
${isIntuMedix ? '' : '<div class="card">'}
${bodyHtml}
${isIntuMedix ? '' : '</div>'}
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

    const fields = card.fields || {};
    // Templates are always available (bundled in JS)
    const useIM = isIntuMedixMCQ(card);

    let frontDoc, backDoc;

    if (useIM) {
      // ── IntuMedix MCQ rendering ──
      const css = _imCss || '';

      // Substitute fields in front template
      const rawFront = renderAnkiTemplate(_imFront, fields, '');
      const resolvedFront = await resolveMediaInHtml(rawFront, mediaCache.current);
      frontDoc = buildCardDocument(resolvedFront, css, true);

      // Back template: {{FrontSide}} is replaced with just the question stem section
      // to avoid double header; use full back template with field substitution
      const rawBack = renderAnkiTemplate(_imBack, fields, resolvedFront);
      const resolvedBack = await resolveMediaInHtml(rawBack, mediaCache.current);
      backDoc = buildCardDocument(resolvedBack, css, true);
    } else {
      // ── Generic card rendering (Anki template from DB) ──
      const qfmt = card.template_front || `{{${Object.keys(fields)[0] || 'Front'}}}`;
      const afmt = card.template_back  || `{{FrontSide}}<hr>{{${Object.keys(fields)[1] || 'Back'}}}`;
      const css  = card.css || '';

      const rawFront = renderAnkiTemplate(qfmt, fields, '');
      const resolvedFront = await resolveMediaInHtml(rawFront, mediaCache.current);
      frontDoc = buildCardDocument(resolvedFront, css);

      const rawBack = renderAnkiTemplate(afmt, fields, resolvedFront);
      const resolvedBack = await resolveMediaInHtml(rawBack, mediaCache.current);
      backDoc = buildCardDocument(resolvedBack, css);
    }

    setFrontHtml(frontDoc);
    setBackHtml(backDoc);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space' || e.code === 'Enter') {
        if (!showBack) setShowBack(true);
        e.preventDefault();
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
    logReview(
      current.id, rating, statsBefore.state,
      statsBefore.stability, statsBefore.difficulty,
      scheduled.scheduledDays, 0
    );

    setSessionStats(prev => {
      const key = ['', 'again', 'hard', 'good', 'easy'][rating];
      return { ...prev, [key]: (prev[key] || 0) + 1 };
    });

    const newQueue = queue.slice(1);
    if (rating === 1 && newQueue.length > 0) {
      const insertAt = Math.min(3, newQueue.length);
      newQueue.splice(insertAt, 0, { ...current, state: 1 });
    }

    if (newQueue.length === 0) setDone(true);
    else { setQueue(newQueue); loadCard(newQueue[0]); }
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
            width: `${(Object.values(sessionStats).reduce((a,b) => a+b, 0) / Math.max(1, queue.length + Object.values(sessionStats).reduce((a,b) => a+b, 0))) * 100}%`,
            height: '100%', background: 'var(--color-primary)',
            borderRadius: 3, transition: 'width 0.3s ease',
          }} />
        </div>
        <span style={{ fontSize: 13, color: 'var(--color-text-sec)', whiteSpace: 'nowrap' }}>
          {queue.length} متبقية
        </span>
      </div>

      {/* Card iframe */}
      <div style={{
        flex: 1, background: 'var(--color-surface-1)',
        borderRadius: 16, border: '1px solid var(--color-border)',
        overflow: 'hidden', position: 'relative', minHeight: 320,
      }}>
        <iframe
          ref={frontFrameRef}
          srcDoc={frontHtml}
          style={{
            width: '100%', height: '100%', border: 'none',
            background: 'transparent',
            display: showBack ? 'none' : 'block', minHeight: 320,
          }}
          sandbox="allow-scripts allow-same-origin allow-modals"
          title="card-front"
        />
        {showBack && (
          <iframe
            ref={backFrameRef}
            srcDoc={backHtml}
            style={{
              width: '100%', height: '100%', border: 'none',
              background: 'transparent', minHeight: 320,
            }}
            sandbox="allow-scripts allow-same-origin allow-modals"
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

      {showBack && (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-dim)', marginTop: 8 }}>
          اضغط 1-4 لتقييم البطاقة
        </p>
      )}
    </div>
  );
}
