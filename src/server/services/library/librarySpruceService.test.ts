import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  uploadImage,
  hasValidRasterMagicBytes,
  resetMetadata,
} from './librarySpruceService';

const mockFileSave = vi.fn().mockResolvedValue(undefined);
const mockBucketFile = vi.fn(() => ({
  save: mockFileSave,
}));

const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockBooksSnapshotGet = vi.fn();

vi.mock('../firebaseAdmin', () => ({
  getAdminApp: () => ({}),
  firebaseConfig: {
    projectId: 'test-project',
    storageBucket: 'test-project.firebasestorage.app',
  },
  getAdminDb: () => ({
    batch: () => ({
      update: mockBatchUpdate,
      set: mockBatchSet,
      commit: mockBatchCommit,
    }),
    collection: () => ({
      doc: () => ({
        collection: (sub: string) => {
          if (sub === 'books') {
            return {get: mockBooksSnapshotGet};
          }
          return {doc: (id: string) => ({id})};
        },
      }),
    }),
  }),
  formatFirestoreAdminError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: () => 'MOCK_DELETE_FIELD',
  },
}));

vi.mock('firebase-admin', () => ({
  default: {
    storage: () => ({
      bucket: () => ({
        name: 'test-project.firebasestorage.app',
        file: mockBucketFile,
      }),
    }),
  },
}));

describe('librarySpruceService — Image Upload & Magic-Byte Validation (SEC-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects image/svg+xml and text/html MIME types to prevent Stored XSS', async () => {
    const svgBase64 = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    ).toString('base64');

    await expect(
      uploadImage(
        'u1',
        'u1@example.com',
        'lib1',
        'libraries/lib1/covers/evil.svg',
        `data:image/svg+xml;base64,${svgBase64}`,
        {skipAccessCheck: true},
      ),
    ).rejects.toThrow(/Unsupported or unsafe image MIME type/);

    await expect(
      uploadImage(
        'u1',
        'u1@example.com',
        'lib1',
        'libraries/lib1/covers/evil.html',
        `data:text/html;base64,${svgBase64}`,
        {skipAccessCheck: true},
      ),
    ).rejects.toThrow(/Unsupported or unsafe image MIME type/);
  });

  it('rejects disguised SVG/HTML payloads spoofing image/png MIME type via magic-byte check', async () => {
    const disguisedSvg = Buffer.from(
      '<svg><script>alert("xss")</script></svg>',
    ).toString('base64');

    await expect(
      uploadImage(
        'u1',
        'u1@example.com',
        'lib1',
        'libraries/lib1/covers/spoofed.png',
        `data:image/png;base64,${disguisedSvg}`,
        {skipAccessCheck: true},
      ),
    ).rejects.toThrow(/Image binary header does not match declared MIME type/);
  });

  it('rejects non-data javascript: URLs instead of echoing them back', async () => {
    await expect(
      uploadImage(
        'u1',
        'u1@example.com',
        'lib1',
        'libraries/lib1/covers/xss.png',
        'javascript:alert(document.domain)',
        {skipAccessCheck: true},
      ),
    ).rejects.toThrow(/Non-data image URL must be a valid http\(s\) URL/);
  });

  it('accepts valid PNG binary headers and sets inline Content-Disposition', async () => {
    const validPngBase64 = 'iVBORw0KGgo=';
    const res = await uploadImage(
      'u1',
      'u1@example.com',
      'lib1',
      'libraries/lib1/covers/valid.png',
      `data:image/png;base64,${validPngBase64}`,
      {skipAccessCheck: true},
    );

    expect(res.url).toContain(
      'https://firebasestorage.googleapis.com/v0/b/test-project.firebasestorage.app/o/',
    );
    expect(mockFileSave).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        metadata: expect.objectContaining({
          contentType: 'image/png',
          contentDisposition: 'inline',
        }),
      }),
    );
  });

  it('verifies magic bytes for PNG, JPEG, GIF, and WebP buffers', () => {
    expect(
      hasValidRasterMagicBytes(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/png',
      ),
    ).toBe(true);
    expect(
      hasValidRasterMagicBytes(
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
        'image/jpeg',
      ),
    ).toBe(true);
    expect(
      hasValidRasterMagicBytes(Buffer.from('GIF89a', 'ascii'), 'image/gif'),
    ).toBe(true);
    expect(
      hasValidRasterMagicBytes(
        Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'ascii'),
        'image/webp',
      ),
    ).toBe(true);
  });

  it('backfills cleanIsbn, dedupeKey, and searchTokens during resetMetadata sanitize', async () => {
    mockBooksSnapshotGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'legacy-book-1',
          ref: {id: 'legacy-book-1'},
          data: () => ({
            title: 'The Left Hand of Darkness',
            author: 'Ursula K. Le Guin',
            isbn: '978-0-441-47812-5',
            synopsis: 'A winter planet story',
          }),
        },
      ],
    });

    const res = await resetMetadata(
      'u1',
      'u1@example.com',
      'lib1',
      'sanitize',
      {
        skipAccessCheck: true,
      },
    );

    expect(res.count).toBe(1);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cleanIsbn: '9780441478125',
        dedupeKey: 'left hand of darkness::ursula k le guin',
        searchTokens: expect.arrayContaining([
          'left',
          'hand',
          'darkness',
          'ursula',
          'guin',
        ]),
        synopsis: 'MOCK_DELETE_FIELD',
      }),
    );
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        synopsis: 'A winter planet story',
      }),
      {merge: true},
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});
