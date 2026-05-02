import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import React from 'react';
import ExtractedBooksTable from './ExtractedBooksTable';

vi.mock('../services/bookApi', () => ({
  searchBookByIsbn: vi.fn(),
  searchBookByTitle: vi.fn(),
}));

describe('ExtractedBooksTable', () => {
  const mockBooks = [
    {title: 'Book 1', author: 'Author 1', isbn: '111'},
    {title: 'Book 2', author: 'Author 2', isbn: '222'},
  ];

  const mockSetExtractedBooks = vi.fn();
  const mockSetSelectedExtracted = vi.fn();
  const mockOnAdd = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders table with books', () => {
    render(
      <ExtractedBooksTable
        extractedBooks={mockBooks}
        setExtractedBooks={mockSetExtractedBooks}
        selectedExtracted={new Set(['Book 1::Author 1'])}
        setSelectedExtracted={mockSetSelectedExtracted}
        allowDuplicates={true}
        existingBooks={[]}
        addBooks={mockOnAdd}
        csvFormat="physical"
      />,
    );

    expect(screen.getByText('Book 1')).toBeInTheDocument();
    expect(screen.getByText('Author 1')).toBeInTheDocument();
    expect(screen.getByText('Book 2')).toBeInTheDocument();
    expect(screen.getByText('Author 2')).toBeInTheDocument();
  });

  it('can select all books', () => {
    render(
      <ExtractedBooksTable
        extractedBooks={mockBooks}
        setExtractedBooks={mockSetExtractedBooks}
        selectedExtracted={new Set()}
        setSelectedExtracted={mockSetSelectedExtracted}
        allowDuplicates={true}
        existingBooks={[]}
        addBooks={mockOnAdd}
        csvFormat="physical"
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // Header checkbox
    expect(mockSetSelectedExtracted).toHaveBeenCalled();
  });
});
