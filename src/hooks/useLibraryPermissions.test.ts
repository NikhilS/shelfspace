import {beforeEach, describe, expect, it, vi} from 'vitest';
import {renderHook} from '@testing-library/react';
import {useLibraryPermissions} from './useLibraryPermissions';
import {useEntityCacheStore} from '../stores/entityCacheStore';
import {SUPERADMIN_EMAIL} from '../constants/auth';

const mockUseAuth =
  vi.fn<
    () => {user: {uid: string; email: string} | null; isAuthReady: boolean}
  >();
const mockLibraryGetQuery = vi.fn();

vi.mock('../stores/authStore', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      library: {
        get: {getData: vi.fn()},
        list: {getData: vi.fn()},
      },
    }),
    library: {
      get: {
        useQuery: (...args: unknown[]): unknown => mockLibraryGetQuery(...args),
      },
    },
  },
}));

describe('useLibraryPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEntityCacheStore.getState().clearAllEntities();
    mockUseAuth.mockReturnValue({
      user: {uid: 'u-reader', email: 'reader@example.com'},
      isAuthReady: true,
    });
    mockLibraryGetQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
  });

  it('resolves warm permissions synchronously from useEntityCacheStore while library.get is loading', () => {
    useEntityCacheStore.getState().upsertLibrary({
      id: 'lib-warm',
      name: 'Shared Salon',
      ownerId: 'u-owner',
      ownerName: 'Owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      access: {
        'reader@example.com': 'editor',
      },
    });

    const {result} = renderHook(() =>
      useLibraryPermissions('lib-warm', 'u-reader'),
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.role).toBe('editor');
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canView).toBe(true);
    expect(result.current.isOwner).toBe(false);
  });

  it('fast-paths owner permissions for superadmin and user virtual reading shelf', () => {
    const virtualHook = renderHook(() =>
      useLibraryPermissions('virtual_u-reader', 'u-reader'),
    );
    expect(virtualHook.result.current.isOwner).toBe(true);
    expect(virtualHook.result.current.canEdit).toBe(true);

    mockUseAuth.mockReturnValue({
      user: {uid: 'u-admin', email: SUPERADMIN_EMAIL},
      isAuthReady: true,
    });
    const adminHook = renderHook(() =>
      useLibraryPermissions('lib-any', 'u-admin'),
    );
    expect(adminHook.result.current.isOwner).toBe(true);
    expect(adminHook.result.current.role).toBe('owner');
  });

  it('derives viewer permissions from library.get query response', () => {
    mockLibraryGetQuery.mockReturnValue({
      data: {
        id: 'lib-view',
        name: 'Public Archive',
        ownerId: 'u-owner',
        ownerName: 'Owner',
        callerRole: 'viewer',
      },
      isLoading: false,
      isError: false,
    });

    const {result} = renderHook(() =>
      useLibraryPermissions('lib-view', 'u-reader'),
    );

    expect(result.current.role).toBe('viewer');
    expect(result.current.canView).toBe(true);
    expect(result.current.canEdit).toBe(false);
    expect(result.current.isOwner).toBe(false);
  });
});
