import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './hooks/useAuth';
import { LoginForm } from './components/LoginForm';
import { ChatInterface } from './components/ChatInterface';
import { DocumentManager } from './components/DocumentManager';
import { DocumentSearch } from './components/DocumentSearch';
import { PopoutButton } from './components/PopoutButton';
import { OcrTool } from './components/OcrTool';
import { QueryLogViewer } from './components/QueryLogViewer';
import { Collection } from './types';
import { listCollections } from './services/api';

type Tab = 'chat' | 'search' | 'documents' | 'ocr' | 'admin';

const isPopout = new URLSearchParams(window.location.search).get('popout') === 'true';

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
          <h1 style={styles.logo}>UMS Knowledge Base</h1>
          <nav style={styles.nav}>
            {tabs
              .filter(t => !t.adminOnly || isAdmin)
              .map(t => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={activeTab === t.key ? styles.tabActive : styles.tab}
                >
                  {t.label}
                </button>
              ))}
          </nav>
        </div>
        <div style={styles.headerRight}>
          <PopoutButton />
          <span style={styles.user}>{auth.user?.username} ({auth.user?.role})</span>
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
        {activeTab === 'admin' && isAdmin && <QueryLogViewer />}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#fff' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 20px',
    height: '56px',
    borderBottom: '1px solid #eee',
    backgroundColor: '#1a1a2e',
    color: 'white',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '24px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  logo: { margin: 0, fontSize: '18px', fontWeight: 600 },
  nav: { display: 'flex', gap: '4px' },
  tab: {
    padding: '8px 16px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  tabActive: {
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.15)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
  },
  user: { fontSize: '13px', color: 'rgba(255,255,255,0.8)' },
  logoutButton: {
    padding: '6px 12px',
    background: 'rgba(255,255,255,0.1)',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  main: { flex: 1, overflow: 'hidden' },
  popoutHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 16px',
    height: '44px',
    borderBottom: '1px solid #eee',
    backgroundColor: '#1a1a2e',
    color: 'white',
  },
  popoutLogo: { margin: 0, fontSize: '15px', fontWeight: 600 },
};
