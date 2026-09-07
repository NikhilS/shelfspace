import React from 'react';
import {describe, it, expect, vi} from 'vitest';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {LibraryHeader} from './LibraryHeader';
import {Library, Book} from '../../types';

describe('LibraryHeader - Adaptive Density', () => {
  const mockLibrary: Library = {
    id: 'lib-1',
    name: 'Athenaeum Collection',
    ownerId: 'u1',
    ownerName: 'Alex Reader',
    createdAt: '2024-01-01',
    access: {'alex@reader.com': 'owner'},
  };

  const mockBooks: Book[] = [
    {
      id: 'b1',
      title: 'The Left Hand of Darkness',
      author: 'Ursula K. Le Guin',
      libraryId: 'lib-1',
      genres: ['Sci-Fi'],
      status: 'reading',
      addedAt: '2024-01-01',
    },
  ];

  it('renders with compact responsive adaptive height classes', () => {
    const {container} = render(
      <MemoryRouter>
        <LibraryHeader
          library={mockLibrary}
          books={mockBooks}
          isOwner={true}
          canEdit={true}
        />
      </MemoryRouter>,
    );

    const headerRoot = container.firstChild as HTMLElement;
    expect(headerRoot).toHaveClass('min-h-[110px]');
    expect(headerRoot).toHaveClass('sm:min-h-[180px]');
    expect(headerRoot).toHaveClass('md:min-h-[220px]');
  });

  it('displays library title, volume count, and ownership metadata', () => {
    render(
      <MemoryRouter>
        <LibraryHeader
          library={mockLibrary}
          books={mockBooks}
          isOwner={true}
          canEdit={true}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Athenaeum Collection')).toBeInTheDocument();
    expect(screen.getByText(/1 volume • Owned by you/i)).toBeInTheDocument();
    expect(screen.getByText('All Libraries')).toBeInTheDocument();
  });

  it('renders read-only badge for viewer role', () => {
    render(
      <MemoryRouter>
        <LibraryHeader
          library={mockLibrary}
          books={mockBooks}
          isOwner={false}
          role="viewer"
          canEdit={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Read-Only')).toBeInTheDocument();
    expect(screen.getByText(/Shared by Alex Reader/i)).toBeInTheDocument();
  });

  it('handles hero refresh button trigger when canEdit is true', () => {
    const onRefreshHero = vi.fn();
    render(
      <MemoryRouter>
        <LibraryHeader
          library={mockLibrary}
          books={mockBooks}
          isOwner={true}
          canEdit={true}
          onRefreshHero={onRefreshHero}
        />
      </MemoryRouter>,
    );

    const refreshBtn = screen.getByTitle('Refresh Banner');
    expect(refreshBtn).toBeInTheDocument();
  });
});
