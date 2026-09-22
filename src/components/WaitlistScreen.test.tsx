import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {WaitlistScreen} from './WaitlistScreen';

const mockMutateJoin = vi.fn();
const mockRefetchWaitlist = vi.fn();
const mockRefetchPermissions = vi.fn();
const mockSignOut = vi.fn();

let mockWaitlistQueryData: {
  status: 'not_requested' | 'pending' | 'approved' | 'rejected';
  entry?: {
    email: string;
    displayName: string | null;
    photoURL: string | null;
    status: 'pending' | 'approved' | 'rejected';
    requestedAt: string;
  };
} | null = null;

let mockIsLoading = false;

vi.mock('../lib/trpc', () => ({
  trpc: {
    auth: {
      getWaitlistStatus: {
        useQuery: () => ({
          data: mockWaitlistQueryData,
          isLoading: mockIsLoading,
          refetch: mockRefetchWaitlist,
        }),
      },
      joinWaitlist: {
        useMutation: (opts?: {
          onSuccess?: () => void;
          onError?: (err: {message: string}) => void;
        }) => ({
          isPending: false,
          mutate: (input?: unknown) => {
            mockMutateJoin(input);
            opts?.onSuccess?.();
          },
        }),
      },
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('WaitlistScreen', () => {
  const user = {
    email: 'reader@example.com',
    displayName: 'Test Reader',
    photoURL: 'https://example.com/photo.jpg',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLoading = false;
    mockRefetchWaitlist.mockResolvedValue({data: mockWaitlistQueryData});
    mockRefetchPermissions.mockResolvedValue(undefined);
  });

  it('renders loading state when waitlist status is loading', () => {
    mockIsLoading = true;
    mockWaitlistQueryData = null;

    render(
      <WaitlistScreen
        user={user}
        onRefetchPermissions={mockRefetchPermissions}
        onSignOut={mockSignOut}
      />,
    );

    expect(screen.getByText(/consulting archive ledger/i)).toBeInTheDocument();
  });

  it('renders State A (not requested) with user details and Request Access button', () => {
    mockIsLoading = false;
    mockWaitlistQueryData = {status: 'not_requested'};

    render(
      <WaitlistScreen
        user={user}
        onRefetchPermissions={mockRefetchPermissions}
        onSignOut={mockSignOut}
      />,
    );

    expect(
      screen.getByText(/An intimate archive for physical & digital books/i),
    ).toBeInTheDocument();
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();
    expect(screen.getByText('Test Reader')).toBeInTheDocument();

    const requestBtn = screen.getByRole('button', {name: /request access/i});
    expect(requestBtn).toBeInTheDocument();

    fireEvent.click(requestBtn);
    expect(mockMutateJoin).toHaveBeenCalledWith({
      displayName: 'Test Reader',
      photoURL: 'https://example.com/photo.jpg',
    });
  });

  it('renders State B (pending) with queue indicator, timestamp, and Check Status button', async () => {
    mockIsLoading = false;
    mockWaitlistQueryData = {
      status: 'pending',
      entry: {
        email: 'reader@example.com',
        displayName: 'Test Reader',
        photoURL: 'https://example.com/photo.jpg',
        status: 'pending',
        requestedAt: '2026-09-21T10:00:00.000Z',
      },
    };

    render(
      <WaitlistScreen
        user={user}
        onRefetchPermissions={mockRefetchPermissions}
        onSignOut={mockSignOut}
      />,
    );

    expect(screen.getByText(/You're on the list/i)).toBeInTheDocument();
    expect(screen.getByText(/In Queue/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Requested on September 21, 2026/i),
    ).toBeInTheDocument();

    const checkBtn = screen.getByRole('button', {name: /check access status/i});
    expect(checkBtn).toBeInTheDocument();

    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(mockRefetchWaitlist).toHaveBeenCalled();
      expect(mockRefetchPermissions).toHaveBeenCalled();
    });
  });

  it('renders State C (approved) with welcome message and Enter Library Catalog button', () => {
    mockIsLoading = false;
    mockWaitlistQueryData = {status: 'approved'};

    render(
      <WaitlistScreen
        user={user}
        onRefetchPermissions={mockRefetchPermissions}
        onSignOut={mockSignOut}
      />,
    );

    expect(screen.getByText(/Welcome to the Archives/i)).toBeInTheDocument();
    expect(screen.getByText(/Invitation Approved/i)).toBeInTheDocument();

    const enterBtn = screen.getByRole('button', {
      name: /enter library catalog/i,
    });
    expect(enterBtn).toBeInTheDocument();

    fireEvent.click(enterBtn);
    expect(mockRefetchPermissions).toHaveBeenCalledTimes(1);
  });

  it('renders State D (rejected) with cohort capacity notice', () => {
    mockIsLoading = false;
    mockWaitlistQueryData = {status: 'rejected'};

    render(
      <WaitlistScreen
        user={user}
        onRefetchPermissions={mockRefetchPermissions}
        onSignOut={mockSignOut}
      />,
    );

    expect(
      screen.getByText(/Registration is at Capacity/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cohort At Capacity/i)).toBeInTheDocument();
  });

  it('allows user to sign out from the waitlist screen', () => {
    mockIsLoading = false;
    mockWaitlistQueryData = {status: 'not_requested'};

    render(
      <WaitlistScreen
        user={user}
        onRefetchPermissions={mockRefetchPermissions}
        onSignOut={mockSignOut}
      />,
    );

    const signOutBtn = screen.getByRole('button', {
      name: /sign out \/ use another account/i,
    });
    fireEvent.click(signOutBtn);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
