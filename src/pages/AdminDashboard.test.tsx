import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import AdminDashboard from './AdminDashboard';

let mockIsAdmin = true;
let mockIsAppAllowed = true;
let mockIsLoadingPermissions = false;

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({
    user: {
      email: 'admin@bookish.internal',
      displayName: 'System Admin',
    },
  }),
}));

vi.mock('../hooks/useAppPermissions', () => ({
  useAppPermissions: () => ({
    isAdmin: mockIsAdmin,
    isAppAllowed: mockIsAppAllowed,
    isLoadingPermissions: mockIsLoadingPermissions,
  }),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      auth: {
        listWaitlist: {invalidate: vi.fn()},
        listAllowlist: {invalidate: vi.fn()},
      },
    }),
    useContext: () => ({
      auth: {
        listWaitlist: {invalidate: vi.fn()},
        listAllowlist: {invalidate: vi.fn()},
      },
    }),
    auth: {
      listAllowlist: {
        useQuery: () => ({
          data: {
            users: [
              {email: 'admin@bookish.internal', role: 'admin'},
              {email: 'reader@example.com', role: 'user'},
            ],
          },
          isLoading: false,
        }),
      },
      listWaitlist: {
        useQuery: () => ({
          data: {
            entries: [
              {
                email: 'applicant@example.com',
                displayName: 'Hopeful Reader',
                photoURL: null,
                status: 'pending',
                requestedAt: '2026-09-21T12:00:00.000Z',
              },
            ],
          },
          isLoading: false,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
      reviewWaitlistEntry: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      addAllowlistUser: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      removeAllowlistUser: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
    apiKey: {
      list: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      create: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      revoke: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
    settings: {
      getGeminiApiKeyStatus: {
        useQuery: () => ({
          data: {hasCustomKey: false},
          isLoading: false,
        }),
      },
    },
  },
}));

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAdmin = true;
    mockIsAppAllowed = true;
    mockIsLoadingPermissions = false;
  });

  it('renders the admin dashboard with Waitlist Queue and Authorized Users', () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', {name: /admin dashboard/i}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: /invite & waitlist queue/i}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: /authorized users/i}),
    ).toBeInTheDocument();
    expect(screen.getByText('applicant@example.com')).toBeInTheDocument();
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();
  });
});
