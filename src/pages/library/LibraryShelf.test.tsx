import React from 'react';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {describe, it, expect, vi} from 'vitest';
import {LibraryShelf} from './LibraryShelf';
import {Book} from '../../types';
import {User} from 'firebase/auth';

describe('LibraryShelf Table View', () => {
  const mockBooks: Book[] = [
    {
      id: 'b1',
      libraryId: 'lib1',
      title: 'Dune',
      author: 'Frank Herbert',
      addedAt: '2026-01-01T00:00:00Z',
      readingStatus: 'reading',
    },
    {
      id: 'b2',
      libraryId: 'lib1',
      title: 'A Very Long Book Title Without Any Read Status Populated At All',
      author: 'Arkady Strugatsky, Boris Strugatsky',
      addedAt: '2026-01-02T00:00:00Z',
    },
    {
      id: 'b3',
      libraryId: 'lib1',
      title: 'Piranesi',
      author: 'Susanna Clarke',
      addedAt: '2026-01-03T00:00:00Z',
      readingStatus: 'want_to_read',
    },
  ];

  it('locks column widths with table-fixed and colgroup across mixed read status rows', () => {
    const {container} = render(
      <MemoryRouter>
        <LibraryShelf
          books={mockBooks}
          viewMode="table"
          canEdit={true}
          libraryId="lib1"
          sortBy="added"
          sortOrder="desc"
          handleSort={vi.fn()}
          selectedBooks={new Set()}
          toggleBookSelection={vi.fn()}
          toggleAllBooks={vi.fn()}
          user={{uid: 'u1'} as User}
        />
      </MemoryRouter>,
    );

    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
    expect(table?.className).toContain('table-fixed');

    const cols = container.querySelectorAll('colgroup col');
    expect(cols).toHaveLength(3);
    expect(cols[0].className).toContain('w-[64%]');
    expect(cols[1].className).toContain('w-[36%]');
    expect(cols[2].className).toContain('hidden sm:table-column');

    expect(screen.getByText('READING')).toBeInTheDocument();
    expect(screen.getByText('WANT TO READ')).toBeInTheDocument();
    expect(
      screen.getByText(
        'A Very Long Book Title Without Any Read Status Populated At All',
      ),
    ).toBeInTheDocument();
  });
});
