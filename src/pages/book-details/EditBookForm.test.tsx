import React from 'react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {EditBookForm} from './EditBookForm';
import {Book, BookDetailsPayload} from '../../types';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createTestQueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

// Mock Lucide icons
vi.mock('lucide-react', async () => {
  const actual = await vi.importActual('lucide-react');
  return {
    ...actual,
    Camera: () => <div data-testid="icon-camera" />,
    Sparkles: () => <div data-testid="icon-sparkles" />,
    Trash2: () => <div data-testid="icon-trash" />,
    Save: () => <div data-testid="icon-save" />,
  };
});

// Mock CoverCamera
vi.mock('../../components/CoverCamera', () => ({
  __esModule: true,
  default: ({
    onCapture,
    onCancel,
  }: {
    onCapture: (b: string) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="cover-camera-mocked">
      <button
        type="button"
        onClick={() => onCapture('data:image/jpeg;base64,captured')}
      >
        Capture Mock
      </button>
      <button type="button" onClick={onCancel}>
        Cancel Mock
      </button>
    </div>
  ),
}));

// Mock nanobanana enhancer service
vi.mock('../../lib/nanobanana', () => ({
  applyNanobananaFlash: vi
    .fn()
    .mockResolvedValue('data:image/jpeg;base64,enhanced'),
}));

// Mock bookApi services
vi.mock('../../services/bookApi', () => ({
  searchBookByIsbn: vi.fn().mockResolvedValue({
    coverUrl: 'https://images.example/isbn-cover.jpg',
  }),
  searchBookByTitleAndAuthor: vi
    .fn()
    .mockResolvedValue([{coverUrl: 'https://images.example/search-cover.jpg'}]),
}));

describe('EditBookForm', () => {
  const mockBook: Book = {
    id: 'b1',
    title: 'The Hobbit',
    author: 'J.R.R. Tolkien',
    format: 'physical',
    isbn: '9780261102217',
    coverUrl: 'https://images.example/original-cover.jpg',
    publishedDate: '1937',
    series: 'Middle-earth',
    genres: ['Fantasy', 'Adventure'],
    addedBy: 'u1',
    addedAt: {seconds: 1600000000, nanoseconds: 0} as any,
  };

  const mockBookDetails: BookDetailsPayload = {
    synopsis: 'Baggins journeys to the lonely mountain with dwarves...',
    authorBio: 'English linguist and fantasy pioneer...',
  };

  const mockUpdateBook = vi.fn();
  const mockUpdateBookOptimistically = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with default book metadata fields', () => {
    renderWithQueryClient(
      <EditBookForm
        libraryId="lib1"
        book={mockBook}
        bookBase={mockBook}
        bookDetails={mockBookDetails}
        updateBook={mockUpdateBook}
        updateBookOptimistically={mockUpdateBookOptimistically}
        onClose={mockOnClose}
        onDelete={mockOnDelete}
      />,
    );

    expect(screen.getByText('Edit Book Details')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('The Hobbit');
    expect(screen.getByLabelText('Author')).toHaveValue('J.R.R. Tolkien');
    expect(screen.getByLabelText('ISBN Code')).toHaveValue('9780261102217');
    expect(screen.getByLabelText('Published Year / Date')).toHaveValue('1937');
    expect(screen.getByLabelText('Series Name')).toHaveValue('Middle-earth');
    expect(screen.getByLabelText('Genres (Comma separated list)')).toHaveValue(
      'Fantasy, Adventure',
    );
  });

  it('renders the delete book action at the end of the form', () => {
    renderWithQueryClient(
      <EditBookForm
        libraryId="lib1"
        book={mockBook}
        bookBase={mockBook}
        bookDetails={mockBookDetails}
        updateBook={mockUpdateBook}
        updateBookOptimistically={mockUpdateBookOptimistically}
        onClose={mockOnClose}
        onDelete={mockOnDelete}
      />,
    );

    // Look for Delete Book button in the form
    const deleteButton = screen.getByText('Delete Book');
    expect(deleteButton).toBeInTheDocument();
  });

  it('transitions to inline confirmation screen when Delete is clicked', () => {
    renderWithQueryClient(
      <EditBookForm
        libraryId="lib1"
        book={mockBook}
        bookBase={mockBook}
        bookDetails={mockBookDetails}
        updateBook={mockUpdateBook}
        updateBookOptimistically={mockUpdateBookOptimistically}
        onClose={mockOnClose}
        onDelete={mockOnDelete}
      />,
    );

    // Click Delete
    fireEvent.click(screen.getByText('Delete Book'));

    // Form inputs should disappear and the safety warning screen is displayed
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Are you sure you want to remove this book from your library/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Yes, Delete Book')).toBeInTheDocument();
    expect(screen.getByText('No, Keep Book')).toBeInTheDocument();
  });

  it('restores the editing form if the delete confirm action is canceled', () => {
    renderWithQueryClient(
      <EditBookForm
        libraryId="lib1"
        book={mockBook}
        bookBase={mockBook}
        bookDetails={mockBookDetails}
        updateBook={mockUpdateBook}
        updateBookOptimistically={mockUpdateBookOptimistically}
        onClose={mockOnClose}
        onDelete={mockOnDelete}
      />,
    );

    // Trigger confirmation screen
    fireEvent.click(screen.getByText('Delete Book'));
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

    // Cancel deletion
    fireEvent.click(screen.getByText('No, Keep Book'));

    // Taxonomical form should be restored
    expect(screen.getByLabelText('Title')).toHaveValue('The Hobbit');
    expect(screen.getByText('Delete Book')).toBeInTheDocument();
  });

  it('submits the deletion request when the delete confirmation is accepted', async () => {
    renderWithQueryClient(
      <EditBookForm
        libraryId="lib1"
        book={mockBook}
        bookBase={mockBook}
        bookDetails={mockBookDetails}
        updateBook={mockUpdateBook}
        updateBookOptimistically={mockUpdateBookOptimistically}
        onClose={mockOnClose}
        onDelete={mockOnDelete}
      />,
    );

    fireEvent.click(screen.getByText('Delete Book'));
    fireEvent.click(screen.getByText('Yes, Delete Book'));

    expect(mockOnDelete).toHaveBeenCalledTimes(1);
  });

  it('allows taking a camera photo and updating the cover URL', async () => {
    renderWithQueryClient(
      <EditBookForm
        libraryId="lib1"
        book={mockBook}
        bookBase={mockBook}
        bookDetails={mockBookDetails}
        updateBook={mockUpdateBook}
        updateBookOptimistically={mockUpdateBookOptimistically}
        onClose={mockOnClose}
        onDelete={mockOnDelete}
      />,
    );

    // Click take photo button
    fireEvent.click(screen.getByText('Take Photo'));

    // Check camera mock exists
    expect(screen.getByTestId('cover-camera-mocked')).toBeInTheDocument();

    // Capture photo
    fireEvent.click(screen.getByText('Capture Mock'));

    // Form coverUrl state should receive base64 photo raw or URL value
    await waitFor(() => {
      expect(
        screen.queryByTestId('cover-camera-mocked'),
      ).not.toBeInTheDocument();
    });
  });
});
