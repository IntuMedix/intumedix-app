import React, { useState, useEffect } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getStats, getReviewHistory, getDecks } from '../../lib/db';

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [decks, setDecks] = useState([]);
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      setStats(getStats());
      setHistory(getReviewHistory(period));
      setDecks(getDecks());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [period]);

  if (loading) return <div className="loading-spinner" style={{ marginTop: 60 }} />;

  const chartColors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div>
      <h2 className="section-title">📊 الإحصاءات</h2>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[7, 14, 30, 90].map(d => (
          <button key={d} className={`btn btn-sm ${period === d ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setPeriod(d)}>
            {d} يوم
          </button>
        ))}
      </div>

      {/* Summary metrics */}
      <div className="metric-grid" style={{ marginBottom: 28 }}>
        <StatCard icon="📚" color="#6366f1" value={stats?.totals?.total_cards || 0} label="مجموع البطاقات" />
        <StatCard icon="🔁" color="#0ea5e9" value={stats?.totals?.review_cards || 0} label="قيد المراجعة" />
        <StatCard icon="🆕" color="#10b981" value={stats?.totals?.new_cards || 0} label="بطاقات جديدة" />
        <StatCard icon="✅" color="#f59e0b" value={`${Math.round(stats?.today?.retention || 0)}%`} label="الاحتفاظ اليوم" />
      </div>

      {/* Review History Chart */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>📈 المراجعات اليومية</div>
        {history.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={history}>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} width={30} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8 }} />
              <Area type="monotone" dataKey="count" stroke="#6366f1" fill="url(#g1)" strokeWidth={2} name="مراجعات" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-state" style={{ padding: '20px 0' }}>
            <div style={{ fontSize: 40 }}>📊</div>
            <div className="empty-desc">لا توجد بيانات بعد — ابدأ المراجعة!</div>
          </div>
        )}
      </div>

      {/* Retention Chart */}
      {history.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>🎯 معدل الإجابة الصحيحة</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={history}>
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} width={35} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8 }} formatter={v => [`${Math.round(v)}%`, 'الاحتفاظ']} />
              <Bar dataKey="retention" radius={[4, 4, 0, 0]} name="معدل الإجابة">
                {history.map((entry, i) => (
                  <Cell key={i} fill={entry.retention >= 80 ? '#10b981' : entry.retention >= 60 ? '#f59e0b' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Decks breakdown */}
      {decks.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>📦 الحزم</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {decks.map((deck, i) => {
              const total = deck.total_cards || 0;
              const due = deck.due_cards || 0;
              const pct = total > 0 ? Math.round((due / total) * 100) : 0;
              return (
                <div key={deck.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                    <span style={{ fontWeight: 500 }}>{deck.name}</span>
                    <span style={{ color: 'var(--color-text-sec)' }}>{due} / {total}</span>
                  </div>
                  <div className="progress-bar-outer">
                    <div className="progress-bar-inner" style={{ width: `${pct}%`, background: chartColors[i % chartColors.length] }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, color, value, label }) {
  return (
    <div className="metric-card">
      <div className="metric-icon" style={{ background: `${color}20`, color }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div className="metric-value" style={{ color, fontSize: 26 }}>{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
