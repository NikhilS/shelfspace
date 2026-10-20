import {Book} from '../types';
import {
  detectDuplicatesWithConfidence,
  DuplicateGroupMetadata,
} from '../lib/duplicateDetection';

export interface DuplicateWorkerRequest {
  books: Book[];
}

export interface DuplicateWorkerResponse {
  groups: DuplicateGroupMetadata[];
  error?: string;
}

self.onmessage = (e: MessageEvent<DuplicateWorkerRequest>) => {
  try {
    const books = e.data?.books || [];
    const groups = detectDuplicatesWithConfidence(books);
    const response: DuplicateWorkerResponse = {groups};
    self.postMessage(response);
  } catch (err) {
    const response: DuplicateWorkerResponse = {
      groups: [],
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
