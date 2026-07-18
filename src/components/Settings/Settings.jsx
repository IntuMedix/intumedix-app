import React, { useState, useEffect } from 'react';
import { getSetting, setSetting } from '../../lib/db';

export default function Settings() {
  const [settings, setSettings] = useState({
    newPerDay: '20',
    dailyLimit: '100',
    theme: 'dark',
    language: 'ar',
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      setSettings({
        newPerDay: getSetting('new_per_day', '20'),
        dailyLimit: getSetting('daily_limit', '100'),
        theme: getSetting('theme', 'dark'),
        language: getSetting('language', 'ar'),
      });
    } catch (e) {}
  }, []);

  const save = () => {
    setSetting('new_per_day', settings.newPerDay);
    setSetting('daily_limit', settings.dailyLimit);
    setSetting('theme', settings.theme);
    setSetting('language', settings.language);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const exportAllData = () => {
    const data = localStorage.getItem('intumedix_db');
    if (!data) return alert('لا توجد بيانات');
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `intumedix_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (confirm('سيتم استبدال جميع البيانات الحالية. هل تريد المتابعة؟')) {
        localStorage.setItem('intumedix_db', ev.target.result);
        window.location.reload();
      }
    };
    reader.readAsText(file);
  };

  const clearAllData = () => {
    if (confirm('تحذير: سيتم حذف جميع البيانات نهائياً! هل أنت متأكد؟')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <div>
      <h2 className="section-title">⚙️ الإعدادات</h2>

      {/* Study Settings */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 20 }}>📚 إعدادات الدراسة</div>
        <SettingRow label="بطاقات جديدة يومياً" desc="الحد الأقصى من البطاقات الجديدة في اليوم">
          <input className="input" style={{ width: 80, textAlign: 'center' }}
            type="number" min="1" max="999"
            value={settings.newPerDay}
            onChange={e => setSettings(s => ({ ...s, newPerDay: e.target.value }))} />
        </SettingRow>
        <SettingRow label="الحد اليومي للمراجعات" desc="أقصى عدد للمراجعات في اليوم">
          <input className="input" style={{ width: 80, textAlign: 'center' }}
            type="number" min="1" max="9999"
            value={settings.dailyLimit}
            onChange={e => setSettings(s => ({ ...s, dailyLimit: e.target.value }))} />
        </SettingRow>
        <SettingRow label="اللغة الافتراضية" desc="">
          <select className="input" style={{ width: 120 }}
            value={settings.language}
            onChange={e => setSettings(s => ({ ...s, language: e.target.value }))}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </SettingRow>
      </div>

      {/* About */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>ℹ️ عن التطبيق</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, color: 'var(--color-text-sec)' }}>
          <div>الإصدار: <span style={{ color: 'var(--color-primary-h)' }}>v1.0.0</span></div>
          <div>الخوارزمية: <span style={{ color: 'var(--color-primary-h)' }}>FSRS v5</span></div>
          <div>القوالب: <span style={{ color: 'var(--color-primary-h)' }}>IntuMedix Templates</span></div>
          <div>التوافق: <span style={{ color: 'var(--color-primary-h)' }}>Anki .apkg</span></div>
          <div style={{ marginTop: 8, padding: '12px', background: 'var(--color-surface2)', borderRadius: 'var(--radius-md)' }}>
            🔗 <a href="https://t.me/IntuMedix" target="_blank" rel="noreferrer"
              style={{ color: 'var(--color-cyan)', fontWeight: 600 }}>قناة IntuMedix على تيليجرام</a>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>💾 البيانات والنسخ الاحتياطي</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>تصدير النسخة الاحتياطية</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>حفظ كامل بيانات التطبيق كملف JSON</div>
            </div>
            <button className="btn btn-cyan btn-sm" onClick={exportAllData}>⬇️ تصدير</button>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border2)' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>استيراد نسخة احتياطية</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>استعادة بيانات محفوظة مسبقاً</div>
            </div>
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
              ⬆️ استيراد
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={importData} />
            </label>
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border2)' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4, color: 'var(--color-danger)' }}>حذف جميع البيانات</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-sec)' }}>لا يمكن التراجع عن هذا الإجراء</div>
            </div>
            <button className="btn btn-danger btn-sm" onClick={clearAllData}>🗑️ حذف الكل</button>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button className={`btn ${saved ? 'btn-success' : 'btn-primary'} btn-lg btn-block`} onClick={save}>
        {saved ? '✅ تم الحفظ!' : '💾 حفظ الإعدادات'}
      </button>
    </div>
  );
}

function SettingRow({ label, desc, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-border2)', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--color-text-sec)', marginTop: 2 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}
