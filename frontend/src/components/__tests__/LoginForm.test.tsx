import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '../LoginForm';

// Mock the API service
vi.mock('../../services/api', () => ({
  forgotPassword: vi.fn().mockResolvedValue({ message: 'Check your email' }),
  resetPasswordWithCode: vi.fn().mockResolvedValue({ message: 'Password reset' }),
}));

describe('LoginForm', () => {
  const mockOnLogin = vi.fn().mockResolvedValue(undefined);

  it('renders username and password fields', () => {
    render(<LoginForm onLogin={mockOnLogin} />);
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('shows validation errors on blur when fields are empty', async () => {
    render(<LoginForm onLogin={mockOnLogin} />);
    const usernameInput = screen.getByLabelText('Username');
    const passwordInput = screen.getByLabelText('Password');

    fireEvent.blur(usernameInput);
    fireEvent.blur(passwordInput);

    expect(await screen.findByText('Username is required')).toBeInTheDocument();
    expect(await screen.findByText('Password is required')).toBeInTheDocument();
  });

  it('sets aria-invalid on empty fields after blur', async () => {
    render(<LoginForm onLogin={mockOnLogin} />);
    const usernameInput = screen.getByLabelText('Username');

    fireEvent.blur(usernameInput);

    await waitFor(() => {
      expect(usernameInput).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('calls onLogin with username and password on submit', async () => {
    render(<LoginForm onLogin={mockOnLogin} />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret1234!' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);

    await waitFor(() => {
      expect(mockOnLogin).toHaveBeenCalledWith('admin', 'Secret1234!');
    });
  });

  it('shows error message on login failure', async () => {
    const failingLogin = vi.fn().mockRejectedValue(new Error('Invalid credentials'));
    const user = userEvent.setup();
    render(<LoginForm onLogin={failingLogin} />);

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/Invalid credentials/)).toBeInTheDocument();
  });

  it('disables submit button while loading', async () => {
    // Make login hang indefinitely
    const slowLogin = vi.fn((): Promise<void> => new Promise(() => {}));
    const user = userEvent.setup();
    render(<LoginForm onLogin={slowLogin} />);

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Verifying…')).toBeInTheDocument();
      expect(screen.getByText('Verifying…').closest('button')).toBeDisabled();
    });
  });

  it('shows MFA code input when mfaRequired is true', () => {
    render(<LoginForm onLogin={mockOnLogin} mfaRequired />);
    expect(screen.getByPlaceholderText('6-digit code')).toBeInTheDocument();
  });
});
