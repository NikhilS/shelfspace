import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import Login from './Login';
import {MemoryRouter} from 'react-router-dom';

const mockSignInWithPopup = vi.fn();

vi.mock('firebase/auth', () => ({
  signInWithPopup: (...args: unknown[]) => mockSignInWithPopup(...args),
  GoogleAuthProvider: class {},
}));

vi.mock('../firebase', () => ({
  auth: {},
}));

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({user: null, isAuthReady: true}),
}));

describe('Login', () => {
  it('renders login button', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Sign in with Google/i)).toBeInTheDocument();
  });
});
