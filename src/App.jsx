import React, { useState, useEffect, createContext, useContext } from 'react';
import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import './index.css';

import Dashboard from './components/Dashboard/Dashboard';
import Decks from './components/Decks/Decks';
import Study from './components/Study/Study';
import Stats from './components/Stats/Stats';
import Settings from './components/Settings/Settings';
import { initDB } from './lib/db';

// ─── App Context ─────────────────────────────────────
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

// ─── Icons ───────────────────────────────────────────
const Icon = ({ name, size = 18 }) => {
  const icons = {
    home: <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,
    layers: <><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></>,
    brain: <path d="M9.5 2A5.5 5.5 0 0 1 14 7.5V8h-1.5A1.5 1.5 0 0 0 11 9.5v.5H9V9.5A1.5 1.5 0 0 0 7.5 8H6v-.5A5.5 5.5 0 0 1 9.5 2zm0 0A5.5 5.5 0 0 0 4 7.5V8h1.5A1.5 1.5 0 0 1 7 9.5V10h2V9.5A1.5 1.5 0 0 1 10.5 8H12v-.5A5.5 5.5 0 0 0 9.5 2zM6 12h12v2a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6v-2h4z"/>,
    chart: <><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>,
    menu: <><path d="M3 12h18M3 6h18M3 18h18"/></>,
    x: <><path d="M18 6L6 18M6 6l12 12"/></>,
  };
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      {icons[name]}
    </svg>
  );
};

// ─── Sidebar ─────────────────────────────────────────
const navItems = [
  { path: '/',        label: 'Dashboard',   icon: 'home'     },
  { path: '/decks',   label: 'الحزم',        icon: 'layers'   },
  { path: '/study',   label: 'الدراسة',      icon: 'brain'    },
  { path: '/stats',   label: 'الإحصاءات',    icon: 'chart'    },
  { path: '/settings',label: 'الإعدادات',    icon: 'settings' },
];

function Sidebar({ open, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <>
      {open && <div className="modal-overlay" style={{ zIndex: 49, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />}
      <nav className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <img src="./_IntuMedix_logo.png" alt="IntuMedix" onError={e => e.target.style.display='none'} />
          <span className="sidebar-logo-text">IntuMedix</span>
        </div>

        <div className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => { navigate(item.path); onClose(); }}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </div>

        <div className="sidebar-footer" style={{ fontSize: 12, color: 'var(--color-text-dim)', textAlign: 'center' }}>
          IntuMedix App v1.0<br/>
          <span style={{ color: 'var(--color-primary-h)' }}>mti.med • 2025</span>
        </div>
      </nav>
    </>
  );
}

// ─── Top Bar ─────────────────────────────────────────
function TopBar({ onMenuClick }) {
  const location = useLocation();
  const title = navItems.find(n => n.path === location.pathname)?.label || 'IntuMedix';

  return (
    <header className="topbar">
      <button className="btn btn-ghost btn-icon" onClick={onMenuClick} style={{ display: 'none' }} id="menu-btn">
        <Icon name="menu" />
      </button>
      <h1 className="topbar-title">{title}</h1>
    </header>
  );
}

// ─── Main App ─────────────────────────────────────────
function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { dbReady } = useApp();

  useEffect(() => {
    // Show menu button on mobile
    const updateMenuBtn = () => {
      const btn = document.getElementById('menu-btn');
      if (btn) btn.style.display = window.innerWidth < 768 ? 'flex' : 'none';
    };
    updateMenuBtn();
    window.addEventListener('resize', updateMenuBtn);
    return () => window.removeEventListener('resize', updateMenuBtn);
  }, []);

  if (!dbReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 20 }}>
        <div className="loading-spinner" />
        <p style={{ color: 'var(--color-text-sec)' }}>جاري تحميل IntuMedix...</p>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="main-content">
        <TopBar onMenuClick={() => setSidebarOpen(o => !o)} />
        <AnimatePresence mode="wait">
          <Routes>
            <Route path="/"         element={<PageWrapper><Dashboard /></PageWrapper>} />
            <Route path="/decks"    element={<PageWrapper><Decks /></PageWrapper>} />
            <Route path="/study"    element={<Study />} />
            <Route path="/study/:deckId" element={<Study />} />
            <Route path="/stats"    element={<PageWrapper><Stats /></PageWrapper>} />
            <Route path="/settings" element={<PageWrapper><Settings /></PageWrapper>} />
          </Routes>
        </AnimatePresence>
      </div>
    </div>
  );
}

function PageWrapper({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="page-content"
    >
      {children}
    </motion.div>
  );
}

// ─── Root ─────────────────────────────────────────────
export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [studyDeckId, setStudyDeckId] = useState(null);

  useEffect(() => {
    initDB().then(() => setDbReady(true)).catch(console.error);
  }, []);

  return (
    <AppContext.Provider value={{ dbReady, studyDeckId, setStudyDeckId }}>
      <HashRouter>
        <AppLayout />
      </HashRouter>
    </AppContext.Provider>
  );
}
