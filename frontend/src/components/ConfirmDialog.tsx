import { useState, useCallback, createContext, useContext } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue>({
  confirm: () => Promise.resolve(false),
});

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    open: boolean;
    options: ConfirmOptions;
    resolve: ((value: boolean) => void) | null;
  }>({ open: false, options: { title: '', message: '' }, resolve: null });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setState({ open: true, options, resolve });
    });
  }, []);

  const handleClose = (result: boolean) => {
    state.resolve?.(result);
    setState(prev => ({ ...prev, open: false, resolve: null }));
  };

  const isDanger = state.options.variant === 'danger';

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state.open && (
        <div style={styles.overlay} onClick={() => handleClose(false)} role="dialog" aria-modal="true">
          <div style={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3 style={styles.title}>{state.options.title}</h3>
            <p style={styles.message}>{state.options.message}</p>
            <div style={styles.actions}>
              <button onClick={() => handleClose(false)} style={styles.cancelButton}>
                {state.options.cancelLabel || 'Cancel'}
              </button>
              <button
                onClick={() => handleClose(true)}
                style={isDanger ? styles.dangerButton : styles.confirmButton}
                autoFocus
              >
                {state.options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  dialog: {
    background: 'var(--ums-bg-surface)',
    borderRadius: '14px',
    padding: '24px',
    maxWidth: '420px',
    width: '92%',
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
  },
  title: {
    margin: '0 0 8px',
    fontSize: '17px',
    fontWeight: 700,
    color: 'var(--ums-text-primary)',
  },
  message: {
    margin: '0 0 20px',
    fontSize: '14px',
    color: 'var(--ums-text-muted)',
    lineHeight: '1.5',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  cancelButton: {
    padding: '8px 18px',
    background: 'none',
    border: '1px solid var(--ums-border)',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--ums-text-muted)',
  },
  confirmButton: {
    padding: '8px 18px',
    background: 'var(--ums-brand-gradient)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    boxShadow: '0 2px 8px rgba(27, 111, 201, 0.25)',
  },
  dangerButton: {
    padding: '8px 18px',
    background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    boxShadow: '0 2px 8px rgba(220, 38, 38, 0.25)',
  },
};
