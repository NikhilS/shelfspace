/* eslint-disable @typescript-eslint/ban-ts-comment */
import React from 'react';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import AddBookView from './AddBookView';
import {useAuth} from '../contexts/AuthContext';
import {BrowserRouter} from 'react-router-dom';
import {extractBooksFromImage} from '../services/gemini';
import {writeBatch} from 'firebase/firestore';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...(actual as any),
    useParams: () => ({id: 'lib123'}),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('../services/gemini', () => ({
  extractBooksFromImage: vi.fn(),
  enrichBooksMetadata: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../services/bookApi', () => ({
  searchBookByTitle: vi.fn(() => Promise.resolve([])),
  searchBookByIsbn: vi.fn(() => Promise.resolve(null)),
  searchBookByTitleAndAuthor: vi.fn(() => Promise.resolve([])),
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    getFirestore: vi.fn(),
    collection: vi.fn(),
    doc: vi.fn(),
    writeBatch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn(),
    })),
    addDoc: vi.fn(() => Promise.resolve({id: 'doc123'})),
    updateDoc: vi.fn(() => Promise.resolve()),
    increment: vi.fn(),
    getDocs: vi.fn(() => Promise.resolve({docs: []})),
    onSnapshot: vi.fn((_ref, cb) => {
      cb({docs: []});
      return () => {};
    }),
    serverTimestamp: vi.fn(),
    setDoc: vi.fn(),
  };
});

vi.mock('../firebase', () => ({
  db: {},
  handleFirestoreError: vi.fn(),
  OperationType: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LIST: 'list',
    GET: 'get',
    WRITE: 'write',
  },
}));

describe('AddBookView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      useAuth as unknown as {mockReturnValue: (...args: unknown[]) => unknown}
    ).mockReturnValue({
      user: {
        uid: 'user1',
        email: 'test@example.com',
        displayName: 'Test User',
      },
    });

    // Mock getUserMedia
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn(() =>
          Promise.resolve({
            getTracks: () => [{stop: vi.fn()}],
            getVideoTracks: () => [{stop: vi.fn()}],
          }),
        ),
      },
      configurable: true,
    });
  });

  it('can add multiple books sequentially from the camera', async () => {
    (extractBooksFromImage as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {title: 'Book One', author: 'Author One'},
    ]);

    render(
      <BrowserRouter>
        <AddBookView />
      </BrowserRouter>,
    );

    // Switch to camera tab
    fireEvent.click(screen.getByTestId('method-selector-trigger')); // Open dropdown
    fireEvent.click(screen.getByTestId('method-option-camera')); // Select camera

    // Wait for the video to appear and trigger onloadedmetadata so isCameraActive becomes true
    const video = await waitFor(() => {
      const v = document.querySelector('video');
      expect(v).not.toBeNull();
      return v;
    });

    if (video) {
      act(() => {
        if (video.onloadedmetadata) {
          // @ts-ignore
          video.onloadedmetadata(new Event('loadedmetadata'));
        }
      });
    }

    const captureButton = await screen.findByTestId('capture-shelf-action');

    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      value: 480,
    });

    // Mock canvas context
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    HTMLCanvasElement.prototype.toDataURL = vi
      .fn()
      .mockReturnValue('data:image/png;base64,mocked');

    fireEvent.click(captureButton);

    await screen.findByText('Found 1 Books');
    expect(screen.getByText('Book One')).toBeInTheDocument();

    const addButton = screen.getByRole('button', {name: /Add Selected/i});
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(writeBatch).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByText('Found 1 Books')).not.toBeInTheDocument();
    });

    const video2 = await waitFor(() => {
      const v = document.querySelector('video');
      expect(v).not.toBeNull();
      return v;
    });

    if (video2) {
      act(() => {
        if (video2.onloadedmetadata) {
          // @ts-ignore
          video2.onloadedmetadata(new Event('loadedmetadata'));
        }
      });
    }

    const captureButton2 = await screen.findByTestId('capture-shelf-action');

    (extractBooksFromImage as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {title: 'Book Two', author: 'Author Two'},
    ]);
    fireEvent.click(captureButton2);

    await screen.findByText('Found 1 Books');
    expect(screen.getByText('Book Two')).toBeInTheDocument();

    const addButton2 = screen.getByRole('button', {name: /Add Selected/i});
    fireEvent.click(addButton2);

    await waitFor(() => {
      expect(writeBatch).toHaveBeenCalledTimes(2);
    });
  });
});
