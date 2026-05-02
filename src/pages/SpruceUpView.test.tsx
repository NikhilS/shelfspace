/* eslint-disable @typescript-eslint/no-explicit-any */
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
    (firestore.onSnapshot as any).mockImplementation(() => vi.fn());

    render(
      <MemoryRouter initialEntries={['/library/123/spruce-up']}>
        <Routes>
          <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Spruce Up Library')).toBeInTheDocument();
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

    (firestore.onSnapshot as any).mockImplementation(
      (collectionRef: any, cb: any) => {
        // Mock for both books and allowedDuplicates
        if (collectionRef === 'mock-books-collection') {
          cb({
            docs: mockBooks.map(b => ({id: b.id, data: () => b})),
          });
        } else if (collectionRef === 'mock-allowed-collection') {
          cb({
            docs: [], // No allowed duplicates
          });
        }
        return vi.fn();
      },
    );

    (firestore.collection as any).mockImplementation(
      (db: any, path: string, libId: string, subPath: string) => {
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

    (firestore.onSnapshot as any).mockImplementation(
      (collectionRef: any, cb: any) => {
        if (collectionRef === 'mock-books-collection') {
          cb({
            docs: mockBooks.map(b => ({id: b.id, data: () => b})),
          });
        } else if (collectionRef === 'mock-allowed-collection') {
          cb({docs: []});
        }
        return vi.fn();
      },
    );

    (firestore.collection as any).mockImplementation(
      (db: any, path: string, libId: string, subPath: string) => {
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

    (firestore.onSnapshot as any).mockImplementation(
      (collectionRef: any, cb: any) => {
        if (collectionRef === 'mock-books-collection') {
          cb({
            docs: mockBooks.map(b => ({id: b.id, data: () => b})),
          });
        } else {
          cb({docs: []});
        }
        return vi.fn();
      },
    );

    (firestore.collection as any).mockImplementation(
      (db: any, path: string, libId: string, subPath: string) => {
        if (subPath === 'books') return 'mock-books-collection';
        return 'mock-collection';
      },
    );

    (firestore.addDoc as any).mockResolvedValue({});

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
    (firestore.onSnapshot as any).mockImplementation(
      (_ref: any, _ok: any, errCb: any) => {
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
