import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddBookModal from './AddBookModal';
import * as bookApi from '../services/bookApi';

// Mock dependencies
vi.mock('../services/bookApi', () => ({
  searchBookByTitle: vi.fn(),
  searchBookByIsbn: vi.fn(),
}));

vi.mock('../services/gemini', () => ({
  extractBooksFromImage: vi.fn(),
  extractBooksFromCsv: vi.fn(),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}));

describe('AddBookModal', () => {
  const mockOnClose = vi.fn();
  const mockOnAddBook = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock getUserMedia
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }]
        })
      },
      writable: true
    });
  });

  it('renders nothing when isOpen is false', () => {
    render(<AddBookModal isOpen={false} onClose={mockOnClose} onAddBook={mockOnAddBook} />);
    expect(screen.queryByText('Add Books')).not.toBeInTheDocument();
  });

  it('renders standard layout when isOpen is true', async () => {
    await act(async () => {
      render(<AddBookModal isOpen={true} onClose={mockOnClose} onAddBook={mockOnAddBook} />);
    });
    expect(screen.getByText('Add Books')).toBeInTheDocument();
    
    // Tabs
    expect(screen.getByText('Scan / Upload')).toBeInTheDocument();
    expect(screen.getByText('Import CSV')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('switches to search tab and performs a search', async () => {
    const user = userEvent.setup();
    (bookApi.searchBookByTitle as any).mockResolvedValue([
      { title: 'Test Book', author: 'Test Author', isbn: '123' }
    ]);

    await act(async () => {
      render(<AddBookModal isOpen={true} onClose={mockOnClose} onAddBook={mockOnAddBook} />);
    });
    
    const searchTab = screen.getByText('Search');
    await user.click(searchTab);

    const input = screen.getByPlaceholderText(/Search by title, author, or ISBN/i);
    await user.type(input, 'Test query');
    
    // Assuming there are multiple buttons with "Search", get the one in the form
    const searchButtons = screen.getAllByRole('button', { name: /Search/i });
    const searchButton = searchButtons.find(b => b.getAttribute('type') === 'submit')!;
    
    await user.click(searchButton);

    await waitFor(() => {
      expect(bookApi.searchBookByTitle).toHaveBeenCalledWith('Test query');
      expect(screen.getByText('Test Book')).toBeInTheDocument();
      expect(screen.getByText('Test Author')).toBeInTheDocument();
    });
  });

  it('handles clicking Add on a search result', async () => {
    const user = userEvent.setup();
    (bookApi.searchBookByTitle as any).mockResolvedValue([
      { title: 'Title To Add', author: 'Author to Add', isbn: '555' }
    ]);

    await act(async () => {
      render(<AddBookModal isOpen={true} onClose={mockOnClose} onAddBook={mockOnAddBook} />);
    });
    await user.click(screen.getByText('Search'));
    
    await user.type(screen.getByPlaceholderText(/Search by title/i), 'Query');
    
    const submitBtn = screen.getAllByRole('button', { name: /Search/i }).find(b => b.getAttribute('type') === 'submit')!;
    await user.click(submitBtn);

    await waitFor(() => screen.getByText('Title To Add'));

    // The add button for this particular book
    const addBtn = screen.getByRole('button', { name: 'Add' });
    await user.click(addBtn);

    await waitFor(() => {
      expect(mockOnAddBook).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Title To Add',
        isbn: '555'
      }));
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('switches to Manual tab and adds a book manually', async () => {
    const user = userEvent.setup();
    await act(async () => {
      render(<AddBookModal isOpen={true} onClose={mockOnClose} onAddBook={mockOnAddBook} />);
    });
    
    await user.click(screen.getByText('Manual'));

    const titleInput = screen.getByText('Title *').nextElementSibling as HTMLInputElement;
    const authorInput = screen.getByText('Author *').nextElementSibling as HTMLInputElement;

    await user.type(titleInput, 'Manual Title');
    await user.type(authorInput, 'Manual Author');

    const submitBtn = screen.getByRole('button', { name: 'Add Book to Library' });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockOnAddBook).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Manual Title',
        author: 'Manual Author'
      }));
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('skips duplicate book when adding manually', async () => {
    const user = userEvent.setup();
    const existingBooks = [{ title: 'Duplicate Book', author: 'Same Author', isbn: '123', coverUrl: '', publishedDate: '' }];
    await act(async () => {
      render(<AddBookModal isOpen={true} onClose={mockOnClose} onAddBook={mockOnAddBook} existingBooks={existingBooks} />);
    });
    
    await user.click(screen.getByText('Manual'));

    const titleInput = screen.getByText('Title *').nextElementSibling as HTMLInputElement;
    const authorInput = screen.getByText('Author *').nextElementSibling as HTMLInputElement;

    await user.type(titleInput, 'Duplicate Book');
    await user.type(authorInput, 'Same Author');

    const submitBtn = screen.getByRole('button', { name: 'Add Book to Library' });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockOnAddBook).not.toHaveBeenCalled();
    });
  });
});
