import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render} from '@testing-library/react';
import App from './App';

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({children}: {children: React.ReactNode}) => (
    <div>{children}</div>
  ),
  useAuth: () => ({user: null, isAuthReady: true}),
}));

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeInTheDocument();
  });
});
