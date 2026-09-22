import {describe, it, expect, vi, beforeEach} from 'vitest';
import {WaitlistService} from '../waitlistService';
import {AllowlistService} from '../allowlistService';

const mockDocGet = vi.fn();
const mockDocSet = vi.fn();
const mockDoc = vi.fn((_path: string) => ({
  get: mockDocGet,
  set: mockDocSet,
}));

const mockCollectionGet = vi.fn();
const mockCollectionDoc = vi.fn((_id: string) => ({
  get: mockDocGet,
  set: mockDocSet,
}));
const mockCollection = vi.fn((_path: string) => ({
  get: mockCollectionGet,
  doc: mockCollectionDoc,
}));

const mockFirestore = {
  doc: mockDoc,
  collection: mockCollection,
};

vi.mock('../../../services/server/firebaseAdmin', () => ({
  getAdminDb: () => mockFirestore,
}));

vi.mock('firebase-admin', () => ({
  default: {
    firestore: () => mockFirestore,
  },
}));

vi.mock('../allowlistService', () => ({
  AllowlistService: {
    getPermissions: vi.fn(),
    addUser: vi.fn(),
  },
}));

describe('WaitlistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocGet.mockReset();
    mockDocSet.mockReset();
    mockCollectionGet.mockReset();
  });

  describe('getStatus', () => {
    it('returns not_requested for null or empty email', async () => {
      expect(await WaitlistService.getStatus(null)).toEqual({
        status: 'not_requested',
      });
      expect(await WaitlistService.getStatus('')).toEqual({
        status: 'not_requested',
      });
    });

    it('returns approved immediately if caller is already on the allowlist', async () => {
      vi.mocked(AllowlistService.getPermissions).mockResolvedValueOnce({
        isAppAllowed: true,
        isAdmin: false,
      });

      const res = await WaitlistService.getStatus('member@example.com');
      expect(res).toEqual({status: 'approved'});
      expect(mockDoc).not.toHaveBeenCalled();
    });

    it('returns not_requested if waitlist document does not exist', async () => {
      vi.mocked(AllowlistService.getPermissions).mockResolvedValueOnce({
        isAppAllowed: false,
        isAdmin: false,
      });
      mockDocGet.mockResolvedValueOnce({exists: false});

      const res = await WaitlistService.getStatus('newcomer@example.com');
      expect(res).toEqual({status: 'not_requested'});
      expect(mockDoc).toHaveBeenCalledWith(
        'appSettings/waitlist/entries/newcomer@example.com',
      );
    });

    it('returns pending and entry details if waitlist doc exists with pending status', async () => {
      vi.mocked(AllowlistService.getPermissions).mockResolvedValueOnce({
        isAppAllowed: false,
        isAdmin: false,
      });
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          displayName: 'Jane Reader',
          photoURL: 'https://example.com/avatar.jpg',
          status: 'pending',
          requestedAt: '2026-09-21T12:00:00.000Z',
        }),
      });

      const res = await WaitlistService.getStatus('jane@example.com');
      expect(res.status).toBe('pending');
      expect(res.entry).toMatchObject({
        email: 'jane@example.com',
        displayName: 'Jane Reader',
        photoURL: 'https://example.com/avatar.jpg',
        status: 'pending',
        requestedAt: '2026-09-21T12:00:00.000Z',
      });
    });
  });

  describe('join', () => {
    it('creates a new pending entry when document does not exist', async () => {
      mockDocGet.mockResolvedValueOnce({exists: false});
      mockDocSet.mockResolvedValueOnce(undefined);

      const entry = await WaitlistService.join({
        email: 'Applicant@Example.com',
        displayName: 'Applicant Name',
        photoURL: 'https://example.com/photo.png',
      });

      expect(entry.email).toBe('applicant@example.com');
      expect(entry.status).toBe('pending');
      expect(entry.displayName).toBe('Applicant Name');
      expect(entry.photoURL).toBe('https://example.com/photo.png');
      expect(mockCollectionDoc).toHaveBeenCalledWith('applicant@example.com');
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'applicant@example.com',
          status: 'pending',
          displayName: 'Applicant Name',
        }),
      );
    });

    it('merges with existing entry when already on the waitlist', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          displayName: 'Original Name',
          status: 'pending',
          requestedAt: '2026-09-20T10:00:00.000Z',
        }),
      });
      mockDocSet.mockResolvedValueOnce(undefined);

      const entry = await WaitlistService.join({
        email: 'applicant@example.com',
        displayName: 'Updated Name',
      });

      expect(entry.displayName).toBe('Updated Name');
      expect(entry.requestedAt).toBe('2026-09-20T10:00:00.000Z');
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Updated Name',
          requestedAt: '2026-09-20T10:00:00.000Z',
        }),
        {merge: true},
      );
    });
  });

  describe('list', () => {
    it('returns all waitlist entries sorted newest first', async () => {
      mockCollectionGet.mockResolvedValueOnce({
        docs: [
          {
            id: 'older@example.com',
            data: () => ({
              status: 'pending',
              requestedAt: '2026-09-19T00:00:00.000Z',
            }),
          },
          {
            id: 'newer@example.com',
            data: () => ({
              status: 'pending',
              requestedAt: '2026-09-21T00:00:00.000Z',
            }),
          },
        ],
      });

      const list = await WaitlistService.list('all');
      expect(list).toHaveLength(2);
      expect(list[0].email).toBe('newer@example.com');
      expect(list[1].email).toBe('older@example.com');
    });

    it('filters entries by status', async () => {
      mockCollectionGet.mockResolvedValueOnce({
        docs: [
          {
            id: 'pending@example.com',
            data: () => ({
              status: 'pending',
              requestedAt: '2026-09-21T00:00:00.000Z',
            }),
          },
          {
            id: 'approved@example.com',
            data: () => ({
              status: 'approved',
              requestedAt: '2026-09-20T00:00:00.000Z',
            }),
          },
        ],
      });

      const pendingOnly = await WaitlistService.list('pending');
      expect(pendingOnly).toHaveLength(1);
      expect(pendingOnly[0].email).toBe('pending@example.com');
    });
  });

  describe('review', () => {
    it('approves applicant and adds them to allowlist', async () => {
      mockDocSet.mockResolvedValueOnce(undefined);
      vi.mocked(AllowlistService.addUser).mockResolvedValueOnce();

      const res = await WaitlistService.review({
        email: 'applicant@example.com',
        action: 'approve',
        adminEmail: 'admin@example.com',
      });

      expect(res).toEqual({success: true, status: 'approved'});
      expect(AllowlistService.addUser).toHaveBeenCalledWith(
        'applicant@example.com',
        'user',
      );
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'applicant@example.com',
          status: 'approved',
          reviewedBy: 'admin@example.com',
        }),
        {merge: true},
      );
    });

    it('rejects applicant without adding them to allowlist', async () => {
      mockDocSet.mockResolvedValueOnce(undefined);

      const res = await WaitlistService.review({
        email: 'applicant@example.com',
        action: 'reject',
        adminEmail: 'admin@example.com',
      });

      expect(res).toEqual({success: true, status: 'rejected'});
      expect(AllowlistService.addUser).not.toHaveBeenCalled();
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'applicant@example.com',
          status: 'rejected',
          reviewedBy: 'admin@example.com',
        }),
        {merge: true},
      );
    });
  });
});
