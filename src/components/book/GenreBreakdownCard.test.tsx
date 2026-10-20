import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import {GenreBreakdownCard} from './GenreBreakdownCard';

describe('GenreBreakdownCard', () => {
  it('aggregates, sorts, and renders top genres with volume counts', () => {
    const onSelectGenre = vi.fn();
    render(
      <GenreBreakdownCard
        books={[
          {primaryGenre: 'Science Fiction'},
          {primaryGenre: 'Science Fiction'},
          {primaryGenre: 'Philosophy'},
        ]}
        eyebrow="Books Read by Genre"
        headerRight="3 volumes read"
        onSelectGenre={onSelectGenre}
      />,
    );

    expect(screen.getByText('Books Read by Genre')).toBeInTheDocument();
    expect(screen.getByText('3 volumes read')).toBeInTheDocument();
    expect(screen.getByText('Science Fiction')).toBeInTheDocument();
    expect(screen.getByText('2 vols')).toBeInTheDocument();
    expect(screen.getByText('Philosophy')).toBeInTheDocument();
    expect(screen.getByText('1 vol')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Science Fiction'));
    expect(onSelectGenre).toHaveBeenCalledWith('Science Fiction');
  });

  it('renders custom empty message when no genres exist', () => {
    render(
      <GenreBreakdownCard
        books={[]}
        emptyMessage="No finished books categorized yet."
      />,
    );

    expect(
      screen.getByText('No finished books categorized yet.'),
    ).toBeInTheDocument();
  });
});
