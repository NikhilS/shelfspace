import React from 'react';
import {describe, it, expect} from 'vitest';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ExplorePerspectivesStrip} from './ExplorePerspectivesStrip';
import type {Book} from '../../types';

const sampleBooks: Book[] = [
  {
    id: 'b1',
    title: 'Dune',
    author: 'Frank Herbert',
    primaryGenre: 'Science Fiction',
    publishedDate: '1965',
    addedAt: '2026-01-01',
    geoMetadata: {
      locations: [{name: 'Cairo', lat: 30.04, lng: 31.23, adminLevel: 'City'}],
    },
  },
  {
    id: 'b2',
    title: 'SPQR',
    author: 'Mary Beard',
    primaryGenre: 'History',
    temporalMetadata: {
      startYear: -509,
      endYear: 212,
      eraName: 'Roman Republic',
    },
    addedAt: '2026-01-02',
  },
];

describe('ExplorePerspectivesStrip', () => {
  it('renders Timeline, World Map, and Constellation links for /reading and computes metrics', () => {
    render(
      <MemoryRouter>
        <ExplorePerspectivesStrip
          books={sampleBooks}
          basePath="/reading"
          heading="Explore Your Reading"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Explore Your Reading')).toBeInTheDocument();
    expect(screen.getByText('2 Charted')).toBeInTheDocument();
    expect(screen.getByText('1 Places')).toBeInTheDocument();
    expect(screen.getByText('2 Genres')).toBeInTheDocument();

    const timelineLink = screen.getByText('Historical Timeline').closest('a');
    const mapLink = screen.getByText('Literary World Map').closest('a');
    const constellationLink = screen
      .getByText('Thematic Constellations')
      .closest('a');

    expect(timelineLink).toHaveAttribute('href', '/reading/timeline');
    expect(mapLink).toHaveAttribute('href', '/reading/map');
    expect(constellationLink).toHaveAttribute('href', '/reading/constellation');
    expect(screen.queryByText('Have You Read It?')).not.toBeInTheDocument();
    expect(screen.getByText('3 Perspectives')).toBeInTheDocument();
  });

  it('renders Have You Read It? as the 4th card on library pages with ready-now unread count', () => {
    const recentIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const libraryBooks: Book[] = [
      ...sampleBooks,
      {
        id: 'b-recent',
        title: 'Checked Two Hours Ago',
        author: 'Author',
        addedAt: '2026-01-02',
        readStatusReviewedAt: recentIso,
      },
      {
        id: 'b3',
        title: 'Meditations',
        author: 'Marcus Aurelius',
        addedAt: '2026-01-03',
        readingStatus: 'finished',
      },
      {
        id: 'b4',
        title: 'Abandoned Novel',
        author: 'Someone',
        addedAt: '2026-01-04',
        readingStatus: 'abandoned',
      },
    ];

    render(
      <MemoryRouter>
        <ExplorePerspectivesStrip
          books={libraryBooks}
          basePath="/library/lib-42"
          currentUserId="u-1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('4 Perspectives')).toBeInTheDocument();
    expect(screen.getByText('Have You Read It?')).toBeInTheDocument();
    expect(screen.getByText('2 Unread')).toBeInTheDocument();

    const swipeLink = screen.getByText('Have You Read It?').closest('a');
    expect(swipeLink).toHaveAttribute('href', '/library/lib-42/swipe');
  });

  it('displays Checked Recently badge when all unread books were checked within the last 2 days', () => {
    const recentIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const recentlyCheckedBooks: Book[] = [
      {
        id: 'b1',
        title: 'Dune',
        author: 'Frank Herbert',
        addedAt: '2026-01-01',
        readStatusReviewedAt: recentIso,
      },
    ];

    render(
      <MemoryRouter>
        <ExplorePerspectivesStrip
          books={recentlyCheckedBooks}
          basePath="/library/lib-42"
          currentUserId="u-1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Checked Recently')).toBeInTheDocument();
  });
});
