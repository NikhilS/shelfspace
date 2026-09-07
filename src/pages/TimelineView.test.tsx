import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import TimelineView from './TimelineView';

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({
    user: {uid: 'u1', email: 'test@example.com'},
  }),
  useAuthStore: () => ({
    user: {uid: 'u1', email: 'test@example.com'},
  }),
}));

vi.mock('../hooks/useLibraryData', () => ({
  useLibraryData: () => ({
    books: [
      {
        id: 'b1',
        title: 'Meditations',
        author: 'Marcus Aurelius',
        libraryId: 'lib-1',
        temporalMetadata: {
          startYear: 180,
          endYear: 180,
          eraName: 'Roman Empire',
          rationale: 'Written during the Marcomannic Wars.',
          confidence: 'high',
          isNonHistorical: false,
        },
      },
      {
        id: 'b2',
        title: 'Neuromancer',
        author: 'William Gibson',
        libraryId: 'lib-1',
        temporalMetadata: {
          isNonHistorical: true,
          confidence: 'high',
          rationale: 'Fictional cyberpunk setting.',
        },
      },
    ],
    isBooksLoading: false,
  }),
}));

vi.mock('../hooks/useBulkEnrichment', () => ({
  useBulkEnrichment: () => ({
    isBackfilling: false,
    progress: {processed: 0, total: 0},
    inFlightCount: 0,
    retryFailed: vi.fn(),
    startBulkEnrichment: vi.fn(),
  }),
}));

describe('TimelineView', () => {
  it('renders the timeline view successfully with clusters and presets', () => {
    render(
      <MemoryRouter initialEntries={['/library/lib-1/timeline']}>
        <Routes>
          <Route path="/library/:id/timeline" element={<TimelineView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Back to Library Overview')).toBeInTheDocument();
    expect(
      screen.getByText('Historical Temporal Timeline'),
    ).toBeInTheDocument();
    expect(screen.getByText('All-Time Focus')).toBeInTheDocument();
    expect(screen.getByText('Ancient & BCE Era')).toBeInTheDocument();
    expect(screen.getByText('Century Highlights')).toBeInTheDocument();
  });
});
