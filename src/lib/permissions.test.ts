import {describe, it, expect} from 'vitest';
import {getAccessFromLibrary} from './permissions';
import {Library} from '../types';

const makeLibrary = (overrides: Partial<Library> = {}): Library => ({
  id: 'lib-1',
  name: 'Scholarly Archive',
  ownerId: 'owner-1',
  bookCount: 10,
  createdAt: 1000,
  ...overrides,
});

describe('getAccessFromLibrary client RBAC helper suite', () => {
  it('returns null role and all false flags when library or userId is missing', () => {
    expect(getAccessFromLibrary(null, 'u-1', 'u1@example.com')).toEqual({
      role: null,
      isOwner: false,
      canEdit: false,
      canDelete: false,
      canView: false,
    });
    expect(
      getAccessFromLibrary(makeLibrary(), undefined, 'u1@example.com'),
    ).toEqual({
      role: null,
      isOwner: false,
      canEdit: false,
      canDelete: false,
      canView: false,
    });
  });

  it('grants full owner permissions when userId matches library.ownerId', () => {
    const access = getAccessFromLibrary(
      makeLibrary({ownerId: 'owner-1'}),
      'owner-1',
      'owner@example.com',
    );
    expect(access).toEqual({
      role: 'owner',
      isOwner: true,
      canEdit: true,
      canDelete: true,
      canView: true,
    });
  });

  it('resolves collaborator access from normalized lowercase or exact-case email map', () => {
    const lib = makeLibrary({
      access: {
        'editor@example.com': 'editor',
        'MixedCase@Example.com': 'viewer',
      },
    });

    const editorAccess = getAccessFromLibrary(
      lib,
      'collab-1',
      '  EDITOR@example.com ',
    );
    expect(editorAccess).toEqual({
      role: 'editor',
      isOwner: false,
      canEdit: true,
      canDelete: true,
      canView: true,
    });

    const viewerAccess = getAccessFromLibrary(
      lib,
      'collab-2',
      'MixedCase@Example.com',
    );
    expect(viewerAccess).toEqual({
      role: 'viewer',
      isOwner: false,
      canEdit: false,
      canDelete: false,
      canView: true,
    });
  });

  it('falls back to callerRole and elevates admin callerRole to owner', () => {
    const adminFallback = getAccessFromLibrary(
      makeLibrary({callerRole: 'admin'}),
      'superadmin-uid',
      'admin@example.com',
    );
    expect(adminFallback).toEqual({
      role: 'owner',
      isOwner: true,
      canEdit: true,
      canDelete: true,
      canView: true,
    });

    const viewerFallback = getAccessFromLibrary(
      makeLibrary({callerRole: 'viewer'}),
      'viewer-uid',
      'viewer@example.com',
    );
    expect(viewerFallback.role).toBe('viewer');
    expect(viewerFallback.canView).toBe(true);
    expect(viewerFallback.canEdit).toBe(false);
  });
});
