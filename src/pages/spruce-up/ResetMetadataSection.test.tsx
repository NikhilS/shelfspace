import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {ResetMetadataSection} from './ResetMetadataSection';
import {toast} from 'sonner';
import {Book} from '../../types';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...path) => ({path: path.join('/')})),
  collection: vi.fn((_db, ...path) => ({path: path.join('/')})),
  getDocs: vi.fn(),
  deleteField: vi.fn(() => '__DELETE__'),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockClose = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn();
const mockSet = vi.fn();

vi.mock('../../lib/clientBulkWriter', () => {
  return {
    ClientBulkWriter: class {
      close = mockClose;
      update = mockUpdate;
      set = mockSet;
    },
  };
});

vi.mock('../../firebase', () => ({
  db: {},
  handleFirestoreError: vi.fn(),
  OperationType: {UPDATE: 'update'},
}));

describe('ResetMetadataSection', () => {
  const mockBooks: Book[] = [
    {
      id: 'book-1',
      title: 'Dune',
      addedAt: {} as any,
      addedBy: 'user-1',
      primaryGenre: 'Science Fiction',
      subgenres: ['Space Opera'],
      enrichmentStatus: {
        genre: 'completed',
      },
    } as any,
    {
      id: 'book-2',
      title: 'Clean Code',
      addedAt: {} as any,
      addedBy: 'user-1',
    } as any,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the reset metadata UI with taxonomy genres selected by default', () => {
    render(<ResetMetadataSection libraryId="lib-123" books={mockBooks} />);

    expect(
      screen.getByText('Reset Metadata & Purge Obsolete Fields'),
    ).toBeInTheDocument();
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
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith(
        'Successfully reset Taxonomy Genres across 1 book.',
      );
    });
  });

  it('handles resetting when 0 books require the reset', async () => {
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
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith(
        'Successfully reset Taxonomy Genres across 0 books.',
      );
    });
  });

  it('allows selecting another metadata category to reset', async () => {
    const geoBook: Book = {
      id: 'book-3',
      title: 'Foundation',
      addedAt: {} as any,
      addedBy: 'user-1',
      geoMetadata: {
        isNonEarth: true,
        locations: [],
        lastSyncedAt: '2025-01-01',
      },
    } as any;

    render(<ResetMetadataSection libraryId="lib-123" books={[geoBook]} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, {target: {value: 'geo'}});

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
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
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
        addedAt: {} as any,
        addedBy: 'user-1',
        synopsis: 'Massive synopsis text that should be in bookDetails',
      } as any,
    ];

    render(<ResetMetadataSection libraryId="lib-123" books={leakedBooks} />);

    expect(
      screen.getByText(/1 book contains heavy payload leaks/i),
    ).toBeInTheDocument();

    const purgeBtn = screen.getByRole('button', {
      name: /Purge Heavy Data Leaks/i,
    });
    fireEvent.click(purgeBtn);

    expect(screen.getByText('Purge & Hard-Fence Now')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {name: /Purge & Hard-Fence Now/i}),
    );

    await waitFor(() => {
      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
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
        addedAt: {} as any,
        addedBy: 'user-1',
        bookDetailsMetadata: {hasSynopsis: false},
      } as any,
    ];

    render(<ResetMetadataSection libraryId="lib-123" books={cleanBooks} />);

    expect(
      screen.getByText('Persistence Layer Fully Hardened'),
    ).toBeInTheDocument();
  });
});
