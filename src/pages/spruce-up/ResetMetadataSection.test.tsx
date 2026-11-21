import React from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {ResetMetadataSection} from './ResetMetadataSection';
import {toast} from 'sonner';
import {
  selectLibraryBooks,
  useEntityCacheStore,
} from '../../stores/entityCacheStore';
import type {Book} from '../../types';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockUseOnlineStatus = vi.fn(() => true);

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockUseOnlineStatus(),
}));

const mockInvalidateBookList = vi.fn();
const mockInvalidateLibraryGet = vi.fn();
const mockInvalidateGetShelf = vi.fn();
const mockInvalidateUnreadBooks = vi.fn();

const mockResetMetadata = vi
  .fn<
    (input: {
      libraryId: string;
      metadataType: string;
    }) => Promise<{count: number}>
  >()
  .mockImplementation(({metadataType}) => {
    if (
      metadataType === 'genre' ||
      metadataType === 'geo' ||
      metadataType === 'series'
    ) {
      return Promise.resolve({count: 1});
    }
    return Promise.resolve({count: 0});
  });

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      book: {list: {invalidate: mockInvalidateBookList}},
      library: {get: {invalidate: mockInvalidateLibraryGet}},
      readingTracker: {
        getShelf: {invalidate: mockInvalidateGetShelf},
        getUnreadLibraryBooks: {invalidate: mockInvalidateUnreadBooks},
      },
    }),
  },
  trpcVanilla: {
    library: {
      resetMetadata: {
        mutate: vi.fn((input: {libraryId: string; metadataType: string}) =>
          mockResetMetadata(input),
        ),
      },
    },
  },
}));

function makeBook(overrides: Partial<Book> & {id: string}): Book {
  return {
    title: overrides.title || `Book ${overrides.id}`,
    author: overrides.author || 'Author',
    isbn: overrides.isbn || '',
    addedAt: '2026-01-01T00:00:00.000Z',
    addedBy: 'user-1',
    ...overrides,
  };
}

describe('ResetMetadataSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOnlineStatus.mockReturnValue(true);
    useEntityCacheStore.getState().clearAllEntities();
  });

  it('renders the Reset Book Details card with Genres selected by default and no legacy storage/migration cards', () => {
    render(<ResetMetadataSection libraryId="lib-123" />);

    expect(screen.getByText('Reset Book Details')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: /Reset Genres/i}),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Refresh Catalog Indexes/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Optimize Library Storage/i),
    ).not.toBeInTheDocument();
  });

  it('resets genres across matching books via library.resetMetadata and reconciles useEntityCacheStore', async () => {
    const sampleBooks: Book[] = [
      makeBook({
        id: 'b-1',
        primaryGenre: 'Science Fiction',
        subgenres: ['Space Opera'],
        enrichmentStatus: {genre: 'completed'},
      }),
      makeBook({
        id: 'b-2',
        primaryGenre: '',
      }),
    ];
    useEntityCacheStore.getState().hydrateLibraryBooks('lib-123', sampleBooks);

    render(<ResetMetadataSection libraryId="lib-123" books={sampleBooks} />);

    expect(
      screen.getByTestId('reset-metadata-affected-count'),
    ).toHaveTextContent('1 of 2 books currently include Genres');

    const resetBtn = screen.getByRole('button', {
      name: /Reset Genres/i,
    });
    fireEvent.click(resetBtn);

    expect(screen.getByText('Confirm Detail Reset')).toBeInTheDocument();
    expect(
      screen.getByText(/from 1 book in this library/i),
    ).toBeInTheDocument();

    const confirmBtns = screen.getAllByRole('button', {
      name: /Reset Genres/i,
    });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockResetMetadata).toHaveBeenCalledWith({
        libraryId: 'lib-123',
        metadataType: 'genre',
      });
      expect(toast.success).toHaveBeenCalledWith('Reset Genres across 1 book.');
    });
    expect(mockInvalidateGetShelf).toHaveBeenCalledTimes(1);
    expect(mockInvalidateUnreadBooks).toHaveBeenCalledTimes(1);

    const cachedBooks = selectLibraryBooks(
      useEntityCacheStore.getState(),
      'lib-123',
    );
    expect(cachedBooks[0]?.primaryGenre).toBeUndefined();
    expect(cachedBooks[0]?.enrichmentStatus?.genre).toBeUndefined();

    await waitFor(() => {
      expect(
        screen.queryByText('Confirm Detail Reset'),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Missing Details/i)).toBeInTheDocument();
  });

  it('shows live tabular affected book count and disables trigger when 0 books include the selected detail', async () => {
    const sampleBooks: Book[] = [
      makeBook({id: 'b-1', primaryGenre: 'History'}),
      makeBook({id: 'b-2', primaryGenre: 'Literary Fiction'}),
      makeBook({id: 'b-3'}),
    ];

    render(<ResetMetadataSection libraryId="lib-123" books={sampleBooks} />);

    expect(
      screen.getByTestId('reset-metadata-affected-count'),
    ).toHaveTextContent('2 of 3 books currently include Genres');
    expect(
      screen.getByRole('button', {name: /Reset Genres/i}),
    ).not.toBeDisabled();

    const select = screen.getByRole('combobox');
    fireEvent.pointerDown(select, {pointerType: 'mouse', button: 0});
    const eraOption = await screen.findByText('Historical Eras');
    fireEvent.click(eraOption);

    expect(
      screen.getByTestId('reset-metadata-affected-count'),
    ).toHaveTextContent('No books currently include Historical Eras');
    expect(
      screen.getByRole('button', {name: /Reset Historical Eras/i}),
    ).toBeDisabled();
  });

  it('disables the reset trigger with Unavailable while offline tooltip when offline', () => {
    mockUseOnlineStatus.mockReturnValue(false);
    const sampleBooks: Book[] = [makeBook({id: 'b-1', primaryGenre: 'Sci-Fi'})];

    render(<ResetMetadataSection libraryId="lib-123" books={sampleBooks} />);

    const resetBtn = screen.getByRole('button', {name: /Reset Genres/i});
    expect(resetBtn).toBeDisabled();
    expect(resetBtn).toHaveAttribute('title', 'Unavailable while offline');
  });

  it('handles resetting when 0 books require the reset and books prop is omitted', async () => {
    mockResetMetadata.mockResolvedValueOnce({count: 0});
    render(<ResetMetadataSection libraryId="lib-123" />);

    const resetBtn = screen.getByRole('button', {
      name: /Reset Genres/i,
    });
    fireEvent.click(resetBtn);

    const confirmBtns = screen.getAllByRole('button', {
      name: /Reset Genres/i,
    });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockResetMetadata).toHaveBeenCalledWith({
        libraryId: 'lib-123',
        metadataType: 'genre',
      });
      expect(toast.success).toHaveBeenCalledWith(
        'Reset Genres across 0 books.',
      );
    });
  });

  it('allows selecting another detail category including Series Info to reset', async () => {
    render(<ResetMetadataSection libraryId="lib-123" />);

    const select = screen.getByRole('combobox');
    fireEvent.pointerDown(select, {pointerType: 'mouse', button: 0});
    const option = await screen.findByText('Series Info');
    fireEvent.click(option);

    const resetBtn = screen.getByRole('button', {
      name: /Reset Series Info/i,
    });
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);

    const confirmBtns = screen.getAllByRole('button', {
      name: /Reset Series Info/i,
    });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockResetMetadata).toHaveBeenCalledWith({
        libraryId: 'lib-123',
        metadataType: 'series',
      });
      expect(toast.success).toHaveBeenCalledWith(
        'Reset Series Info across 1 book.',
      );
    });
  });
});
