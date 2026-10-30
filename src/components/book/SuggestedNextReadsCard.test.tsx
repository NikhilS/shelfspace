import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {SuggestedNextReadsCard} from './SuggestedNextReadsCard';
import type {BookRecommendationItem} from '../../schemas/recommendation';

const sampleRecommendations: BookRecommendationItem[] = [
  {
    id: 'rec-shelf-1',
    title: 'The Dispossessed',
    author: 'Ursula K. Le Guin',
    primaryGenre: 'Science Fiction',
    source: 'shelf',
    reason: 'An ambiguous utopia across twin worlds.',
    matchTag: 'From Your Libraries · Shared Family Library',
    libraryId: 'lib-2',
    libraryName: 'Shared Family Library',
    bookId: 'b-lib2-unread',
    readingStatus: 'unset',
  },
  {
    id: 'rec-ai-1',
    title: 'Hyperion',
    author: 'Dan Simmons',
    isbn: '9780553283686',
    primaryGenre: 'Science Fiction',
    source: 'ai_curator',
    reason: 'Echoes the sweeping ecological and political scale of Dune.',
    matchTag: 'Because you loved Dune',
  },
];

describe('SuggestedNextReadsCard', () => {
  it('renders recommendation slide, stepper, and category filter tabs', () => {
    const onFilterChange = vi.fn();
    const onRefresh = vi.fn();

    render(
      <MemoryRouter>
        <SuggestedNextReadsCard
          recommendations={sampleRecommendations}
          activeFilter="all"
          onFilterChange={onFilterChange}
          onRefresh={onRefresh}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('suggested-next-reads-card')).toBeInTheDocument();
    expect(screen.getByText('Suggested Next Reads')).toBeInTheDocument();
    expect(screen.getByTestId('suggestions-step-indicator')).toHaveTextContent(
      '1 / 2',
    );
    expect(screen.getAllByText('The Dispossessed').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', {name: 'On Your Shelves'}));
    expect(onFilterChange).toHaveBeenCalledWith('from_shelves');
  });

  it('invokes status and want-to-read handlers when action buttons are clicked', async () => {
    const onUpdateShelfBookStatus = vi.fn().mockResolvedValue(undefined);
    const onAddExternalToWantToRead = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <SuggestedNextReadsCard
          recommendations={[sampleRecommendations[0]]}
          activeFilter="from_shelves"
          onFilterChange={vi.fn()}
          onRefresh={vi.fn()}
          onUpdateShelfBookStatus={onUpdateShelfBookStatus}
          onAddExternalToWantToRead={onAddExternalToWantToRead}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', {name: /Start Reading/i}));
    await waitFor(() => {
      expect(onUpdateShelfBookStatus).toHaveBeenCalledWith(
        'lib-2',
        'b-lib2-unread',
        'reading',
      );
    });
    expect(screen.getByText('Reading Now')).toBeInTheDocument();
  });
});
