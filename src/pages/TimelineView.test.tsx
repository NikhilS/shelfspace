import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
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
          startYear: 161,
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
    progress: {completed: 0, failed: 0, total: 0},
    inFlightCount: 0,
    retryFailed: vi.fn(),
    startBulkEnrichment: vi.fn(),
  }),
}));

describe('TimelineView', () => {
  it('renders the D3 + HTML5 Canvas meandering river timeline view with century scrubber, riverbank docks, and presets', () => {
    render(
      <MemoryRouter initialEntries={['/library/lib-1/timeline']}>
        <Routes>
          <Route path="/library/:id/timeline" element={<TimelineView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Back to Library')).toBeInTheDocument();
    expect(screen.getByText('Historical Timeline')).toBeInTheDocument();
    expect(screen.getByText('All-Time Focus')).toBeInTheDocument();
    expect(screen.getByText('Ancient & BCE Era')).toBeInTheDocument();
    expect(screen.getByText('Century Highlights')).toBeInTheDocument();
    expect(
      screen.getByText('Hydrographic Century Scrubber'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Roman Empire').length).toBeGreaterThan(0);
    expect(screen.getByText('Span Arc:')).toBeInTheDocument();
  });

  it('opens the Epoch Curatorial Drawer and Mobile Bottom Sheet when a peninsula dock is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/library/lib-1/timeline']}>
        <Routes>
          <Route path="/library/:id/timeline" element={<TimelineView />} />
        </Routes>
      </MemoryRouter>,
    );

    const inspectBtn = screen.getByRole('button', {
      name: /Inspect Roman Empire/i,
    });
    fireEvent.click(inspectBtn);

    expect(
      screen.getByRole('complementary', {
        name: /Selected epoch: Roman Empire/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', {
        name: /Epoch books: Roman Empire/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', {name: /Meditations/i})[0],
    ).toHaveAttribute('href', '/library/lib-1/book/b1');
  });

  it('renders Reading Mode copy and Back to Reading Room link on /reading/timeline', () => {
    render(
      <MemoryRouter initialEntries={['/reading/timeline']}>
        <Routes>
          <Route path="/reading/timeline" element={<TimelineView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Back to Reading Room')).toBeInTheDocument();
    expect(
      screen.getByText(/Follow your reading life through history/i),
    ).toBeInTheDocument();
  });
});
