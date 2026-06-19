import {render, screen, waitFor, fireEvent} from '@testing-library/react';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from 'vitest';
import React from 'react';
import SpruceUpView from './SpruceUpView';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {getTestEnv, cleanupFirestore} from '../mocks/firebase-test-utils';
import {doc, setDoc, collection, Firestore} from 'firebase/firestore';

// Mock dependencies to use the real Firebase Emulator
vi.mock('../firebase', async () => {
  const {getTestEnv} = await import('../mocks/firebase-test-utils');
  const env = await getTestEnv();
  const db = env.authenticatedContext('user123').firestore();
  return {
    db,
    auth: {currentUser: {uid: 'user123', email: 'test@example.com'}},
    storage: {},
    handleFirestoreError: vi.fn(),
    OperationType: {
      GET: 'get',
      CREATE: 'create',
      UPDATE: 'update',
      DELETE: 'delete',
    },
  };
});

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({
    user: {uid: 'user123', email: 'test@example.com'},
  }),
}));

vi.mock('../components/AppLayout', () => ({
  default: ({children}: {children: React.ReactNode}) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

describe.skip('SpruceUpView', () => {
  let testDb: any;

  beforeAll(async () => {
    const env = await getTestEnv();
    testDb = env.authenticatedContext('user123').firestore();
  });

  afterEach(async () => {
    await cleanupFirestore();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    const env = await getTestEnv();
    await env.cleanup();
  });

  it('renders loading state initially', async () => {
    render(
      <MemoryRouter initialEntries={['/library/123/spruce-up']}>
        <Routes>
          <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
        </Routes>
      </MemoryRouter>,
    );
    // Since Firebase data comes relatively fast locally, it might flash the loading state.
    expect(screen.getByText('Shelf Care')).toBeInTheDocument();
  });

  it('loads and displays duplicates and missing metadata', async () => {
    const libId = '123';
    const booksRef = collection(testDb, 'libraries', libId, 'books');

    // Seed library permission for read access
    await setDoc(doc(testDb, 'libraries', libId), {
      name: 'Test Library',
      ownerId: 'user123',
      ownerName: 'Test',
      createdAt: new Date(),
    });

    await setDoc(doc(booksRef, '1'), {
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '123',
      addedAt: new Date(),
      addedBy: 'u1',
    });
    await setDoc(doc(booksRef, '2'), {
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '123',
      addedAt: new Date(),
      addedBy: 'u1',
    }); // Duplicate
    await setDoc(doc(booksRef, '3'), {
      title: 'Foundation',
      author: 'Isaac Asimov',
      isbn: '456',
      coverUrl: 'http',
      synopsis: 'desc',
      publishedDate: '1951',
      genres: ['Sci-Fi'],
      addedAt: new Date(),
      addedBy: 'u1',
    });
    // Missing metadata
    await setDoc(doc(booksRef, '4'), {
      title: 'Lacking Meta',
      author: 'Someone',
      addedAt: new Date(),
      addedBy: 'u1',
    });

    render(
      <MemoryRouter initialEntries={[`/library/${libId}/spruce-up`]}>
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

    expect(screen.getByText('Group 1: Dune')).toBeInTheDocument();
    expect(screen.getByText('Targeted Bulk Enrichment')).toBeInTheDocument();
    expect(screen.getByText('Lacking Meta')).toBeInTheDocument();
  });

  it('filters books by missing metadata correctly', async () => {
    const libId = '123';

    await setDoc(doc(testDb, 'libraries', libId), {
      name: 'Test Library',
      ownerId: 'user123',
      ownerName: 'Test',
      createdAt: new Date(),
    });

    const booksRef = collection(testDb, 'libraries', libId, 'books');

    await setDoc(doc(booksRef, '1'), {
      title: 'Book 1',
      author: 'A1',
      geoMetadata: {locations: ['London']},
      addedAt: new Date(),
      addedBy: 'u1',
    });
    await setDoc(doc(booksRef, '2'), {
      title: 'Book 2',
      author: 'A2',
      addedAt: new Date(),
      addedBy: 'u1',
    }); // Missing geo

    render(
      <MemoryRouter initialEntries={[`/library/${libId}/spruce-up`]}>
        <Routes>
          <Route path="/library/:id/spruce-up" element={<SpruceUpView />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Targeted Bulk Enrichment')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Book 1')).toBeInTheDocument();
      expect(screen.getByText('Book 2')).toBeInTheDocument();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, {target: {value: 'geoMetadata'}});

    await waitFor(() => {
      expect(screen.queryByText('Book 1')).not.toBeInTheDocument();
      expect(screen.getByText('Book 2')).toBeInTheDocument();
    });
  });
});
