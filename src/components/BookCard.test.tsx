import {describe, it, expect, vi} from 'vitest';
import {render, screen, fireEvent} from '@testing-library/react';
import BookCard from './BookCard';

describe('BookCard component', () => {
  const mockBook = {
    id: 'book1',
    addedBy: 'user1',
    addedAt: '2023-01-01',
    title: 'the great gatsby',
    author: 'f. scott fitzgerald',
    isbn: '123456',
    coverUrl: 'http://example.com/cover.jpg',
    publishedDate: '1925',
  };

  it('renders standard book card correctly with cover', () => {
    render(<BookCard book={mockBook} canEdit={false} />);
    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'http://example.com/cover.jpg');
    expect(img).toHaveAttribute('alt', mockBook.title);
  });

  it('renders standard book card without cover', () => {
    const noCoverBook = {...mockBook, coverUrl: ''};
    render(<BookCard book={noCoverBook} canEdit={false} />);
    expect(screen.getAllByText('The Great Gatsby')[0]).toBeInTheDocument();
    expect(screen.getAllByText('F. Scott Fitzgerald')[0]).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('calls onClick when card is clicked', () => {
    const handleClick = vi.fn();
    render(<BookCard book={mockBook} canEdit={false} onClick={handleClick} />);

    // click the wrapper
    // the text or img might be easier to target or we can target by testid, but let's query the img
    const img = screen.getByRole('img');
    fireEvent.click(img);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not show delete button if canEdit is false', () => {
    // Delete has been removed from card
    render(<BookCard book={mockBook} canEdit={false} />);
    const deleteButton = screen.queryByRole('button', {name: /×/i});
    expect(deleteButton).not.toBeInTheDocument();
  });
});
