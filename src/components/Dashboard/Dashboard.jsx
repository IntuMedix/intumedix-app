import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { getDecks, getStats, getReviewHistory } from '../../lib/db';
import { useApp } from '../../App';

export default function Dashboard() {
  const navigate = useNavigate();
  const { setStudyDeckId } = useApp();
  const [decks, setDecks] = useState([]);
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now] = useState(new Date());

  useEffect(() => {
    try {
      const d = getDecks();
      const s = getStats();
      const h = getReviewHistory(14);
      setDecks(d.slice(0, 5));
      setStats(s);
      setHistory(h);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  if (loading) return <div className="loading-spinner" style={{ marginTop: 60 }} />;

  const totalDue = decks.reduce((s, d) => s + (d.due_cards || 0), 0);
  const totalNew = decks.reduce((s, d) => s + (d.new_cards || 0), 0);

  const greeting = now.getHours() < 12 ? 'صباح الخير' : now.getHours() < 17 ? 'مساء النور' : 'مساء الخير';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h2 className="section-title" style={{ marginBottom: 4 }}>
          {greeting}، طالب مجتهد 👋
        </h2>
        <p className="section-sub" style={{ marginTop: 0 }}>
          {new Date().toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Metric Cards */}
      <div className="metric-grid" style={{ marginBottom: 28 }}>
        <MetricCard icon="🔴" color="#ef4444" value={totalDue} label="متبقية للمراجعة" />
        <MetricCard icon="🆕" color="#6366f1" value={totalNew} label="بطاقات جديدة" />
        <MetricCard icon="✅" color="#10b981" value={stats?.today?.reviewed || 0} label="راجعتها اليوم" />
        <MetricCard icon="🔥" color="#f59e0b" value={`${Math.round(stats?.today?.retention || 0)}%`} label="معدل الإجابة" />
        <MetricCard icon="📚" color="#0ea5e9" value={stats?.totals?.total_cards || 0} label="مجموع البطاقات" />
        <MetricCard icon="📅" color="#8b5cf6" value={stats?.streak || 0} label="أيام مستمرة" />
      </div>

      {/* Study CTA */}
      {totalDue > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(14,165,233,0.1))',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: 'var(--radius-xl)',
          padding: '24px 28px',
          marginBottom: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              🎯 لديك {totalDue} بطاقة للمراجعة اليوم
            </div>
            <div style={{ color: 'var(--color-text-sec)', fontSize: 14 }}>
              واصل المراجعة المنتظمة لأفضل نتائج
            </div>
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/study')}>
            ابدأ المراجعة ←
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, flexWrap: 'wrap' }}>
        {/* Review Chart */}
        <div className="card" style={{ gridColumn: history.length > 0 ? '1' : '1 / -1' }}>
          <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 15 }}>📈 المراجعات (14 يوم)</div>
          {history.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, color: '#f1f5f9' }} />
                <Area type="monotone" dataKey="count" stroke="#6366f1" fill="url(#grad1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: 'var(--color-text-dim)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              لا توجد مراجعات بعد — ابدأ الدراسة!
            </div>
          )}
        </div>

        {/* Recent Decks */}
        {decks.length > 0 && (
          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              📦 الحزم الأخيرة
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/decks')}>عرض الكل</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {decks.map(deck => (
                <div key={deck.id}
                  onClick={() => { setStudyDeckId(deck.id); navigate(`/study/${deck.id}`); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface2)', cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.12)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--color-surface2)'}
                >
                  <span style={{ fontSize: 20 }}>📚</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deck.name}</span>
                  {deck.due_cards > 0 && <span className="badge badge-danger">{deck.due_cards}</span>}
                  {deck.new_cards > 0 && <span className="badge badge-primary">{deck.new_cards}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Empty state */}
      {decks.length === 0 && (
        <div className="empty-state" style={{ marginTop: 20 }}>
          <div className="empty-icon">📦</div>
          <div className="empty-title">لا توجد حزم بعد</div>
          <div className="empty-desc">ابدأ باستيراد ملف .apkg من أنكي أو أنشئ حزمة جديدة</div>
          <button className="btn btn-primary" onClick={() => navigate('/decks')}>
            إضافة حزمة
          </button>
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, color, value, label }) {
  return (
    <div className="metric-card">
      <div className="metric-icon" style={{ background: `${color}20`, color }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div className="metric-value" style={{ color }}>{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
