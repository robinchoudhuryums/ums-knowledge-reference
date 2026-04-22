import { useEffect, useCallback, useState } from 'react';
import { Route, Switch, Redirect } from 'wouter';
import AppearanceProvider from './components/appearance-provider';
import Sidebar from './components/layout/sidebar';
import StyleGuide from './pages/StyleGuide';
import SettingsPage from './pages/Settings';
import AdminPage from './pages/AdminPage';
import { useAuth } from './hooks/useAuth';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { LoginForm } from './components/LoginForm';
import { ChatInterface } from './components/ChatInterface';
import { PopoutButton } from './components/PopoutButton';
import { ChangePasswordForm } from './components/ChangePasswordForm';
import { FormsTab } from './components/FormsTab';
import { ToolsTab } from './components/ToolsTab';
import { DocumentsTab } from './components/DocumentsTab';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';
import type { Collection } from './types';
import { listCollections } from './services/api';

const isPopout = new URLSearchParams(window.location.search).get('popout') === 'true';
const isStyleGuide = new URLSearchParams(window.location.search).get('style-guide') === '1';

function IdleWarningBanner({ remainingSeconds }: { remainingSeconds: number }) {
  const label =
    remainingSeconds > 60
      ? `${Math.ceil(remainingSeconds / 60)} minute${Math.ceil(remainingSeconds / 60) !== 1 ? 's' : ''}`
      : `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
  return (
    <div
      role="alert"
      className="flex-shrink-0 border-b border-border px-6 py-2 text-center text-sm font-medium"
      style={{ background: 'var(--amber-soft)', color: 'var(--foreground)' }}
    >
      Session expiring in {label} due to inactivity. Move your mouse or press a key to stay logged in.
    </div>
  );
}

/** Workspace body — sidebar + routed main area. */
function Workspace({
  username,
  role,
  isAdmin,
  collections,
  onCollectionsChange,
  onLogout,
  showWarning,
  remainingSeconds,
}: {
  username: string | undefined;
  role: string | undefined;
  isAdmin: boolean;
  collections: Collection[];
  onCollectionsChange: () => void;
  onLogout: () => void;
  showWarning: boolean;
  remainingSeconds: number;
}) {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:border focus:border-border focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:text-foreground"
      >
        Skip to main content
      </a>

      {showWarning && <IdleWarningBanner remainingSeconds={remainingSeconds} />}

      {/* Full-viewport interaction blocker in the last 30 seconds of idle timeout. */}
      {showWarning && remainingSeconds <= 30 && (
        <div
          aria-hidden="true"
          className="pointer-events-auto fixed inset-0 z-[9999] cursor-not-allowed"
          style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          username={username}
          role={role}
          isAdmin={isAdmin}
          onLogout={onLogout}
        />
        <main
          id="main-content"
          className="relative min-w-0 flex-1 overflow-auto bg-background"
        >
          <div className="absolute right-4 top-3 z-10">
            <PopoutButton />
          </div>
          <ErrorBoundary fallbackMessage="This section encountered an error. Try switching pages or refreshing.">
            <Switch>
              <Route path="/chat">
                <ChatInterface collections={collections} />
              </Route>
              <Route path="/tools">
                <ToolsTab />
              </Route>
              <Route path="/forms">
                <FormsTab />
              </Route>
              <Route path="/documents">
                <DocumentsTab
                  isAdmin={isAdmin}
                  collections={collections}
                  onCollectionsChange={onCollectionsChange}
                />
              </Route>
              <Route path="/settings">
                <SettingsPage />
              </Route>
              {isAdmin && (
                <Route path="/admin">
                  <AdminPage />
                </Route>
              )}
              <Route path="/">
                <Redirect to="/chat" />
              </Route>
              <Route>
                {/* Unknown route — fall through to chat */}
                <Redirect to="/chat" />
              </Route>
            </Switch>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const {
    auth,
    login,
    logout,
    isAuthenticated,
    isAdmin,
    mustChangePassword,
    handlePasswordChanged,
    mfaRequired,
    submitMfaCode,
  } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);

  const { showWarning, remainingSeconds } = useIdleTimeout(
    () => { logout(); },
    isAuthenticated && !mustChangePassword,
  );

  const loadCollections = useCallback(async () => {
    try {
      const result = await listCollections();
      setCollections(result.collections);
    } catch {
      // Will fail if not authenticated — safe to ignore
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadCollections();
    }
  }, [isAuthenticated, loadCollections]);

  if (!isAuthenticated) {
    return (
      <ErrorBoundary fallbackMessage="Login encountered an error. Please refresh the page.">
        <LoginForm onLogin={login} mfaRequired={mfaRequired} onMfaSubmit={submitMfaCode} />
      </ErrorBoundary>
    );
  }

  if (mustChangePassword) {
    return <ChangePasswordForm onPasswordChanged={handlePasswordChanged} />;
  }

  // Pop-out mode: compact chat-only window (no sidebar).
  if (isPopout) {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header
          className="flex h-11 flex-shrink-0 items-center justify-between border-b border-border bg-card px-4"
        >
          <h1 className="font-display text-[15px] font-semibold text-foreground">UMS Chat</h1>
          <span className="font-mono text-[11px] text-muted-foreground">
            {auth.user?.username}
          </span>
        </header>
        {showWarning && <IdleWarningBanner remainingSeconds={remainingSeconds} />}
        <main className="min-h-0 flex-1 overflow-auto">
          <ChatInterface collections={collections} />
        </main>
      </div>
    );
  }

  return (
    <Workspace
      username={auth.user?.username}
      role={auth.user?.role}
      isAdmin={isAdmin}
      collections={collections}
      onCollectionsChange={loadCollections}
      onLogout={logout}
      showWarning={showWarning}
      remainingSeconds={remainingSeconds}
    />
  );
}

export default function App() {
  if (isStyleGuide) {
    return (
      <AppearanceProvider>
        <StyleGuide />
      </AppearanceProvider>
    );
  }

  return (
    <AppearanceProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthenticatedApp />
        </ConfirmProvider>
      </ToastProvider>
    </AppearanceProvider>
  );
}
