import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
  BookGenreData,
} from '../../../types/metadata';
import {GeoMetadataProvider} from './providers/GeoMetadataProvider';
import {TemporalMetadataProvider} from './providers/TemporalMetadataProvider';
import {GenreMetadataProvider} from './providers/GenreMetadataProvider';
import {SynopsisMetadataProvider} from './providers/SynopsisMetadataProvider';
import {AuthorBioMetadataProvider} from './providers/AuthorBioMetadataProvider';
import {CoverImageMetadataProvider} from './providers/CoverImageMetadataProvider';
import {EmbeddingMetadataProvider} from './providers/EmbeddingMetadataProvider';
import {SeriesMetadataProvider} from './providers/SeriesMetadataProvider';
import {catalogOrchestrator} from '../catalog';

export class MetadataRegistry {
  private static instance: MetadataRegistry;
  private providers: Map<MetadataKey, IMetadataProvider<unknown>> = new Map();

  private constructor() {
    this.register(new CoverImageMetadataProvider());
    this.register(new SynopsisMetadataProvider());
    this.register(new AuthorBioMetadataProvider());
    this.register(new GenreMetadataProvider());
    this.register(new GeoMetadataProvider());
    this.register(new TemporalMetadataProvider());
    this.register(new EmbeddingMetadataProvider());
    this.register(new SeriesMetadataProvider());
  }

  public static getInstance(): MetadataRegistry {
    if (!MetadataRegistry.instance) {
      MetadataRegistry.instance = new MetadataRegistry();
    }
    return MetadataRegistry.instance;
  }

  public register<T>(provider: IMetadataProvider<T>): void {
    this.providers.set(
      provider.getKey(),
      provider as IMetadataProvider<unknown>,
    );
  }

  public getProvider<T = unknown>(
    key: MetadataKey,
  ): IMetadataProvider<T> | undefined {
    return this.providers.get(key) as IMetadataProvider<T> | undefined;
  }

  public getAllProviders(): IMetadataProvider<unknown>[] {
    return Array.from(this.providers.values());
  }

  /**
   * Enriches newly created books across all available on-create providers.
   * Performs a single unified catalog pass per book first so coverUrl, synopsis,
   * isbn, publishedDate, series, and catalog genres are populated without duplicate
   * catalog lookups across CoverImageMetadataProvider and SynopsisMetadataProvider.
   */
  public async enrichBooksOnCreate(
    books: CoreBookData[],
    options?: {allowAiFallback?: boolean; customGenres?: string[]},
  ): Promise<Map<string, Record<string, unknown>>> {
    const mergedUpdates = new Map<string, Record<string, unknown>>();
    const workingBooks: CoreBookData[] = books.map(b => ({...b}));

    for (const b of workingBooks) {
      mergedUpdates.set(b.id, {});
    }

    // Step 1: Single unified catalog lookup for any book missing coverUrl or synopsis
    await Promise.all(
      workingBooks.map(async book => {
        const hasCover = Boolean(book.coverUrl);
        const hasSynopsis = Boolean(book.synopsis || book.description);
        if (hasCover && hasSynopsis) {
          return;
        }

        try {
          let match = null;
          if (book.isbn) {
            match = await catalogOrchestrator.searchByIsbn(book.isbn, {
              priority: 'BATCH',
              verifyCovers: !hasCover,
            });
          }
          if (!match && book.title) {
            const searchRes = await catalogOrchestrator.searchByQuery(
              {
                title: book.title,
                author: book.author || '',
                isbn: book.isbn,
                limit: 3,
              },
              {
                priority: 'BATCH',
                verifyCovers: !hasCover,
              },
            );
            match =
              searchRes.books.find(b => Boolean(b.coverUrl)) ||
              searchRes.books[0] ||
              null;
          }

          if (match) {
            const current = mergedUpdates.get(book.id) || {};
            if (!book.coverUrl && match.coverUrl) {
              current[MetadataKey.COVER_IMAGE] = match.coverUrl;
              book.coverUrl = match.coverUrl;
            }
            if (!hasSynopsis && match.synopsis) {
              current[MetadataKey.SYNOPSIS] = match.synopsis;
              book.synopsis = match.synopsis;
            }
            if (!book.isbn && match.isbn) {
              current.isbn = match.isbn;
              book.isbn = match.isbn;
            }
            if (!book.publishedDate && match.publishedDate) {
              current.publishedDate = match.publishedDate;
              book.publishedDate = match.publishedDate;
            }
            if (!book.series && match.series) {
              current.series = match.series;
              book.series = match.series;
            }
            if (
              !book.primaryGenre &&
              match.primaryGenre &&
              !match.isCustomPrimary
            ) {
              current.primaryGenre = match.primaryGenre;
              current.subgenres = match.subgenres || [];
              current.isCustomPrimary = false;
              book.primaryGenre = match.primaryGenre;
              book.subgenres = match.subgenres || [];
            }
            mergedUpdates.set(book.id, current);
          }
        } catch (err) {
          console.warn(
            `[MetadataRegistry] Unified catalog pre-hydration failed for "${book.title}":`,
            err,
          );
        }
      }),
    );

    if (options?.allowAiFallback === false) {
      return mergedUpdates;
    }

    // Step 2: Run remaining on-create providers (Genre & Embedding) sequentially
    // so EmbeddingMetadataProvider benefits from newly classified genres and synopses.
    const createProviders = this.getAllProviders().filter(
      p => p.shouldFetchOnCreate() && p.isAvailable(),
    );

    for (const provider of createProviders) {
      const key = provider.getKey();
      const booksNeedingField = workingBooks.filter(b => {
        if (key === MetadataKey.COVER_IMAGE) return !b.coverUrl;
        if (key === MetadataKey.GENRE) return !b.primaryGenre;
        return !b[key];
      });
      if (booksNeedingField.length === 0) continue;

      try {
        const batchRes = await provider.bulkFetch(booksNeedingField, {
          allowAiFallback: options?.allowAiFallback,
          customGenres: options?.customGenres,
        });
        for (const [bookId, value] of Object.entries(batchRes)) {
          if (value === null || value === undefined) continue;
          const current = mergedUpdates.get(bookId) || {};
          const targetBook = workingBooks.find(wb => wb.id === bookId);
          if (key === MetadataKey.GENRE) {
            const genreVal = value as BookGenreData;
            if (genreVal.primaryGenre) {
              current.primaryGenre = genreVal.primaryGenre;
              current.subgenres = genreVal.subgenres || [];
              current.isCustomPrimary = Boolean(genreVal.isCustomPrimary);
              if (targetBook) {
                targetBook.primaryGenre = genreVal.primaryGenre;
                targetBook.subgenres = genreVal.subgenres || [];
              }
            }
          } else {
            current[key] = value;
            if (targetBook) {
              targetBook[key] = value;
            }
          }
          mergedUpdates.set(bookId, current);
        }
      } catch (err) {
        console.warn(
          `[MetadataRegistry] On-create provider ${key} encountered error:`,
          err,
        );
      }
    }

    return mergedUpdates;
  }
}

export const metadataRegistry = MetadataRegistry.getInstance();
