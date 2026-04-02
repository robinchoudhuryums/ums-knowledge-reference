import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './hooks/useAuth';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { LoginForm } from './components/LoginForm';
import { ChatInterface } from './components/ChatInterface';
import { PopoutButton } from './components/PopoutButton';
import { QueryLogViewer } from './components/QueryLogViewer';
import { FaqDashboard } from './components/FaqDashboard';
import { QualityDashboard } from './components/QualityDashboard';
import { ObservabilityDashboard } from './components/ObservabilityDashboard';
import { ChangePasswordForm } from './components/ChangePasswordForm';
import { FormsTab } from './components/FormsTab';
import { ToolsTab } from './components/ToolsTab';
import { DocumentsTab } from './components/DocumentsTab';
import { UserManagement } from './components/UserManagement';
import { ProductImageManager } from './components/ProductImageManager';
import { UsageLimitsManager } from './components/UsageLimitsManager';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';
import { Collection } from './types';
import { listCollections } from './services/api';
import {
  ChatBubbleLeftRightIcon,
  DocumentDuplicateIcon,
  WrenchScrewdriverIcon,
  FolderOpenIcon,
  Cog6ToothIcon,
  SunIcon,
  MoonIcon,
  ArrowRightStartOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { Brain } from 'lucide-react';
import clsx from 'clsx';

type Tab = 'chat' | 'tools' | 'forms' | 'documents' | 'admin';

const isPopout = new URLSearchParams(window.location.search).get('popout') === 'true';

const tabIcons: Record<Tab, React.ComponentType<{ className?: string }>> = {
  chat: ChatBubbleLeftRightIcon,
  tools: WrenchScrewdriverIcon,
  forms: DocumentDuplicateIcon,
  documents: FolderOpenIcon,
  admin: Cog6ToothIcon,
};

/** Dark mode hook — persists to localStorage, toggles .dark class on <html> */
function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('ums-dark-mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ums-dark-mode', String(dark));
  }, [dark]);

  const toggle = useCallback(() => setDark(d => !d), []);
  return [dark, toggle];
}

export default function App() {
  const { auth, login, logout, isAuthenticated, isAdmin, mustChangePassword, handlePasswordChanged, mfaRequired, submitMfaCode } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [isDark, toggleDark] = useDarkMode();

  const { showWarning, remainingSeconds } = useIdleTimeout(
    () => { logout(); },
    isAuthenticated && !mustChangePassword,
  );

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
    return <ToastProvider><ErrorBoundary fallbackMessage="Login encountered an error. Please refresh the page."><LoginForm onLogin={login} mfaRequired={mfaRequired} onMfaSubmit={submitMfaCode} /></ErrorBoundary></ToastProvider>;
  }

  if (mustChangePassword) {
    return <ToastProvider><ChangePasswordForm onPasswordChanged={handlePasswordChanged} /></ToastProvider>;
  }

  // Pop-out mode: compact chat-only window
  if (isPopout) {
    return (
      <ToastProvider>
        <div style={styles.app} className="hex-pattern">
          <header style={styles.popoutHeader}>
            <h1 style={styles.popoutLogo}>UMS Chat</h1>
            <div style={styles.headerRight}>
              <span style={styles.popoutUser}>{auth.user?.username}</span>
            </div>
          </header>
          {showWarning && (
            <div style={styles.idleWarningBanner} role="alert">
              Session expiring in {remainingSeconds > 60 ? `${Math.ceil(remainingSeconds / 60)} minute${Math.ceil(remainingSeconds / 60) !== 1 ? 's' : ''}` : `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`} due to inactivity. Move your mouse or press a key to stay logged in.
            </div>
          )}
          <main style={styles.main}>
            <ChatInterface collections={collections} />
          </main>
        </div>
      </ToastProvider>
    );
  }

  const tabs: { key: Tab; label: string; adminOnly?: boolean }[] = [
    { key: 'chat', label: 'Ask Questions' },
    { key: 'tools', label: 'Tools' },
    { key: 'forms', label: 'Forms' },
    { key: 'documents', label: 'Documents' },
    { key: 'admin', label: 'Admin', adminOnly: true },
  ];

  return (
    <ToastProvider>
    <ConfirmProvider>
    <div style={styles.app} className="hex-pattern">
      <a href="#main-content" className="skip-to-content">Skip to main content</a>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoGroup}>
            <div style={styles.logoMark}><Brain size={20} /></div>
            <h1 style={styles.logo}>UMS Knowledge Base</h1>
          </div>
          <nav style={styles.nav} role="tablist" aria-label="Main navigation"
            onKeyDown={(e) => {
              const visibleTabs = tabs.filter(t => !t.adminOnly || isAdmin);
              const currentIdx = visibleTabs.findIndex(t => t.key === activeTab);
              if (currentIdx < 0) return;
              let nextIdx: number;
              if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % visibleTabs.length;
              else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + visibleTabs.length) % visibleTabs.length;
              else if (e.key === 'Home') nextIdx = 0;
              else if (e.key === 'End') nextIdx = visibleTabs.length - 1;
              else return;
              e.preventDefault();
              setActiveTab(visibleTabs[nextIdx].key);
              // Focus the newly active tab button
              const btn = e.currentTarget.querySelector(`[data-tab="${visibleTabs[nextIdx].key}"]`) as HTMLElement;
              btn?.focus();
            }}
          >
            {tabs
              .filter(t => !t.adminOnly || isAdmin)
              .map(t => {
                const Icon = tabIcons[t.key];
                return (
                  <button
                    key={t.key}
                    data-tab={t.key}
                    role="tab"
                    aria-selected={activeTab === t.key}
                    tabIndex={activeTab === t.key ? 0 : -1}
                    onClick={() => setActiveTab(t.key)}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border-none cursor-pointer transition-all duration-200',
                      activeTab === t.key
                        ? 'font-semibold'
                        : 'bg-transparent'
                    )}
                    style={activeTab === t.key ? styles.tabActive : styles.tab}
                  >
                    <Icon className="w-4 h-4" />
                    {t.label}
                  </button>
                );
              })}
          </nav>
        </div>
        <div style={styles.headerRight}>
          <PopoutButton />
          <button
            onClick={toggleDark}
            className="p-1.5 rounded-lg border cursor-pointer transition-all duration-200 hover:scale-105"
            style={{ background: 'var(--ums-bg-surface-alt)', borderColor: 'var(--ums-border)', color: 'var(--ums-text-muted)' }}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle dark mode"
          >
            {isDark ? <SunIcon className="w-4 h-4" /> : <MoonIcon className="w-4 h-4" />}
          </button>
          <div style={styles.userBadge}>
            <div style={styles.avatar}>{auth.user?.username?.charAt(0).toUpperCase()}</div>
            <span style={styles.user}>{auth.user?.username}</span>
            <span style={styles.roleBadge}>{auth.user?.role}</span>
          </div>
          <button onClick={logout} style={styles.logoutButton} title="Sign out">
            <ArrowRightStartOnRectangleIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
            Sign Out
          </button>
        </div>
      </header>

      {showWarning && (
        <div style={styles.idleWarningBanner} role="alert">
          Session expiring in {remainingSeconds > 60 ? `${Math.ceil(remainingSeconds / 60)} minute${Math.ceil(remainingSeconds / 60) !== 1 ? 's' : ''}` : `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`} due to inactivity. Move your mouse or press a key to stay logged in.
        </div>
      )}

      {/* Full-viewport interaction blocker in the last 30 seconds of idle timeout.
          Rendered as a fixed overlay so it covers modals, tooltips, and portals
          that sit outside the <main> element. */}
      {showWarning && remainingSeconds <= 30 && (
        <div style={styles.idleBlockerOverlay} aria-hidden="true" />
      )}

      <main id="main-content" style={styles.main}>
        <ErrorBoundary fallbackMessage="This section encountered an error. Try switching tabs or refreshing.">
          {activeTab === 'chat' && <ChatInterface collections={collections} />}
          {activeTab === 'tools' && <ToolsTab />}
          {activeTab === 'forms' && <FormsTab />}
          {activeTab === 'documents' && (
            <DocumentsTab
              isAdmin={isAdmin}
              collections={collections}
              onCollectionsChange={loadCollections}
            />
          )}
          {activeTab === 'admin' && isAdmin && (
            <div style={styles.adminPanel}>
              <div style={styles.adminHeader}>
                <h2 style={styles.adminTitle}>Admin Dashboard</h2>
                <p style={styles.adminSubtitle}>Analytics, query logs, and knowledge base insights</p>
              </div>
              <div style={styles.adminGrid} className="admin-grid">
                <ErrorBoundary fallbackMessage="Observability dashboard encountered an error.">
                  <div style={styles.adminSection}>
                    <ObservabilityDashboard />
                  </div>
                </ErrorBoundary>
                <ErrorBoundary fallbackMessage="Quality dashboard encountered an error.">
                  <div style={styles.adminSection}>
                    <QualityDashboard />
                  </div>
                </ErrorBoundary>
                <ErrorBoundary fallbackMessage="FAQ dashboard encountered an error.">
                  <div style={styles.adminSection}>
                    <FaqDashboard />
                  </div>
                </ErrorBoundary>
                <ErrorBoundary fallbackMessage="Query log viewer encountered an error.">
                  <div style={styles.adminSection}>
                    <QueryLogViewer />
                  </div>
                </ErrorBoundary>
                <ErrorBoundary fallbackMessage="Usage manager encountered an error.">
                  <div style={styles.adminSection}>
                    <UsageLimitsManager />
                  </div>
                </ErrorBoundary>
                <ErrorBoundary fallbackMessage="User management encountered an error.">
                  <div style={styles.adminSection}>
                    <UserManagement />
                  </div>
                </ErrorBoundary>
                <ErrorBoundary fallbackMessage="Product image manager encountered an error.">
                  <div style={styles.adminSection}>
                    <ProductImageManager />
                  </div>
                </ErrorBoundary>
              </div>
            </div>
          )}
        </ErrorBoundary>
      </main>
    </div>
    </ConfirmProvider>
    </ToastProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--ums-bg-app)' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 24px',
    height: '62px',
    background: 'var(--ums-header-bg)',
    backdropFilter: 'var(--ums-header-blur)',
    color: 'var(--ums-text-secondary)',
    boxShadow: 'var(--ums-shadow-sm)',
    borderBottom: '1px solid var(--ums-border-light)',
    position: 'relative' as const,
    zIndex: 10,
    transition: 'background-color 0.2s ease',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '28px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoGroup: { display: 'flex', alignItems: 'center', gap: '10px' },
  logoMark: {
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    background: 'var(--ums-brand-gradient)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    fontWeight: 700,
    flexShrink: 0,
  },
  logo: { margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--ums-text-primary)', letterSpacing: '-0.3px' },
  nav: { display: 'flex', gap: '2px' },
  tab: {
    padding: '7px 14px',
    background: 'transparent',
    color: 'var(--ums-text-muted)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease',
    letterSpacing: '0.01em',
  },
  tabActive: {
    padding: '7px 14px',
    background: 'var(--ums-bg-active)',
    color: 'var(--ums-brand-text)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    boxShadow: 'inset 0 0 0 1px rgba(27, 111, 201, 0.15)',
  },
  userBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'var(--ums-bg-surface-alt)',
    borderRadius: '8px',
    padding: '4px 12px 4px 4px',
    border: '1px solid var(--ums-border)',
  },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    background: 'var(--ums-brand-gradient)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 600,
  },
  user: { fontSize: '13px', color: 'var(--ums-text-secondary)' },
  popoutUser: { fontSize: '13px', color: 'rgba(255,255,255,0.9)' },
  roleBadge: {
    fontSize: '10px',
    padding: '2px 6px',
    background: 'var(--ums-brand-light)',
    borderRadius: '4px',
    color: 'var(--ums-brand-text)',
    textTransform: 'uppercase' as const,
    fontWeight: 600,
    letterSpacing: '0.5px',
  },
  logoutButton: {
    padding: '6px 14px',
    background: 'transparent',
    color: 'var(--ums-text-muted)',
    border: '1px solid var(--ums-border)',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
  },
  main: { flex: 1, overflow: 'auto' },
  adminPanel: { height: '100%', overflowY: 'auto' as const, padding: '0 0 40px', background: 'var(--ums-bg-surface)' },
  adminHeader: { padding: '28px 28px 0' },
  adminTitle: { margin: '0 0 4px', fontSize: '24px', fontWeight: 700, color: 'var(--ums-text-primary)', letterSpacing: '-0.3px' },
  adminSubtitle: { margin: '0 0 24px', fontSize: '14px', color: 'var(--ums-text-muted)' },
  adminGrid: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  adminSection: { background: 'var(--ums-bg-surface)' },
  popoutHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 16px',
    height: '44px',
    background: 'linear-gradient(135deg, #1565C0, #1B6FC9)',
    color: 'white',
  },
  popoutLogo: { margin: 0, fontSize: '15px', fontWeight: 600 },
  idleWarningBanner: {
    padding: '10px 24px',
    background: 'var(--ums-warning)',
    color: '#000',
    borderBottom: '1px solid var(--ums-border)',
    fontSize: '14px',
    fontWeight: 500,
    textAlign: 'center' as const,
    zIndex: 20,
    flexShrink: 0,
  },
  // Full-viewport overlay that blocks ALL interactions in the last 30 seconds
  // of idle timeout. Uses position:fixed and z-index:9999 to sit above everything
  // including modals, tooltips, and React portals.
  idleBlockerOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    zIndex: 9999,
    cursor: 'not-allowed',
  },
};
