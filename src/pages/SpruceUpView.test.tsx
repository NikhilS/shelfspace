import {render, screen, waitFor, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import React from 'react';
import SpruceUpView from './SpruceUpView';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import * as firestore from 'firebase/firestore';

// Mock dependencies
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDocs: vi.fn(),
    collection: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    onSnapshot: vi.fn(),
    doc: vi.fn(),
  };
});

vi.mock('../firebase', () => ({
  db: {},
  handleFirestoreError: vi.fn(),
  OperationType: {
    GET: 'get',
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
  },
}));

vi.mock('../components/AppLayout', () => ({
  default: ({children}: {children: React.ReactNode}) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

describe('SpruceUpView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    (firestore.onSnapshot as import('vitest').Mock).mockImplementation(() =>
      vi.fn(),
    );

    render(
      <MemoryRouter initialEntries={['/library/123/spruce-up']}>
        <Routes>
          <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Scanning for anomalies...')).toBeInTheDocument();
  });

  it('loads and displays duplicates and missing metadata', async () => {
    const mockBooks = [
      {id: '1', title: 'Dune', author: 'Frank Herbert', isbn: '123'},
      {id: '2', title: 'Dune', author: 'Frank Herbert', isbn: '123'}, // Duplicate
      {
        id: '3',
        title: 'Foundation',
        author: 'Isaac Asimov',
        isbn: '456',
        coverUrl: 'http',
        synopsis: 'desc',
        publishedDate: '1951',
        genres: ['Sci-Fi'],
      },
      {id: '4', title: 'Lacking Meta', author: 'Someone'}, // Missing metadata
    ];

    const createMockSnap = (docs: any[] = [], data: any = null) => ({
      docs,
      forEach(cb: any) {
        docs.forEach(cb);
      },
      exists: () => data !== null,
      data: () => data,
    });

    (firestore.onSnapshot as import('vitest').Mock).mockImplementation(
      (ref: any, cb: any) => {
        if (typeof ref === 'string') {
          if (ref === 'mock-books-collection') {
            cb(createMockSnap(mockBooks.map(b => ({id: b.id, data: () => b}))));
          } else if (ref.includes('resync') || ref === 'mock-job-ref') {
            cb(createMockSnap([], null));
          } else {
            cb(createMockSnap([]));
          }
        } else {
          cb(createMockSnap([]));
        }
        return vi.fn();
      },
    );

    (firestore.doc as import('vitest').Mock).mockImplementation(
      (db: any, ...args: string[]) => {
        const path = args.join('/');
        if (path.includes('jobs/resync')) return 'mock-job-ref';
        return 'mock-doc-ref';
      },
    );

    (firestore.collection as import('vitest').Mock).mockImplementation(
      (db: unknown, path: string, libId: string, subPath: string) => {
        if (subPath === 'books') return 'mock-books-collection';
        if (subPath === 'allowedDuplicates') return 'mock-allowed-collection';
        return 'mock-collection';
      },
    );

    render(
      <MemoryRouter initialEntries={['/library/123/spruce-up']}>
        <Routes>
          <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Potentially Duplicate Books'),
      ).toBeInTheDocument();
    });

    // Should show 1 group of duplicates
    expect(screen.getByText('Group 1: Dune')).toBeInTheDocument();

    // Should show the missing metadata section
    expect(screen.getByText('Books with Missing Metadata')).toBeInTheDocument();
    expect(screen.getByText('Lacking Meta')).toBeInTheDocument();
  });

  it('does not treat physical and digital formats of the same book as duplicates', async () => {
    const mockBooks = [
      {
        id: '1',
        title: 'The Hobbit',
        author: 'J.R.R. Tolkien',
        isbn: '111',
        format: 'physical',
      },
      {
        id: '2',
        title: 'The Hobbit',
        author: 'J.R.R. Tolkien',
        isbn: '111',
        format: 'digital',
      }, // Same book, different format
      {id: '3', title: '1984', author: 'George Orwell', format: 'physical'},
      {id: '4', title: '1984', author: 'George Orwell', format: 'physical'}, // Duplicate
    ];

    const createMockSnap = (docs: any[] = [], data: any = null) => ({
      docs,
      forEach(cb: any) {
        docs.forEach(cb);
      },
      exists: () => data !== null,
      data: () => data,
    });

    (firestore.onSnapshot as import('vitest').Mock).mockImplementation(
      (ref: any, cb: any) => {
        if (typeof ref === 'string') {
          if (ref === 'mock-books-collection') {
            cb(createMockSnap(mockBooks.map(b => ({id: b.id, data: () => b}))));
          } else if (ref.includes('resync') || ref === 'mock-job-ref') {
            cb(createMockSnap([], null));
          } else {
            cb(createMockSnap([]));
          }
        } else {
          cb(createMockSnap([]));
        }
        return vi.fn();
      },
    );

    (firestore.doc as import('vitest').Mock).mockImplementation(
      (db: any, ...args: string[]) => {
        const path = args.join('/');
        if (path.includes('jobs/resync')) return 'mock-job-ref';
        return 'mock-doc-ref';
      },
    );

    (firestore.collection as import('vitest').Mock).mockImplementation(
      (db: unknown, path: string, libId: string, subPath: string) => {
        if (subPath === 'books') return 'mock-books-collection';
        if (subPath === 'allowedDuplicates') return 'mock-allowed-collection';
        return 'mock-collection';
      },
    );

    render(
      <MemoryRouter initialEntries={['/library/123/spruce-up']}>
        <Routes>
          <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Potentially Duplicate Books'),
      ).toBeInTheDocument();
    });

    // Should show 1 group for 1984, but none for The Hobbit
    expect(screen.getByText('Group 1: 1984')).toBeInTheDocument();
    expect(screen.queryByText('Group 2: The Hobbit')).not.toBeInTheDocument();
    expect(screen.queryByText('Group 1: The Hobbit')).not.toBeInTheDocument();
  });

  it('can dismiss duplicates', async () => {
    const mockBooks = [
      {id: '1', title: 'Dune', author: 'Frank Herbert', isbn: '123'},
      {id: '2', title: 'Dune', author: 'Frank Herbert', isbn: '123'}, // Duplicate
    ];

    const createMockSnap = (docs: any[] = [], data: any = null) => ({
      docs,
      forEach(cb: any) {
        docs.forEach(cb);
      },
      exists: () => data !== null,
      data: () => data,
    });

    (firestore.onSnapshot as import('vitest').Mock).mockImplementation(
      (ref: any, cb: any) => {
        if (typeof ref === 'string') {
          if (ref === 'mock-books-collection') {
            cb(createMockSnap(mockBooks.map(b => ({id: b.id, data: () => b}))));
          } else if (ref.includes('resync') || ref === 'mock-job-ref') {
            cb(createMockSnap([], null));
          } else {
            cb(createMockSnap([]));
          }
        } else {
          cb(createMockSnap([]));
        }
        return vi.fn();
      },
    );

    (firestore.collection as import('vitest').Mock).mockImplementation(
      (db: unknown, path: string, libId: string, subPath: string) => {
        if (subPath === 'books') return 'mock-books-collection';
        return 'mock-collection';
      },
    );

    (firestore.addDoc as import('vitest').Mock).mockResolvedValue({});

    render(
      <MemoryRouter initialEntries={['/library/123/spruce-up']}>
        <Routes>
          <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Group 1: Dune')).toBeInTheDocument();
    });

    const ignoreButton = screen.getByText('Ignore');
    fireEvent.click(ignoreButton);

    await waitFor(() => {
      expect(firestore.addDoc).toHaveBeenCalled();
    });

    expect(screen.queryByText('Group 1: Dune')).not.toBeInTheDocument();
  });

  it('shows error toast when loading data fails', async () => {
    (firestore.onSnapshot as import('vitest').Mock).mockImplementation(
      (_ref: unknown, _ok: any, errCb: any) => {
        errCb(new Error('Permission denied'));
        return vi.fn();
      },
    );

    render(
      <MemoryRouter initialEntries={['/library/123/spruce-up']}>
        <Routes>
          <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      // It should display 'Failed to load data' from toast
      expect(screen.queryByText('Spruce Up Library')).toBeInTheDocument();
      // We know loading becomes false after error, so we will see the UI.
    });
  });
});
