import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './hooks/useAuth';
import { LoginForm } from './components/LoginForm';
import { ChatInterface } from './components/ChatInterface';
import { DocumentManager } from './components/DocumentManager';
import { DocumentSearch } from './components/DocumentSearch';
import { PopoutButton } from './components/PopoutButton';
import { OcrTool } from './components/OcrTool';
import { QueryLogViewer } from './components/QueryLogViewer';
import { FaqDashboard } from './components/FaqDashboard';
import { Collection } from './types';
import { listCollections } from './services/api';

type Tab = 'chat' | 'search' | 'documents' | 'ocr' | 'admin';

const isPopout = new URLSearchParams(window.location.search).get('popout') === 'true';

const tabIcons: Record<Tab, string> = {
  chat: '\u2728',
  search: '\uD83D\uDD0D',
  ocr: '\uD83D\uDCF7',
  documents: '\uD83D\uDCC1',
  admin: '\u2699\uFE0F',
};

export default function App() {
  const { auth, login, logout, isAuthenticated, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [collections, setCollections] = useState<Collection[]>([]);

  const loadCollections = useCallback(async () => {
    try {
      const result = await listCollections();
      setCollections(result.collections);
    } catch {
      // Will fail if not authenticated
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadCollections();
    }
  }, [isAuthenticated, loadCollections]);

  if (!isAuthenticated) {
    return <LoginForm onLogin={login} />;
  }

  // Pop-out mode: compact chat-only window
  if (isPopout) {
    return (
      <div style={styles.app}>
        <header style={styles.popoutHeader}>
          <h1 style={styles.popoutLogo}>UMS Chat</h1>
          <div style={styles.headerRight}>
            <span style={styles.user}>{auth.user?.username}</span>
          </div>
        </header>
        <main style={styles.main}>
          <ChatInterface collections={collections} />
        </main>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; adminOnly?: boolean }[] = [
    { key: 'chat', label: 'Ask Questions' },
    { key: 'search', label: 'Search' },
    { key: 'ocr', label: 'OCR Scan' },
    { key: 'documents', label: 'Documents' },
    { key: 'admin', label: 'Admin', adminOnly: true },
  ];

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoGroup}>
            <div style={styles.logoMark}>KB</div>
            <h1 style={styles.logo}>UMS Knowledge Base</h1>
          </div>
          <nav style={styles.nav}>
            {tabs
              .filter(t => !t.adminOnly || isAdmin)
              .map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={activeTab === t.key ? styles.tabActive : styles.tab}
                >
                  <span style={styles.tabIcon}>{tabIcons[t.key]}</span>
                  {t.label}
                </button>
              ))}
          </nav>
        </div>
        <div style={styles.headerRight}>
          <PopoutButton />
          <div style={styles.userBadge}>
            <div style={styles.avatar}>{auth.user?.username?.charAt(0).toUpperCase()}</div>
            <span style={styles.user}>{auth.user?.username}</span>
            <span style={styles.roleBadge}>{auth.user?.role}</span>
          </div>
          <button onClick={logout} style={styles.logoutButton}>Sign Out</button>
        </div>
      </header>

      <main style={styles.main}>
        {activeTab === 'chat' && <ChatInterface collections={collections} />}
        {activeTab === 'search' && <DocumentSearch collections={collections} />}
        {activeTab === 'ocr' && <OcrTool />}
        {activeTab === 'documents' && (
          <DocumentManager
            isAdmin={isAdmin}
            collections={collections}
            onCollectionsChange={loadCollections}
          />
        )}
        {activeTab === 'admin' && isAdmin && (
          <div style={styles.adminPanel}>
            <FaqDashboard />
            <hr style={styles.adminDivider} />
            <QueryLogViewer />
          </div>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#f8f9fb' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 24px',
    height: '60px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    color: 'white',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.15)',
    position: 'relative' as const,
    zIndex: 10,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '28px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoGroup: { display: 'flex', alignItems: 'center', gap: '10px' },
  logoMark: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  logo: { margin: 0, fontSize: '16px', fontWeight: 600, letterSpacing: '-0.2px' },
  nav: { display: 'flex', gap: '2px' },
  tab: {
    padding: '7px 14px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.15s ease',
  },
  tabActive: {
    padding: '7px 14px',
    background: 'rgba(99, 102, 241, 0.25)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    boxShadow: 'inset 0 0 0 1px rgba(99, 102, 241, 0.3)',
  },
  tabIcon: { fontSize: '14px' },
  userBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '8px',
    padding: '4px 12px 4px 4px',
  },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 600,
  },
  user: { fontSize: '13px', color: 'rgba(255,255,255,0.9)' },
  roleBadge: {
    fontSize: '10px',
    padding: '2px 6px',
    background: 'rgba(99, 102, 241, 0.3)',
    borderRadius: '4px',
    color: 'rgba(255,255,255,0.8)',
    textTransform: 'uppercase' as const,
    fontWeight: 600,
    letterSpacing: '0.5px',
  },
  logoutButton: {
    padding: '6px 14px',
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.8)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  },
  main: { flex: 1, overflow: 'hidden' },
  adminPanel: { height: '100%', overflowY: 'auto' as const, padding: '0 0 40px' },
  adminDivider: { border: 'none', borderTop: '1px solid #e2e8f0', margin: '12px 24px' },
  popoutHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 16px',
    height: '44px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    color: 'white',
  },
  popoutLogo: { margin: 0, fontSize: '15px', fontWeight: 600 },
};
