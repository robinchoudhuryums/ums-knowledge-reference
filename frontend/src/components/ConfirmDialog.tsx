import { useState, useCallback, useEffect, useRef, createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';

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
    return new Promise((resolve) => {
      setState({ open: true, options, resolve });
    });
  }, []);

  const handleClose = (result: boolean) => {
    state.resolve?.(result);
    setState((prev) => ({ ...prev, open: false, resolve: null }));
  };

  const isDanger = state.options.variant === 'danger';

  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Close on Escape + focus-trap (Tab cycles between dialog buttons only).
  useEffect(() => {
    if (!state.open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose(false);
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previousFocusRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state.open && (
        <div
          onClick={() => handleClose(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          className="fixed inset-0 z-[10000] flex items-center justify-center px-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            ref={dialogRef}
            className="w-full max-w-[420px] rounded-sm border border-border bg-card p-6 shadow-lg"
          >
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: '0.12em' }}
            >
              {isDanger ? 'Destructive action' : 'Confirm'}
            </div>
            <h3
              id="confirm-dialog-title"
              className="font-display font-medium text-foreground mt-1"
              style={{ fontSize: 18, lineHeight: 1.15, letterSpacing: '-0.2px' }}
            >
              {state.options.title}
            </h3>
            <p
              id="confirm-dialog-message"
              className="mt-2 text-sm text-muted-foreground"
            >
              {state.options.message}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
                autoFocus={isDanger}
              >
                {state.options.cancelLabel || 'Cancel'}
              </Button>
              <Button
                type="button"
                variant={isDanger ? 'destructive' : 'default'}
                onClick={() => handleClose(true)}
                autoFocus={!isDanger}
              >
                {state.options.confirmLabel || 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
