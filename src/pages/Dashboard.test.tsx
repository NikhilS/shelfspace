import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import Dashboard from './Dashboard';
import { useAuth } from '../contexts/AuthContext';

// Mock contexts and Firebase
vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../firebase', () => ({
  db: {},
  handleFirestoreError: vi.fn(),
  OperationType: { LIST: 'LIST', CREATE: 'CREATE' },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  or: vi.fn(),
  onSnapshot: vi.fn((query, callback) => {
    callback({
      forEach: (cb: any) => cb({ id: 'lib1', data: () => ({ name: 'Test Library', ownerId: 'user1', ownerName: 'User One', sharedWith: [] }) })
    });
    return vi.fn();
  }),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  getCountFromServer: vi.fn(() => Promise.resolve({ data: () => ({ count: 5 }) })),
}));

vi.mock('../services/gemini', () => ({
  generateLibraryHeroImage: vi.fn().mockResolvedValue('http://example.com/image.png')
}));

const renderDashboard = () => {
  return render(
    <BrowserRouter>
      <Dashboard />
    </BrowserRouter>
  );
};

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to login if user is not authenticated', () => {
    (useAuth as any).mockReturnValue({ user: null });
    renderDashboard();
    // Navigate is used, so in a real router test it navigates off.
    // We check if "My Libraries" header does not render since it should return <Navigate>
    expect(screen.queryByText('My Libraries')).not.toBeInTheDocument();
  });

  it('renders libraries if user is authenticated', async () => {
    (useAuth as any).mockReturnValue({
      user: { uid: 'user1', email: 'test@example.com', displayName: 'Test User' },
      logOut: vi.fn(),
    });

    renderDashboard();
    
    // Check if the title is rendered
    expect(screen.getAllByText('My Libraries').length).toBeGreaterThan(0);

    // Check if the mock library is fetched and rendered
    await waitFor(() => {
      expect(screen.getByText('Test Library')).toBeInTheDocument();
    });
  });

  it('can open Create Library form', async () => {
    (useAuth as any).mockReturnValue({
      user: { uid: 'user1', email: 'test@example.com', displayName: 'Test User' },
      logOut: vi.fn(),
    });

    renderDashboard();
    
    const createBtn = screen.getByText('Create Library');
    fireEvent.click(createBtn);

    // Form should appear with the input
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Library Name (e.g. Private Study)')).toBeInTheDocument();
    });
  });
});
