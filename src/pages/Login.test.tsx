import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import Login from './Login';
import {MemoryRouter} from 'react-router-dom';

const mockSignIn = vi.fn();

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({user: null, isAuthReady: true, signIn: mockSignIn}),
}));

describe('Login', () => {
  it('renders high-contrast sign-in and get-started buttons that trigger signIn', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    const signInButton = screen.getByRole('button', {name: /^Sign In$/i});
    const getStartedButton = screen.getByRole('button', {
      name: /^Get Started$/i,
    });

    expect(signInButton).toBeInTheDocument();
    expect(getStartedButton).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: /Sign In with Google/i}),
    ).not.toBeInTheDocument();
    expect(signInButton.className).toContain('bg-primary');
    expect(signInButton.className).toContain('text-on-primary');
    expect(getStartedButton.className).toContain('bg-primary');
    expect(getStartedButton.className).toContain('text-on-primary');

    fireEvent.click(getStartedButton);
    expect(mockSignIn).toHaveBeenCalled();
  });

  it('renders the interactive hero Bento preview and 4-card visual feature grid without a comparison table', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    // Equal billing headline
    expect(
      screen.getByRole('heading', {
        name: /Your physical bookshelves and your reading life/i,
      }),
    ).toBeInTheDocument();

    // Interactive Hero Bento showcase
    expect(screen.getByTestId('hero-bento-showcase')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: 'Currently Reading'}),
    ).toBeInTheDocument();
    expect(screen.getByText('14 Books Read')).toBeInTheDocument();
    expect(screen.getByText('Pick of the Day')).toBeInTheDocument();

    // Switch hero preview tab to Living Room Shelf
    fireEvent.click(screen.getByRole('tab', {name: /Living Room Shelf/i}));
    expect(screen.getByText('142 Owned Volumes')).toBeInTheDocument();

    // 4-Card Feature Bento Grid
    expect(screen.getByTestId('features-bento-section')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /Quick search, barcode scan, or snap a whole shelf/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /Organize your rooms, share shelves, and auto-spruce covers/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /Track what you’re reading—even if it’s not on your shelf/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /See your books as a 3D constellation, a world map, or a timeline/i,
      }),
    ).toBeInTheDocument();

    // Comparison table is dropped
    expect(
      screen.queryByText(/Built for book lovers, not social feeds/i),
    ).not.toBeInTheDocument();
  });
});
