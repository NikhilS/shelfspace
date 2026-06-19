import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render} from '@testing-library/react';
import App from './App';

vi.mock('./stores/authStore', () => ({
  useAuthStore: Object.assign(() => ({user: null, isAuthReady: true}), {
    getState: () => ({_initialize: vi.fn()}),
  }),
  useAuth: () => ({user: null, isAuthReady: true}),
}));

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeInTheDocument();
  });
});
