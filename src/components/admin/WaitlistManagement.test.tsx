import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {WaitlistManagement} from './WaitlistManagement';
import {WaitlistEntry} from '../../schemas/waitlist';

const mockMutateReview = vi.fn();
const mockRefetch = vi.fn();
const mockInvalidate = vi.fn();

let mockEntries: WaitlistEntry[] = [];
let mockIsLoading = false;
let mockIsFetching = false;

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      auth: {
        listWaitlist: {invalidate: mockInvalidate},
        listAllowlist: {invalidate: mockInvalidate},
      },
    }),
    useContext: () => ({
      auth: {
        listWaitlist: {invalidate: mockInvalidate},
        listAllowlist: {invalidate: mockInvalidate},
      },
    }),
    auth: {
      listWaitlist: {
        useQuery: (input?: {status?: string}) => {
          // If query is for 'all', return all entries
          if (input?.status === 'all') {
            return {
              data: {entries: mockEntries},
              isLoading: mockIsLoading,
              isFetching: mockIsFetching,
              refetch: mockRefetch,
            };
          }
          const filtered = input?.status
            ? mockEntries.filter(e => e.status === input.status)
            : mockEntries;
          return {
            data: {entries: filtered},
            isLoading: mockIsLoading,
            isFetching: mockIsFetching,
            refetch: mockRefetch,
          };
        },
      },
      reviewWaitlistEntry: {
        useMutation: (opts?: {
          onSuccess?: (
            res: unknown,
            vars: {email: string; action: string},
          ) => void;
          onError?: (err: Error, vars: {email: string; action: string}) => void;
        }) => ({
          isPending: false,
          mutateAsync: async (vars: {
            email: string;
            action: 'approve' | 'reject';
          }) => {
            mockMutateReview(vars);
            opts?.onSuccess?.({success: true}, vars);
            return {success: true};
          },
        }),
      },
    },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('WaitlistManagement', () => {
  const sampleEntries: WaitlistEntry[] = [
    {
      email: 'alice@example.com',
      displayName: 'Alice Archivist',
      photoURL: 'https://example.com/alice.jpg',
      status: 'pending',
      requestedAt: '2026-09-21T08:00:00.000Z',
    },
    {
      email: 'bob@example.com',
      displayName: 'Bob Bibliophile',
      photoURL: null,
      status: 'pending',
      requestedAt: '2026-09-21T09:00:00.000Z',
    },
    {
      email: 'carol@example.com',
      displayName: 'Carol Collector',
      photoURL: null,
      status: 'approved',
      requestedAt: '2026-09-20T10:00:00.000Z',
      reviewedAt: '2026-09-20T11:00:00.000Z',
      reviewedBy: 'admin@bookish.internal',
    },
    {
      email: 'dan@example.com',
      displayName: 'Dan Defer',
      photoURL: null,
      status: 'rejected',
      requestedAt: '2026-09-19T10:00:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLoading = false;
    mockIsFetching = false;
    mockEntries = [...sampleEntries];
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders stats counters accurately', () => {
    const {container} = render(<WaitlistManagement />);

    expect(screen.getByText('Total In Queue')).toBeInTheDocument();
    expect(container.querySelector('#waitlist-stat-all')).toHaveTextContent('4');
    expect(
      container.querySelector('#waitlist-stat-pending'),
    ).toHaveTextContent('2');
    expect(
      container.querySelector('#waitlist-stat-approved'),
    ).toHaveTextContent('1');
    expect(
      container.querySelector('#waitlist-stat-rejected'),
    ).toHaveTextContent('1');
  });

  it('renders applicant rows with names, emails, and status badges', () => {
    render(<WaitlistManagement />);

    expect(screen.getByText('Alice Archivist')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('Bob Bibliophile')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText('Carol Collector')).toBeInTheDocument();
    expect(screen.getByText('carol@example.com')).toBeInTheDocument();
  });

  it('allows filtering applicants by status tab', () => {
    const {container} = render(<WaitlistManagement />);

    // Click "Pending (2)" tab
    const pendingTab = container.querySelector('#waitlist-tab-pending');
    expect(pendingTab).toBeInTheDocument();
    fireEvent.click(pendingTab!);

    expect(screen.getByText('Alice Archivist')).toBeInTheDocument();
    expect(screen.getByText('Bob Bibliophile')).toBeInTheDocument();
    expect(screen.queryByText('Carol Collector')).not.toBeInTheDocument();
  });

  it('filters applicant rows by search query', () => {
    render(<WaitlistManagement />);

    const searchInput = screen.getByPlaceholderText(/filter by name or email/i);
    fireEvent.change(searchInput, {target: {value: 'alice'}});

    expect(screen.getByText('Alice Archivist')).toBeInTheDocument();
    expect(screen.queryByText('Bob Bibliophile')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol Collector')).not.toBeInTheDocument();
  });

  it('allows administrator to approve a pending applicant', async () => {
    const {container} = render(<WaitlistManagement />);

    const approveAliceBtn = container.querySelector(
      '#waitlist-approve-alice\\@example\\.com',
    );
    expect(approveAliceBtn).toBeInTheDocument();

    fireEvent.click(approveAliceBtn!);

    await waitFor(() => {
      expect(mockMutateReview).toHaveBeenCalledWith({
        email: 'alice@example.com',
        action: 'approve',
      });
      expect(mockInvalidate).toHaveBeenCalled();
    });
  });

  it('allows administrator to reject a pending applicant', async () => {
    const {container} = render(<WaitlistManagement />);

    const rejectAliceBtn = container.querySelector(
      '#waitlist-reject-alice\\@example\\.com',
    );
    expect(rejectAliceBtn).toBeInTheDocument();

    fireEvent.click(rejectAliceBtn!);

    await waitFor(() => {
      expect(mockMutateReview).toHaveBeenCalledWith({
        email: 'alice@example.com',
        action: 'reject',
      });
      expect(mockInvalidate).toHaveBeenCalled();
    });
  });

  it('allows administrator to admit a previously rejected applicant', async () => {
    render(<WaitlistManagement />);

    const admitBtn = screen.getByRole('button', {name: /admit to catalog/i});
    expect(admitBtn).toBeInTheDocument();

    fireEvent.click(admitBtn);

    await waitFor(() => {
      expect(mockMutateReview).toHaveBeenCalledWith({
        email: 'dan@example.com',
        action: 'approve',
      });
    });
  });

  it('supports batch approval of all pending applicants', async () => {
    render(<WaitlistManagement />);

    const batchBtn = screen.getByRole('button', {
      name: /approve all pending \(2\)/i,
    });
    expect(batchBtn).toBeInTheDocument();

    fireEvent.click(batchBtn);

    await waitFor(() => {
      expect(mockMutateReview).toHaveBeenCalledTimes(2);
      expect(mockMutateReview).toHaveBeenCalledWith({
        email: 'alice@example.com',
        action: 'approve',
      });
      expect(mockMutateReview).toHaveBeenCalledWith({
        email: 'bob@example.com',
        action: 'approve',
      });
    });
  });

  it('copies applicant email when copy icon button is clicked', () => {
    render(<WaitlistManagement />);

    const copyButtons = screen.getAllByTitle(/copy email address/i);
    expect(copyButtons.length).toBeGreaterThan(0);

    fireEvent.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'alice@example.com',
    );
  });
});
