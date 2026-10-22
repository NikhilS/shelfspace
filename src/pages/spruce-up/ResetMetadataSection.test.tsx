import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {ResetMetadataSection} from './ResetMetadataSection';
import {toast} from 'sonner';
import {Book} from '../../types';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockResetMetadata = vi.fn().mockImplementation(({metadataType}) => {
  if (metadataType === 'genre') {
    return Promise.resolve({success: true, count: 1});
  }
  if (metadataType === 'geo') {
    return Promise.resolve({success: true, count: 1});
  }
  if (metadataType === 'sanitize') {
    return Promise.resolve({success: true, count: 1});
  }
  return Promise.resolve({success: true, count: 0});
});

vi.mock('../../lib/trpc', () => ({
  trpcVanilla: {
    library: {
      resetMetadata: {
        mutate: vi.fn((...args) => mockResetMetadata(...args)),
      },
    },
  },
}));

describe('ResetMetadataSection', () => {
  const mockBooks: Book[] = [
    {
      id: 'book-1',
      title: 'Dune',
      addedAt: {} as unknown as Book['addedAt'],
      addedBy: 'user-1',
      primaryGenre: 'Science Fiction',
      subgenres: ['Space Opera'],
      enrichmentStatus: {
        genre: 'completed',
      },
    } as unknown as Book,
    {
      id: 'book-2',
      title: 'Clean Code',
      addedAt: {} as unknown as Book['addedAt'],
      addedBy: 'user-1',
    } as unknown as Book,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the reset metadata UI with taxonomy genres selected by default', () => {
    render(<ResetMetadataSection libraryId="lib-123" books={mockBooks} />);

    expect(screen.getByText('Reset Book Details')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: /Reset Taxonomy Genres/i}),
    ).toBeInTheDocument();
  });

  it('successfully resets taxonomy genres across matching books using client bulk writer', async () => {
    render(<ResetMetadataSection libraryId="lib-123" books={mockBooks} />);

    // Click to open confirmation dialog
    const resetBtn = screen.getByRole('button', {
      name: /Reset Taxonomy Genres/i,
    });
    fireEvent.click(resetBtn);

    // Dialog should open
    expect(screen.getByText('Confirm Metadata Reset')).toBeInTheDocument();

    // Click confirm in the dialog
    const confirmBtns = screen.getAllByRole('button', {
      name: /Reset Taxonomy Genres/i,
    });
    // The dialog's button is the last one
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockResetMetadata).toHaveBeenCalledWith({
        libraryId: 'lib-123',
        metadataType: 'genre',
      });
      expect(toast.success).toHaveBeenCalledWith(
        'Successfully reset Taxonomy Genres across 1 book.',
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByText('Confirm Metadata Reset'),
      ).not.toBeInTheDocument();
    });
  });

  it('handles resetting when 0 books require the reset', async () => {
    mockResetMetadata.mockResolvedValueOnce({success: true, count: 0});
    // Only books with no genre metadata
    const booksWithoutGenre = [mockBooks[1]];
    render(
      <ResetMetadataSection libraryId="lib-123" books={booksWithoutGenre} />,
    );

    const resetBtn = screen.getByRole('button', {
      name: /Reset Taxonomy Genres/i,
    });
    fireEvent.click(resetBtn);

    const confirmBtns = screen.getAllByRole('button', {
      name: /Reset Taxonomy Genres/i,
    });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockResetMetadata).toHaveBeenCalledWith({
        libraryId: 'lib-123',
        metadataType: 'genre',
      });
      expect(toast.success).toHaveBeenCalledWith(
        'Successfully reset Taxonomy Genres across 0 books.',
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByText('Confirm Metadata Reset'),
      ).not.toBeInTheDocument();
    });
  });

  it('allows selecting another metadata category to reset', async () => {
    const geoBook: Book = {
      id: 'book-3',
      title: 'Foundation',
      addedAt: {} as unknown as Book['addedAt'],
      addedBy: 'user-1',
      geoMetadata: {
        isNonEarth: true,
        locations: [],
        lastSyncedAt: '2025-01-01',
      },
    } as unknown as Book;

    render(<ResetMetadataSection libraryId="lib-123" books={[geoBook]} />);

    const select = screen.getByRole('combobox');
    fireEvent.pointerDown(select, {pointerType: 'mouse', button: 0});
    const option = await screen.findByText('Settings & Places (Geo Metadata)');
    fireEvent.click(option);

    const resetBtn = screen.getByRole('button', {
      name: /Reset Settings & Places/i,
    });
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);

    const confirmBtns = screen.getAllByRole('button', {
      name: /Reset Settings & Places/i,
    });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockResetMetadata).toHaveBeenCalledWith({
        libraryId: 'lib-123',
        metadataType: 'geo',
      });
      expect(toast.success).toHaveBeenCalledWith(
        'Successfully reset Settings & Places across 1 book.',
      );
    });
  });

  it('detects heavy leaks, renders alert banner, and triggers purge routine', async () => {
    const leakedBooks: Book[] = [
      {
        id: 'book-leaked',
        title: 'Leaked Book',
        addedAt: {} as unknown as Book['addedAt'],
        addedBy: 'user-1',
        synopsis: 'Massive synopsis text that should be in bookDetails',
      } as unknown as Book,
    ];

    render(<ResetMetadataSection libraryId="lib-123" books={leakedBooks} />);

    expect(
      screen.getByText(/1 book can be optimized for faster loading/i),
    ).toBeInTheDocument();

    const purgeBtn = screen.getByRole('button', {
      name: /Optimize Storage/i,
    });
    fireEvent.click(purgeBtn);

    expect(screen.getByText('Optimize Now')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /Optimize Now/i}));

    await waitFor(() => {
      expect(mockResetMetadata).toHaveBeenCalledWith({
        libraryId: 'lib-123',
        metadataType: 'sanitize',
      });
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Sanitized 1 books'),
      );
    });
  });

  it('renders hardened confirmation when no books contain leaks', () => {
    const cleanBooks: Book[] = [
      {
        id: 'book-clean',
        title: 'Clean Book',
        addedAt: {} as unknown as Book['addedAt'],
        addedBy: 'user-1',
        bookDetailsMetadata: {hasSynopsis: false},
      } as unknown as Book,
    ];

    render(<ResetMetadataSection libraryId="lib-123" books={cleanBooks} />);

    expect(
      screen.getByText('Library Storage Is Optimized'),
    ).toBeInTheDocument();
  });
});
