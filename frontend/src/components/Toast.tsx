import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XMarkIcon,
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
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-[9999] flex max-w-[400px] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <ToastItemView key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Warm-paper toast visuals — left accent stripe in the tone color, hairline
 * border, muted-ink message copy. The tone colors resolve through the
 * palette-aware --sage / --amber / --warm-red tokens so the user's chosen
 * palette still flows through.
 */
const TONE_CONFIG: Record<
  ToastType,
  {
    Icon: React.ComponentType<{ className?: string }>;
    accentVar: string;
  }
> = {
  success: { Icon: CheckCircleIcon, accentVar: '--sage' },
  error: { Icon: XCircleIcon, accentVar: '--warm-red' },
  warning: { Icon: ExclamationTriangleIcon, accentVar: '--amber' },
  info: { Icon: InformationCircleIcon, accentVar: '--accent' },
};

function ToastItemView({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setExiting(true), toast.duration - 300);
    const removeTimer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, toast.duration, onDismiss]);

  const { Icon, accentVar } = TONE_CONFIG[toast.type];

  return (
    <div
      role="alert"
      className="pointer-events-auto flex min-w-[280px] items-center gap-2.5 rounded-sm border border-border bg-card py-3 pl-4 pr-3 shadow-sm transition-[opacity,transform] duration-300"
      style={{
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateX(20px)' : 'translateX(0)',
        boxShadow: `inset 2px 0 0 var(${accentVar}), 0 2px 6px rgba(0,0,0,0.06)`,
      }}
    >
      <span className="shrink-0" style={{ color: `var(${accentVar})` }}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex-1 text-[13px] leading-snug text-foreground">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss notification"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
