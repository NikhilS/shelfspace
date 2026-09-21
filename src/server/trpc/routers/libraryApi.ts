import {z} from 'zod';
import {router, protectedProcedure, libraryProcedure} from '../trpc';
import {
  libraryListSchema,
  enrichmentTriggerSchema,
} from '../../../schemas/libraryApi';
import {
  bookListSchema,
  bookCreateSchema,
  bookUpdateSchema,
  bookDeleteSchema,
  bookBatchUpsertSchema,
} from '../../../schemas/book';
import {LibraryService} from '../../../services/server/libraryService';
import {BookService} from '../../../services/server/bookService';
import {EnrichmentService} from '../../../services/server/enrichmentService';

export const libraryApiRouter = router({
  /**
   * Retrieves all libraries accessible to the authenticated user.
   */
  list: protectedProcedure
    .input(libraryListSchema)
    .query(async ({input, ctx}) => {
      return LibraryService.getUserLibraries(
        ctx.user.uid,
        ctx.user.email,
        input?.scopes,
        ctx.isAdmin,
      );
    }),

  /**
   * Retrieves a single library by ID.
   */
  get: libraryProcedure('viewer')
    .input(z.object({libraryId: z.string().min(1)}))
    .query(async ({input, ctx}) => {
      return LibraryService.getLibrary(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
      );
    }),

  /**
   * Creates a new library.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        heroImageUrl: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({input, ctx}) => {
      return LibraryService.createLibrary(
        ctx.user.uid,
        ctx.user.email,
        ctx.user.name,
        input,
      );
    }),

  /**
   * Updates an existing library (name, heroImageUrl, access permissions).
   */
  update: libraryProcedure('editor')
    .input(
      z.object({
        libraryId: z.string().min(1),
        name: z.string().optional(),
        heroImageUrl: z.string().nullable().optional(),
        access: z.record(z.enum(['owner', 'editor', 'viewer'])).optional(),
      }),
    )
    .mutation(async ({input, ctx}) => {
      return LibraryService.updateLibrary(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input,
      );
    }),

  /**
   * Deletes a library and all contained books, details, and reviews.
   */
  delete: libraryProcedure('owner')
    .input(z.object({libraryId: z.string().min(1)}))
    .mutation(async ({input, ctx}) => {
      return LibraryService.deleteLibrary(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
      );
    }),

  /**
   * Resolves the caller's role on the given library without throwing FORBIDDEN.
   */
  getPermissions: protectedProcedure
    .input(z.object({libraryId: z.string().min(1)}))
    .query(async ({input, ctx}) => {
      return LibraryService.getUserRole(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
      );
    }),

  /**
   * Lists allowed duplicate groups for this library.
   */
  listAllowedDuplicates: libraryProcedure('viewer')
    .input(z.object({libraryId: z.string().min(1)}))
    .query(async ({input}) => {
      return LibraryService.listAllowedDuplicates(input.libraryId);
    }),

  /**
   * Dismisses a duplicate group.
   */
  allowDuplicateGroup: libraryProcedure('editor')
    .input(
      z.object({
        libraryId: z.string().min(1),
        bookIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(async ({input}) => {
      return LibraryService.allowDuplicateGroup(input.libraryId, input.bookIds);
    }),

  resetMetadata: protectedProcedure
    .input(
      z.object({
        libraryId: z.string(),
        metadataType: z.string(),
      }),
    )
    .mutation(async ({input, ctx}) => {
      return LibraryService.resetMetadata(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.metadataType,
      );
    }),
});

export const bookApiRouter = router({
  /**
   * Creates a new book record with partitioned heavy metadata.
   */
  create: libraryProcedure('editor')
    .meta({
      openapi: {
        method: 'POST',
        path: '/v1/libraries/{libraryId}/books',
        summary: 'Create a new book record',
        description:
          'Creates a book in the library, partitioning heavy metadata to bookDetails and incrementing bookCount.',
        tags: ['Books'],
      },
    })
    .input(bookCreateSchema)
    .mutation(async ({input, ctx}) => {
      return BookService.createBook(ctx.user.uid, input);
    }),

  // Alias for create
  createBook: libraryProcedure('editor')
    .input(bookCreateSchema)
    .mutation(async ({input, ctx}) => {
      return BookService.createBook(ctx.user.uid, input);
    }),

  /**
   * Updates an existing book and its heavy metadata.
   */
  update: libraryProcedure('editor')
    .meta({
      openapi: {
        method: 'PATCH',
        path: '/v1/libraries/{libraryId}/books/{bookId}',
        summary: 'Update an existing book record',
        description:
          'Updates book fields, propagating heavy field updates to bookDetails subcollection.',
        tags: ['Books'],
      },
    })
    .input(bookUpdateSchema)
    .mutation(async ({input, ctx}) => {
      return BookService.updateBook(ctx.user.uid, input);
    }),

  // Alias for update
  updateBook: libraryProcedure('editor')
    .input(bookUpdateSchema)
    .mutation(async ({input, ctx}) => {
      return BookService.updateBook(ctx.user.uid, input);
    }),

  /**
   * Deletes a book, its details, associated reviews, and decrements volume count.
   */
  delete: libraryProcedure('editor')
    .meta({
      openapi: {
        method: 'DELETE',
        path: '/v1/libraries/{libraryId}/books/{bookId}',
        summary: 'Delete a book and its associated records',
        description:
          'Atomically deletes a book document, bookDetails document, cascading reviews, and decrements bookCount.',
        tags: ['Books'],
      },
    })
    .input(bookDeleteSchema)
    .mutation(async ({input, ctx}) => {
      return BookService.deleteBook(ctx.user.uid, input);
    }),

  // Alias for delete
  deleteBook: libraryProcedure('editor')
    .input(bookDeleteSchema)
    .mutation(async ({input, ctx}) => {
      return BookService.deleteBook(ctx.user.uid, input);
    }),

  /**
   * Batch upserts or deletes books in atomic chunks of up to 400.
   */
  batchUpsert: libraryProcedure('editor')
    .meta({
      openapi: {
        method: 'POST',
        path: '/v1/libraries/{libraryId}/books/batch',
        summary: 'Batch upsert or delete books',
        description:
          'Processes multiple book operations in atomic Firestore batches and reconciles volume count.',
        tags: ['Books'],
      },
    })
    .input(bookBatchUpsertSchema)
    .mutation(async ({input, ctx}) => {
      return BookService.batchUpsert(ctx.user.uid, input);
    }),

  /**
   * Retrieves a single book by ID.
   */
  get: libraryProcedure('viewer')
    .meta({
      openapi: {
        method: 'GET',
        path: '/v1/libraries/{libraryId}/books/{bookId}',
        summary: 'Get a book by ID',
        description: 'Retrieves a single book with heavy metadata merged.',
        tags: ['Books'],
      },
    })
    .input(
      z.object({
        libraryId: z.string(),
        bookId: z.string(),
      }),
    )
    .query(async ({input, ctx}) => {
      return BookService.getBook(ctx.user.uid, input.libraryId, input.bookId);
    }),

  /**
   * Lists books in a library with pagination and filters.
   */
  list: libraryProcedure('viewer')
    .meta({
      openapi: {
        method: 'GET',
        path: '/v1/libraries/{libraryId}/books',
        summary: 'List books in a library',
        description:
          'Retrieves books for a library, supporting optional filtering and limit pagination.',
        tags: ['Books'],
      },
    })
    .input(bookListSchema)
    .query(async ({input, ctx}) => {
      return BookService.listBooks(ctx.user.uid, input.libraryId, input);
    }),

  // Alias for list
  listBooks: libraryProcedure('viewer')
    .input(bookListSchema)
    .query(async ({input, ctx}) => {
      return BookService.listBooks(ctx.user.uid, input.libraryId, input);
    }),

  /**
   * Lists reviews for a specific book.
   */
  listReviews: libraryProcedure('viewer')
    .input(
      z.object({
        libraryId: z.string().min(1),
        bookId: z.string().min(1),
      }),
    )
    .query(async ({input, ctx}) => {
      return BookService.listReviews(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.bookId,
      );
    }),

  /**
   * Adds a review to a specific book.
   */
  addReview: libraryProcedure('viewer')
    .input(
      z.object({
        libraryId: z.string().min(1),
        bookId: z.string().min(1),
        rating: z.number().min(0).max(5),
        text: z.string(),
      }),
    )
    .mutation(async ({input, ctx}) => {
      return BookService.addReview(
        ctx.user.uid,
        ctx.user.email,
        ctx.user.name,
        input.libraryId,
        input.bookId,
        input,
      );
    }),

  /**
   * Batches book details retrieval for constellation map view.
   */
  getBookDetailsChunk: libraryProcedure('viewer')
    .input(
      z.object({
        libraryId: z.string().min(1),
        bookIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(async ({input, ctx}) => {
      return BookService.getBookDetailsChunk(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.bookIds,
      );
    }),
});

export const enrichmentApiRouter = router({
  trigger: protectedProcedure
    .input(enrichmentTriggerSchema)
    .mutation(async ({input, ctx}) => {
      return EnrichmentService.triggerBatchEnrichment(
        ctx.user.uid,
        ctx.user.email,
        input,
      );
    }),
});
