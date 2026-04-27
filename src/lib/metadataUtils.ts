import {BookDetails} from '../services/bookApi';

export function computeResyncChanges(
  book: Partial<{isbn: string; title: string}>,
  resultData: Partial<BookDetails>,
) {
  const changes: Partial<BookDetails> = {};

  if (resultData) {
    if (resultData.isbn && (!book.isbn || book.isbn === 'null')) {
      changes.isbn = resultData.isbn;
    }
    if (resultData.genres) changes.genres = resultData.genres;
    if (resultData.coverUrl) changes.coverUrl = resultData.coverUrl;
    if (resultData.description) {
      changes.description = resultData.description;
      changes.synopsis = resultData.description;
    }
    if (resultData.publishedDate)
      changes.publishedDate = resultData.publishedDate;
    if (
      resultData.title &&
      book.title &&
      resultData.title.length > book.title.length
    ) {
      changes.title = resultData.title;
    }
  }

  return changes;
}
