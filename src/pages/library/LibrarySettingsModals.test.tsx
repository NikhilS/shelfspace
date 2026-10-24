import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {LibrarySettingsModals} from './LibrarySettingsModals';
import type {Library} from '../../types';

let mockIsAdmin = true;
const mockRefetchCollaborators = vi.fn();

vi.mock('../../stores/authStore', () => ({
  useAuth: () => ({
    user: {
      uid: 'owner-1',
      email: 'admin@bookish.internal',
      displayName: 'System Admin',
    },
  }),
}));

vi.mock('../../hooks/useAppPermissions', () => ({
  useAppPermissions: () => ({
    isAdmin: mockIsAdmin,
    isAppAllowed: true,
    isLoadingPermissions: false,
  }),
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      auth: {
        listWaitlist: {invalidate: vi.fn()},
        listAllowlist: {invalidate: vi.fn()},
      },
      library: {
        getCollaborators: {invalidate: vi.fn()},
      },
    }),
    useContext: () => ({
      auth: {
        listWaitlist: {invalidate: vi.fn()},
        listAllowlist: {invalidate: vi.fn()},
      },
      library: {
        getCollaborators: {invalidate: vi.fn()},
      },
    }),
    library: {
      getCollaborators: {
        useQuery: () => ({
          data: {
            collaborators: [
              {
                email: 'pending@example.com',
                role: 'viewer',
                allowlistStatus: 'pending_approval',
              },
              {
                email: 'active@example.com',
                role: 'editor',
                allowlistStatus: 'approved',
              },
            ],
          },
          refetch: mockRefetchCollaborators,
        }),
      },
    },
    auth: {
      listAllowlist: {
        useQuery: () => ({
          data: {
            users: [{email: 'admin@bookish.internal', role: 'admin'}],
          },
          isLoading: false,
        }),
      },
      listWaitlist: {
        useQuery: () => ({
          data: {
            entries: [
              {
                email: 'pending@example.com',
                displayName: 'Pending Reader',
                photoURL: null,
                status: 'pending',
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
      updateAllowlistAiPlan: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

const sampleLibrary: Library = {
  id: 'lib-1',
  name: 'Living Room Shelf',
  ownerId: 'owner-1',
  ownerName: 'System Admin',
  access: {
    'admin@bookish.internal': 'owner',
    'pending@example.com': 'viewer',
    'active@example.com': 'editor',
  },
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('LibrarySettingsModals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAdmin = true;
  });

  it('shows Manage Allowlist link for un-allowlisted collaborators when user is admin and opens AdminAllowlistDialog', () => {
    render(
      <MemoryRouter>
        <LibrarySettingsModals
          isSettingsOpen={true}
          setIsSettingsOpen={vi.fn()}
          isAdvancedSettingsOpen={false}
          setIsAdvancedSettingsOpen={vi.fn()}
          libraryToDelete={false}
          setLibraryToDelete={vi.fn()}
          library={sampleLibrary}
          isOwner={true}
          canEdit={true}
          isAdmin={true}
          addShareEmail={vi.fn()}
          handleRemoveShare={vi.fn()}
          handleExportToCsv={vi.fn()}
          handleDeleteLibrary={vi.fn()}
          confirmDeleteLibrary={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Pending Admin Approval')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();

    const manageAllowlistBtn = screen.getByRole('button', {
      name: /open admin allowlist for pending@example.com/i,
    });
    expect(manageAllowlistBtn).toBeInTheDocument();

    fireEvent.click(manageAllowlistBtn);

    expect(
      screen.getByRole('heading', {name: /admin allowlist/i}),
    ).toBeInTheDocument();
    const emailInput = screen.getByLabelText(
      /allowlist email address/i,
    ) as HTMLInputElement;
    expect(emailInput.value).toBe('pending@example.com');
  });

  it('hides Manage Allowlist link when current user is not an admin', () => {
    mockIsAdmin = false;

    render(
      <MemoryRouter>
        <LibrarySettingsModals
          isSettingsOpen={true}
          setIsSettingsOpen={vi.fn()}
          isAdvancedSettingsOpen={false}
          setIsAdvancedSettingsOpen={vi.fn()}
          libraryToDelete={false}
          setLibraryToDelete={vi.fn()}
          library={sampleLibrary}
          isOwner={true}
          canEdit={true}
          isAdmin={false}
          addShareEmail={vi.fn()}
          handleRemoveShare={vi.fn()}
          handleExportToCsv={vi.fn()}
          handleDeleteLibrary={vi.fn()}
          confirmDeleteLibrary={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Pending Admin Approval')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /open admin allowlist for pending@example.com/i,
      }),
    ).not.toBeInTheDocument();
  });
});
