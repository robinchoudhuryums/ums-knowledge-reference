import { useCallback } from 'react';

/**
 * Button that opens the chat interface in a small pop-out window.
 * The new window loads the app with ?popout=true, which renders
 * only the chat interface in a compact layout.
 */
export function PopoutButton() {
  const handlePopout = useCallback(() => {
    const width = 420;
    const height = 640;
    const left = window.screen.width - width - 40;
    const top = 60;

    window.open(
      `${window.location.origin}?popout=true`,
      'ums-chat-popout',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`
    );
  }, []);

  return (
    <button onClick={handlePopout} style={styles.button} title="Open chat in a pop-up window">
      &#8599; Pop Out
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    padding: '6px 14px',
    background: 'var(--ums-bg-surface-alt)',
    color: 'var(--ums-brand-primary)',
    border: '1px solid var(--ums-border)',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    whiteSpace: 'nowrap' as const,
    fontWeight: 500,
  },
};
