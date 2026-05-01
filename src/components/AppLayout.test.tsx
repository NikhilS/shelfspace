import {render, screen, fireEvent} from '@testing-library/react';
import {BrowserRouter} from 'react-router-dom';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import AppLayout from './AppLayout';
import {useAuth} from '../contexts/AuthContext';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
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
    (useAuth as import('vitest').Mock).mockReturnValue({
      user: {uid: 'user1', email: 'test@example.com', photoURL: null},
      logOut: mockLogOut,
    });
  });

  it('renders children correctly', () => {
    renderAppLayout();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('renders navigation links and user info', () => {
    renderAppLayout();
    // Athenaeum header/brand
    expect(screen.getAllByText('Athenaeum').length).toBeGreaterThan(0);
    // User placeholder icon "T" since email is "test@example.com"
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('calls logout when Logout is clicked', () => {
    renderAppLayout();
    const logoutBtn = screen.getByText('Logout');
    fireEvent.click(logoutBtn);
    expect(mockLogOut).toHaveBeenCalledTimes(1);
  });
});
