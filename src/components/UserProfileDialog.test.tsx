import {render, screen, fireEvent} from '@testing-library/react';
import {BrowserRouter} from 'react-router-dom';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {UserProfileDialog} from './UserProfileDialog';
import {useAuth} from '../stores/authStore';
import {useAppPermissions} from '../hooks/useAppPermissions';
import {useDebugMode} from '../hooks/useDebugMode';

vi.mock('../stores/authStore', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../hooks/useAppPermissions', () => ({
  useAppPermissions: vi.fn(),
}));

vi.mock('../hooks/useDebugMode', () => ({
  useDebugMode: vi.fn(),
}));

describe('UserProfileDialog', () => {
  const mockToggleDebugMode = vi.fn();
  const mockClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as unknown as import('vitest').Mock).mockReturnValue({
      user: {uid: 'u1', email: 'admin@example.com', displayName: 'Admin User'},
      logOut: vi.fn(),
    });
  });

  it('renders Debug Console HUD toggle when user is an administrator', () => {
    (useAppPermissions as unknown as import('vitest').Mock).mockReturnValue({
      isAdmin: true,
      isAppAllowed: true,
    });
    (useDebugMode as unknown as import('vitest').Mock).mockReturnValue({
      isDebugMode: false,
      toggleDebugMode: mockToggleDebugMode,
    });

    render(
      <BrowserRouter>
        <UserProfileDialog isOpen={true} onClose={mockClose} />
      </BrowserRouter>,
    );

    expect(screen.getByText('Developer Options')).toBeInTheDocument();
    expect(screen.getByText('Debug Console HUD')).toBeInTheDocument();
    const toggleBtn = screen.getByRole('button', {name: /enable/i});
    expect(toggleBtn).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(mockToggleDebugMode).toHaveBeenCalledTimes(1);
  });

  it('hides Developer Options when user is not an administrator and debug mode is off', () => {
    (useAppPermissions as unknown as import('vitest').Mock).mockReturnValue({
      isAdmin: false,
      isAppAllowed: true,
    });
    (useDebugMode as unknown as import('vitest').Mock).mockReturnValue({
      isDebugMode: false,
      toggleDebugMode: mockToggleDebugMode,
    });

    render(
      <BrowserRouter>
        <UserProfileDialog isOpen={true} onClose={mockClose} />
      </BrowserRouter>,
    );

    expect(screen.queryByText('Developer Options')).not.toBeInTheDocument();
    expect(screen.queryByText('Debug Console HUD')).not.toBeInTheDocument();
  });

  it('shows Developer Options with active status when debug mode is enabled', () => {
    (useAppPermissions as unknown as import('vitest').Mock).mockReturnValue({
      isAdmin: true,
      isAppAllowed: true,
    });
    (useDebugMode as unknown as import('vitest').Mock).mockReturnValue({
      isDebugMode: true,
      toggleDebugMode: mockToggleDebugMode,
    });

    render(
      <BrowserRouter>
        <UserProfileDialog isOpen={true} onClose={mockClose} />
      </BrowserRouter>,
    );

    expect(screen.getByText('Active')).toBeInTheDocument();
    const disableBtn = screen.getByRole('button', {name: /disable/i});
    expect(disableBtn).toBeInTheDocument();

    fireEvent.click(disableBtn);
    expect(mockToggleDebugMode).toHaveBeenCalledTimes(1);
  });
});
