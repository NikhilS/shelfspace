import {describe, it, expect} from 'vitest';
import {computeResyncChanges} from './metadataUtils';

describe('computeResyncChanges', () => {
  it('updates metadata fields successfully', () => {
    const book = {title: 'Test', isbn: 'null'};
    const resultData = {
      isbn: '1234567890',
      genres: ['Fantasy'],
      coverUrl: 'http://example.com/cover.jpg',
      description: 'A great book',
      publishedDate: '2024',
      title: 'Test Book', // longer title
    };

    const changes = computeResyncChanges(book, resultData);
    expect(changes.isbn).toBe('1234567890');
    expect(changes.genres).toEqual(['Fantasy']);
    expect(changes.coverUrl).toBe('http://example.com/cover.jpg');
    expect(changes.description).toBe('A great book');
    expect(changes.publishedDate).toBe('2024');
    expect(changes.title).toBe('Test Book');
  });

  it('does not overwrite existing isbn with resynced isbn', () => {
    const book = {title: 'Test', isbn: '9876543210'}; // Already has ISBN
    const resultData = {
      isbn: '1234567890', // Different ISBN from search
      description: 'A great book',
    };

    const changes = computeResyncChanges(book, resultData);
    expect(changes.isbn).toBeUndefined(); // Should not be in changes
    expect(changes.description).toBe('A great book');
  });

  it('does overwrite isbn if existing isbn is empty string', () => {
    const book = {title: 'Test', isbn: ''};
    const resultData = {
      isbn: '1234567890',
    };

    const changes = computeResyncChanges(book, resultData);
    expect(changes.isbn).toBe('1234567890');
  });

  it('does not update title if the existing title is longer', () => {
    const book = {title: 'The Lord of the Rings: The Fellowship of the Ring'};
    const resultData = {
      title: 'Lord of the Rings',
    };

    const changes = computeResyncChanges(book, resultData);
    expect(changes.title).toBeUndefined();
  });
});
