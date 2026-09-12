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
    expect(screen.getByText('Sign-In')).toBeInTheDocument();
    expect(screen.getByText('Open Your Vault')).toBeInTheDocument();
  });

  it('renders marketing landing page sections and core value propositions', () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    // Hero headline and copy
    expect(screen.getByText(/The digital ledger your/i)).toBeInTheDocument();
    expect(screen.getByText(/physical library deserves/i)).toBeInTheDocument();

    // Ingestion mechanisms
    expect(screen.getByText(/Continuous Spine Vision/i)).toBeInTheDocument();
    expect(screen.getByText(/Rapid Barcode Scanner/i)).toBeInTheDocument();
    expect(
      screen.getByText(/1-Click Goodreads & CSV Import/i),
    ).toBeInTheDocument();

    // The Dimensions Bento
    expect(
      screen.getByRole('heading', {name: /Not just shelves. Dimensions./i}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: /Semantic Constellations/i}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: /Self-Healing Spruce-Up/i}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: /Narrative Geography/i}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: /Deep-Time Timeline/i}),
    ).toBeInTheDocument();

    // AI Curator section
    expect(
      screen.getByRole('heading', {
        name: /Never stare blankly at your bookshelves again./i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: /The Left Hand of Darkness/i}),
    ).toBeInTheDocument();

    // Comparison table
    expect(
      screen.getByRole('heading', {
        name: /Built for book lovers, not social feeds./i,
      }),
    ).toBeInTheDocument();
  });
});
