import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div style={styles.container} aria-live="polite">
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setExiting(true), toast.duration - 300);
    const removeTimer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, [toast.id, toast.duration, onDismiss]);

  const colors = typeColors[toast.type];

  return (
    <div
      style={{
        ...styles.toast,
        background: colors.bg,
        borderColor: colors.border,
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateX(20px)' : 'translateX(0)',
      }}
      role="alert"
    >
      <span style={{ ...styles.icon, color: colors.icon }}>{<colors.Icon className="w-5 h-5" />}</span>
      <span style={{ ...styles.message, color: colors.text }}>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{ ...styles.close, color: colors.text }}
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  );
}

const typeColors: Record<ToastType, { bg: string; border: string; icon: string; text: string; Icon: React.ComponentType<{ className?: string }> }> = {
  success: { bg: 'var(--ums-success-light)', border: 'var(--ums-success-border)', icon: 'var(--ums-success)', text: 'var(--ums-success-text)', Icon: CheckCircleIcon },
  error:   { bg: 'var(--ums-error-light)', border: 'var(--ums-error-border)', icon: 'var(--ums-error)', text: 'var(--ums-error-text)', Icon: XCircleIcon },
  warning: { bg: 'var(--ums-warning-light)', border: 'var(--ums-warning-border)', icon: 'var(--ums-warning)', text: 'var(--ums-warning-text)', Icon: ExclamationTriangleIcon },
  info:    { bg: 'var(--ums-info-light)', border: 'var(--ums-info-border)', icon: 'var(--ums-info)', text: 'var(--ums-info-text)', Icon: InformationCircleIcon },
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxWidth: '400px',
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 14px',
    borderRadius: '10px',
    border: '1px solid',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    pointerEvents: 'auto',
    minWidth: '280px',
  },
  icon: { fontSize: '16px', fontWeight: 700, flexShrink: 0 },
  message: { flex: 1, fontSize: '13px', fontWeight: 500, lineHeight: '1.4' },
  close: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: 1,
    opacity: 0.6,
    padding: '0 2px',
    flexShrink: 0,
  },
};
