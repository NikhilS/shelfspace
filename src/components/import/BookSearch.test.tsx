import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {BookSearch} from './BookSearch';
import {trpcVanilla} from '../../lib/trpc';

vi.mock('../../lib/trpc', () => ({
  trpcVanilla: {
    readingTracker: {
      searchUnified: {
        query: vi.fn(),
      },
    },
    metadata: {
      searchByIsbn: {
        mutate: vi.fn(),
      },
      searchByTitle: {
        mutate: vi.fn(),
      },
    },
  },
}));

describe('BookSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles empty or nullish unified search responses gracefully and renders actionable empty state', async () => {
    vi.mocked(trpcVanilla.readingTracker.searchUnified.query).mockResolvedValue(
      {
        libraryMatches: null as unknown as [],
        externalMatches: null as unknown as [],
      },
    );

    const onOpenAdvanced = vi.fn();

    render(
      <BookSearch
        existingBooks={[]}
        allowDuplicates={true}
        onAdd={vi.fn()}
        mode="reading"
        onOpenAdvanced={onOpenAdvanced}
      />,
    );

    const input = screen.getByPlaceholderText(
      /Search by title, author, or ISBN/i,
    );
    fireEvent.change(input, {target: {value: 'Nonexistent Tome'}});
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('book-search-empty-state')).toBeInTheDocument();
    });

    expect(
      screen.getByText('No Books Found for "Nonexistent Tome"'),
    ).toBeInTheDocument();

    const manualBtn = screen.getByTestId('book-search-empty-manual-btn');
    fireEvent.click(manualBtn);
    expect(onOpenAdvanced).toHaveBeenCalledTimes(1);

    const clearBtn = screen.getByRole('button', {name: /Clear Search/i});
    fireEvent.click(clearBtn);
    expect(
      screen.queryByTestId('book-search-empty-state'),
    ).not.toBeInTheDocument();
  });
});
