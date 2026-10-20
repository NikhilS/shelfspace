import {describe, it, expect, vi, beforeEach} from 'vitest';
import {Book} from '../types';
import type {
  DuplicateWorkerRequest,
  DuplicateWorkerResponse,
} from './duplicateDetection.worker';

describe('duplicateDetection.worker message protocol', () => {
  const postMessageMock = vi.fn();

  beforeEach(async () => {
    postMessageMock.mockReset();
    vi.stubGlobal('self', {
      postMessage: postMessageMock,
      onmessage: null,
    });
    vi.resetModules();
    await import('./duplicateDetection.worker');
  });

  it('processes books payload and posts detected duplicate groups', () => {
    const books: Book[] = [
      {
        id: '1',
        title: 'The Left Hand of Darkness',
        author: 'Ursula K. Le Guin',
        isbn: '9780441478125',
        createdAt: 1000,
      } as Book,
      {
        id: '2',
        title: 'The Left Hand of Darkness',
        author: 'Ursula K. Le Guin',
        isbn: '9780441478125',
        createdAt: 2000,
      } as Book,
    ];

    const handler = (
      self as unknown as {
        onmessage: (e: MessageEvent<DuplicateWorkerRequest>) => void;
      }
    ).onmessage;
    handler({data: {books}} as MessageEvent<DuplicateWorkerRequest>);

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const response = postMessageMock.mock
      .calls[0][0] as DuplicateWorkerResponse;
    expect(response.error).toBeUndefined();
    expect(response.groups).toHaveLength(1);
    expect(response.groups[0].books).toHaveLength(2);
  });

  it('catches unexpected errors and posts structured error response', () => {
    const handler = (
      self as unknown as {
        onmessage: (e: MessageEvent<DuplicateWorkerRequest>) => void;
      }
    ).onmessage;
    // Pass malformed non-iterable books array to trigger catch block
    handler({
      data: {books: {} as unknown as Book[]},
    } as MessageEvent<DuplicateWorkerRequest>);

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    const response = postMessageMock.mock
      .calls[0][0] as DuplicateWorkerResponse;
    expect(response.groups).toEqual([]);
    expect(response.error).toBeDefined();
  });
});
