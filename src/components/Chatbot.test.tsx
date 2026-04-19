import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Chatbot from './Chatbot';

const mockSendMessageStream = vi.fn();
const mockCreateChat = vi.fn().mockImplementation(() => {
  return {
    sendMessageStream: mockSendMessageStream
  };
});

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      chats = {
        create: mockCreateChat
      };
    }
  };
});

describe('Chatbot component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test';
    
    // Polyfill scrollIntoView since jsdom doesn't support it
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('renders chat button initially and opens chat when clicked', async () => {
    const user = userEvent.setup();
    render(<Chatbot libraryBooks={[]} />);
    
    expect(screen.queryByText('AI Librarian')).not.toBeInTheDocument();
    
    const openBtn = screen.getByRole('button', { name: /Open AI Librarian Chat/i });
    await user.click(openBtn);
    
    expect(screen.getByText('AI Librarian')).toBeInTheDocument();
    expect(mockCreateChat).toHaveBeenCalledTimes(1);
    
    // Check for welcome message
    expect(screen.getByText(/Hello! I'm your AI Librarian/i)).toBeInTheDocument();
  });

  it('allows user to send a message and renders stream response', async () => {
    const user = userEvent.setup();
    render(<Chatbot libraryBooks={[{ title: 'Dune', author: 'Frank Herbert' }]} />);
    
    // Open chat
    await user.click(screen.getByRole('button', { name: /Open AI Librarian Chat/i }));
    
    // Setup mock stream
    mockSendMessageStream.mockResolvedValueOnce(
      (async function* () {
        yield { text: 'Here is ' };
        yield { text: 'a recommendation' };
      })()
    );

    const input = screen.getByPlaceholderText(/Ask about your library.../i);
    await user.type(input, 'What should I read next?');
    await user.keyboard('{Enter}');

    expect(screen.getByText('What should I read next?')).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText('Here is a recommendation')).toBeInTheDocument();
    });
  });
});
