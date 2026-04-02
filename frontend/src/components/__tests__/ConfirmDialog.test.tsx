import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from '../ConfirmDialog';

// Helper component that triggers the confirm dialog
function ConfirmTrigger({ variant }: { variant?: 'danger' | 'default' }) {
  const { confirm } = useConfirm();

  const handleClick = async () => {
    await confirm({
      title: 'Delete Item?',
      message: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      variant,
    });
  };

  return <button onClick={handleClick}>Open Dialog</button>;
}

describe('ConfirmDialog', () => {
  it('renders dialog with title and message', async () => {
    render(
      <ConfirmProvider>
        <ConfirmTrigger />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByText('Open Dialog'));

    expect(await screen.findByText('Delete Item?')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
  });

  it('has correct ARIA attributes', async () => {
    render(
      <ConfirmProvider>
        <ConfirmTrigger />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByText('Open Dialog'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'confirm-dialog-message');

    // Title and message have matching IDs
    expect(screen.getByText('Delete Item?')).toHaveAttribute('id', 'confirm-dialog-title');
    expect(screen.getByText('This action cannot be undone.')).toHaveAttribute('id', 'confirm-dialog-message');
  });

  it('renders custom button labels', async () => {
    render(
      <ConfirmProvider>
        <ConfirmTrigger />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByText('Open Dialog'));

    expect(await screen.findByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Keep')).toBeInTheDocument();
  });

  it('closes on Escape key', async () => {
    render(
      <ConfirmProvider>
        <ConfirmTrigger />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByText('Open Dialog'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes on Cancel button click', async () => {
    render(
      <ConfirmProvider>
        <ConfirmTrigger />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByText('Open Dialog'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Keep'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes on Confirm button click', async () => {
    render(
      <ConfirmProvider>
        <ConfirmTrigger />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByText('Open Dialog'));
    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
