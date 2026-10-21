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
  });
});
