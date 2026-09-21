import {render, screen, fireEvent} from '@testing-library/react';
import {BrowserRouter} from 'react-router-dom';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import AppLayout from './AppLayout';
import {useAuth} from '../stores/authStore';

vi.mock('../stores/authStore', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../hooks/useAppPermissions', () => ({
  useAppPermissions: vi.fn(() => ({isAdmin: false, isAppAllowed: true})),
}));

const renderAppLayout = () => {
  return render(
    <BrowserRouter>
      <AppLayout>
        <div data-testid="child-content">Child Content</div>
      </AppLayout>
    </BrowserRouter>,
  );
};

describe('AppLayout', () => {
  const mockLogOut = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as unknown as import('vitest').Mock).mockReturnValue({
      user: {uid: 'user1', email: 'test@example.com', photoURL: null},
      logOut: mockLogOut,
    });
  });

  it('renders children correctly', () => {
    renderAppLayout();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('renders navigation links and user info with vertically centered layout', () => {
    renderAppLayout();
    // book(ish) brandmark
    const brand = screen.getByText('book(ish)');
    expect(brand).toBeInTheDocument();
    expect(brand).toHaveClass('leading-none');

    // Modern Archivist subtitle
    const archivist = screen.getByText('Modern Archivist');
    expect(archivist).toBeInTheDocument();
    expect(archivist).toHaveClass('leading-none');
    expect(archivist).toHaveClass('items-center');

    // User name
    const userName = screen.getByText('test');
    expect(userName).toBeInTheDocument();
    expect(userName).toHaveClass('leading-normal');

    // User placeholder icon "T" since email is "test@example.com"
    expect(screen.getAllByText('T').length).toBeGreaterThan(0);
  });

  it('calls logout when Sign Out is clicked', () => {
    renderAppLayout();
    const profileBtn = screen.getByRole('button', {
      name: /open profile and settings/i,
    });
    fireEvent.click(profileBtn);
    const logoutBtn = screen.getByRole('button', {name: /sign out/i});
    fireEvent.click(logoutBtn);
    expect(mockLogOut).toHaveBeenCalledTimes(1);
  });
});
