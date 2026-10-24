import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AdminAllowlistDialog} from './AdminAllowlistDialog';

const mockAddAllowlistMutateAsync = vi.fn();
const mockReviewWaitlistMutateAsync = vi.fn();
const mockInvalidate = vi.fn();

vi.mock('../../stores/authStore', () => ({
  useAuth: () => ({
    user: {
      email: 'admin@bookish.internal',
      displayName: 'System Admin',
    },
  }),
}));

vi.mock('../../hooks/useAppPermissions', () => ({
  useAppPermissions: () => ({
    isAdmin: true,
    isAppAllowed: true,
    isLoadingPermissions: false,
  }),
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      auth: {
        listWaitlist: {invalidate: mockInvalidate},
        listAllowlist: {invalidate: mockInvalidate},
      },
      library: {
        getCollaborators: {invalidate: mockInvalidate},
      },
    }),
    useContext: () => ({
      auth: {
        listWaitlist: {invalidate: mockInvalidate},
        listAllowlist: {invalidate: mockInvalidate},
      },
      library: {
        getCollaborators: {invalidate: mockInvalidate},
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
                email: 'invitee@example.com',
                displayName: 'Invited Friend',
                photoURL: null,
                status: 'pending',
                invitedLibraryName: 'Family Archive',
                requestedAt: '2026-10-20T12:00:00.000Z',
              },
            ],
          },
          isLoading: false,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
      reviewWaitlistEntry: {
        useMutation: (opts?: {
          onSuccess?: (
            res: unknown,
            vars: {email: string; action: string},
          ) => void;
        }) => ({
          mutateAsync: async (vars: {
            email: string;
            action: 'approve' | 'reject';
            hasAiPlan?: boolean;
          }) => {
            mockReviewWaitlistMutateAsync(vars);
            opts?.onSuccess?.({success: true}, vars);
            return {success: true};
          },
          isPending: false,
        }),
      },
      addAllowlistUser: {
        useMutation: (opts?: {onSuccess?: () => void}) => ({
          mutateAsync: async (vars: {
            email: string;
            role?: string;
            hasAiPlan?: boolean;
          }) => {
            mockAddAllowlistMutateAsync(vars);
            opts?.onSuccess?.();
            return {success: true};
          },
          isPending: false,
        }),
      },
      removeAllowlistUser: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      updateAllowlistAiPlan: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

describe('AdminAllowlistDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-fills initialEmail in the Authorized Users form and renders waitlist entries', () => {
    render(
      <MemoryRouter>
        <AdminAllowlistDialog
          isOpen={true}
          onClose={vi.fn()}
          initialEmail="invitee@example.com"
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', {name: /admin allowlist/i}),
    ).toBeInTheDocument();
    const emailInput = screen.getByLabelText(
      /allowlist email address/i,
    ) as HTMLInputElement;
    expect(emailInput.value).toBe('invitee@example.com');
    expect(screen.getByText('Invited Friend')).toBeInTheDocument();
  });

  it('grants global allowlist access and notifies onAllowlistUpdated', async () => {
    const onUpdated = vi.fn();

    render(
      <MemoryRouter>
        <AdminAllowlistDialog
          isOpen={true}
          onClose={vi.fn()}
          initialEmail="newfriend@example.com"
          onAllowlistUpdated={onUpdated}
        />
      </MemoryRouter>,
    );

    const grantBtn = screen.getByRole('button', {name: /grant access/i});
    fireEvent.click(grantBtn);

    await waitFor(() => {
      expect(mockAddAllowlistMutateAsync).toHaveBeenCalledWith({
        email: 'newfriend@example.com',
        role: 'user',
        hasAiPlan: false,
      });
      expect(onUpdated).toHaveBeenCalled();
    });
  });
});
