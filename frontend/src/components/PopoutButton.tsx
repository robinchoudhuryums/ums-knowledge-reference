import { useCallback } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';

/**
 * Button that opens the chat interface in a small pop-out window.
 * The new window loads the app with ?popout=true, which renders only
 * the chat interface in a compact layout.
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
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`,
    );
  }, []);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handlePopout}
      aria-label="Open chat in pop-out window"
      title="Open chat in a pop-up window"
      className="gap-1.5"
    >
      <ArrowTopRightOnSquareIcon className="h-4 w-4" />
      <span>Pop out</span>
    </Button>
  );
}
