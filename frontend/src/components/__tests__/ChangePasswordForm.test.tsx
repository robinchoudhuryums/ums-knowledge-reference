import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChangePasswordForm } from '../ChangePasswordForm';

vi.mock('../../services/api', () => ({
  changePassword: vi.fn(),
}));

describe('ChangePasswordForm', () => {
  const mockOnPasswordChanged = vi.fn();

  it('renders all three password fields', () => {
    render(<ChangePasswordForm onPasswordChanged={mockOnPasswordChanged} />);
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
  });

  it('shows validation errors on blur when fields are empty', () => {
    render(<ChangePasswordForm onPasswordChanged={mockOnPasswordChanged} />);
    fireEvent.blur(screen.getByLabelText('Current password'));
    expect(screen.getByText('Current password is required')).toBeInTheDocument();
  });

  it('sets aria-invalid on empty current password after blur', () => {
    render(<ChangePasswordForm onPasswordChanged={mockOnPasswordChanged} />);
    const input = screen.getByLabelText('Current password');
    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows password requirements when new password field is touched', () => {
    render(<ChangePasswordForm onPasswordChanged={mockOnPasswordChanged} />);
    const newPwdInput = screen.getByLabelText('New password');
    fireEvent.blur(newPwdInput);

    // Requirements list renders inside the aria-live region
    const reqList = document.getElementById('chpwd-new-requirements');
    expect(reqList).toBeInTheDocument();
    expect(reqList!.textContent).toContain('At least 8 characters');
    expect(reqList!.textContent).toContain('At least one uppercase letter');
    expect(reqList!.textContent).toContain('At least one lowercase letter');
    expect(reqList!.textContent).toContain('At least one number');
  });

  it('shows password mismatch error on submit', async () => {
    render(<ChangePasswordForm onPasswordChanged={mockOnPasswordChanged} />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass1!' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Different1!' } });
    fireEvent.submit(screen.getByLabelText('Current password').closest('form')!);

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  });

  it('shows minimum length error on submit', async () => {
    render(<ChangePasswordForm onPasswordChanged={mockOnPasswordChanged} />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Old' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Short' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Short' } });
    fireEvent.submit(screen.getByLabelText('Current password').closest('form')!);

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
  });

  it('calls changePassword API and onPasswordChanged on success', async () => {
    const { changePassword } = await import('../../services/api');
    vi.mocked(changePassword).mockResolvedValue({
      token: 'new-token',
      user: { id: 'u1', username: 'admin', role: 'admin' as const },
    });

    render(<ChangePasswordForm onPasswordChanged={mockOnPasswordChanged} />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass1!' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass1!' } });
    fireEvent.submit(screen.getByLabelText('Current password').closest('form')!);

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith('OldPass1!', 'NewPass1!');
      expect(mockOnPasswordChanged).toHaveBeenCalledWith('new-token', { id: 'u1', username: 'admin', role: 'admin' });
    });
  });

  it('password requirements list has aria-live for screen readers', () => {
    render(<ChangePasswordForm onPasswordChanged={mockOnPasswordChanged} />);
    fireEvent.blur(screen.getByLabelText('New password'));

    const reqList = document.getElementById('chpwd-new-requirements');
    expect(reqList).toHaveAttribute('aria-live', 'polite');
  });
});
