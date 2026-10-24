import React from 'react';
import {render, screen} from '@testing-library/react';
import {MemoryRouter, Routes, Route} from 'react-router-dom';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {RequireLibraryPermission} from './RequireLibraryPermission';
import {useAuth} from '../../stores/authStore';
import {useAppPermissions} from '../../hooks/useAppPermissions';
import {useLibraryPermissions} from '../../hooks/useLibraryPermissions';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';

vi.mock('../../stores/authStore', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../hooks/useAppPermissions', () => ({
  useAppPermissions: vi.fn(),
}));

vi.mock('../../hooks/useLibraryPermissions', () => ({
  useLibraryPermissions: vi.fn(),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn(),
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      book: {
        list: {
          prefetch: vi.fn(),
        },
      },
    })),
  },
}));

describe('RequireLibraryPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: {uid: 'user-1', email: 'reader@example.com'},
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(useAppPermissions).mockReturnValue({
      isAppAllowed: true,
      isAdmin: false,
      hasAiPlan: false,
      isLoadingPermissions: false,
      refetchPermissions: vi.fn(),
    });
  });

  it('renders children when user has required viewer permission online', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(true);
    vi.mocked(useLibraryPermissions).mockReturnValue({
      role: 'viewer',
      isOwner: false,
      canEdit: false,
      canView: true,
      loading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/library/lib-1']}>
        <Routes>
          <Route
            path="/library/:id"
            element={
              <RequireLibraryPermission requires="viewer">
                <div>Library Content</div>
              </RequireLibraryPermission>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Library Content')).toBeInTheDocument();
  });

  it('blocks non-admin owners when requireAdmin is true (e.g. Shelf Care route)', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(true);
    vi.mocked(useLibraryPermissions).mockReturnValue({
      role: 'owner',
      isOwner: true,
      canEdit: true,
      canView: true,
      loading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/library/lib-1/spruce-up']}>
        <Routes>
          <Route
            path="/library/:id/spruce-up"
            element={
              <RequireLibraryPermission requires="editor" requireAdmin>
                <div>Shelf Care Content</div>
              </RequireLibraryPermission>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(
      screen.getByText(
        /You don't have the necessary permissions \(admin\) to view this page\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Shelf Care Content')).not.toBeInTheDocument();
  });

  it('allows admin editors when requireAdmin is true', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(true);
    vi.mocked(useAppPermissions).mockReturnValue({
      isAppAllowed: true,
      isAdmin: true,
      hasAiPlan: true,
      isLoadingPermissions: false,
      refetchPermissions: vi.fn(),
    });
    vi.mocked(useLibraryPermissions).mockReturnValue({
      role: 'owner',
      isOwner: true,
      canEdit: true,
      canView: true,
      loading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/library/lib-1/spruce-up']}>
        <Routes>
          <Route
            path="/library/:id/spruce-up"
            element={
              <RequireLibraryPermission requires="editor" requireAdmin>
                <div>Shelf Care Content</div>
              </RequireLibraryPermission>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Shelf Care Content')).toBeInTheDocument();
  });

  it('renders offline read-only notice when accessing an editor route while offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);
    vi.mocked(useLibraryPermissions).mockReturnValue({
      role: 'owner',
      isOwner: true,
      canEdit: true,
      canView: true,
      loading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/library/lib-1/add']}>
        <Routes>
          <Route
            path="/library/:id/add"
            element={
              <RequireLibraryPermission requires="editor">
                <div>Add Book View</div>
              </RequireLibraryPermission>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByText(/Available When You're Back Online/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Back to Library')).toBeInTheDocument();
    expect(screen.queryByText('Add Book View')).not.toBeInTheDocument();
  });

  it('renders Not Available Offline Yet state when opening an uncached library while offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);
    vi.mocked(useLibraryPermissions).mockReturnValue({
      role: null,
      isOwner: false,
      canEdit: false,
      canView: false,
      loading: false,
      isError: true,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/library/uncached-lib']}>
        <Routes>
          <Route
            path="/library/:id"
            element={
              <RequireLibraryPermission requires="viewer">
                <div>Uncached Library Content</div>
              </RequireLibraryPermission>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Not Available Offline Yet')).toBeInTheDocument();
    expect(screen.getByText('Return to Reading Room')).toBeInTheDocument();
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
  });
});
