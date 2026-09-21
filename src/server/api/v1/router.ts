import {Router} from 'express';
import {authenticateApiRequest, PermissionService} from '../../auth';
import type {AuthenticatedApiRequest} from '../../auth';
import {LibraryService} from '../../../services/server/libraryService';
import {BookService} from '../../../services/server/bookService';
import {EnrichmentService} from '../../../services/server/enrichmentService';
import {
  enrichmentTriggerSchema,
  bookCreateSchema,
  bookUpdateSchema,
  bookDeleteSchema,
  bookBatchUpsertSchema,
} from '../../../schemas/libraryApi';
import {openApiSpec} from './openapi';

export const apiV1Router = Router();

// Expose OpenAPI 3.0 specification for documentation, client generators, and testing
apiV1Router.get('/openapi.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openApiSpec);
});

// Apply unified authentication to all /api/v1 routes
apiV1Router.use(authenticateApiRequest({requireAllowlist: true}));

// GET /api/v1/libraries
apiV1Router.get('/libraries', async (req, res) => {
  try {
    const authedReq = req as AuthenticatedApiRequest;
    const user = authedReq.user;
    const scopesQuery = req.query.scopes;
    let scopes: Array<'owned' | 'shared' | 'all'> | undefined;
    if (typeof scopesQuery === 'string') {
      scopes = scopesQuery.split(',') as Array<'owned' | 'shared' | 'all'>;
    } else if (Array.isArray(scopesQuery)) {
      scopes = scopesQuery as Array<'owned' | 'shared' | 'all'>;
    }
    const data = await LibraryService.getUserLibraries(
      user.uid,
      user.email,
      scopes,
      authedReq.isAdmin,
    );
    res.json(data);
  } catch (err: unknown) {
    const error = err as {status?: number; message?: string};
    console.error('[API v1] Error listing libraries:', err);
    res
      .status(error?.status || 500)
      .json({error: error?.message || 'Failed to list libraries'});
  }
});

// GET /api/v1/libraries/:libraryId/books
apiV1Router.get('/libraries/:libraryId/books', async (req, res) => {
  try {
    const user = (req as AuthenticatedApiRequest).user;
    const {libraryId} = req.params;

    const missingKind = (req.query['filters[missingMetadata]'] ||
      req.query['filters.missingMetadata'] ||
      req.query.missingMetadata) as
      'geo' | 'temporal' | 'genre' | 'synopsis' | 'coverImage' | undefined;

    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

    await PermissionService.verifyLibraryAccess(user, libraryId, 'viewer');

    const result = await BookService.listBooks(user.uid, libraryId, {
      filters: missingKind ? {missingMetadata: missingKind} : undefined,
      limit,
      cursor,
    });

    res.json(result);
  } catch (err: unknown) {
    const error = err as {code?: string; message?: string};
    console.error('[API v1] Error fetching books:', err);
    const code =
      error?.code === 'NOT_FOUND'
        ? 404
        : error?.code === 'FORBIDDEN'
          ? 403
          : 500;
    res.status(code).json({error: error?.message || 'Failed to fetch books'});
  }
});

// GET /api/v1/libraries/:libraryId/books/:bookId
apiV1Router.get('/libraries/:libraryId/books/:bookId', async (req, res) => {
  try {
    const user = (req as AuthenticatedApiRequest).user;
    const {libraryId, bookId} = req.params;

    await PermissionService.verifyLibraryAccess(user, libraryId, 'viewer');
    const result = await BookService.getBook(user.uid, libraryId, bookId);
    res.json(result);
  } catch (err: unknown) {
    const error = err as {code?: string; message?: string};
    console.error('[API v1] Error fetching book:', err);
    const code =
      error?.code === 'NOT_FOUND'
        ? 404
        : error?.code === 'FORBIDDEN'
          ? 403
          : 500;
    res.status(code).json({error: error?.message || 'Failed to fetch book'});
  }
});

// POST /api/v1/libraries/:libraryId/books
apiV1Router.post('/libraries/:libraryId/books', async (req, res) => {
  try {
    const user = (req as AuthenticatedApiRequest).user;
    const {libraryId} = req.params;

    await PermissionService.verifyLibraryAccess(user, libraryId, 'editor');

    const parseResult = bookCreateSchema.safeParse({
      ...req.body,
      libraryId,
    });

    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await BookService.createBook(user.uid, parseResult.data);
    res.status(201).json(result);
  } catch (err: unknown) {
    const error = err as {code?: string; message?: string};
    console.error('[API v1] Error creating book:', err);
    const code =
      error?.code === 'FORBIDDEN'
        ? 403
        : error?.code === 'NOT_FOUND'
          ? 404
          : 500;
    res.status(code).json({error: error?.message || 'Failed to create book'});
  }
});

// PATCH /api/v1/libraries/:libraryId/books/:bookId
apiV1Router.patch('/libraries/:libraryId/books/:bookId', async (req, res) => {
  try {
    const user = (req as AuthenticatedApiRequest).user;
    const {libraryId, bookId} = req.params;

    await PermissionService.verifyLibraryAccess(user, libraryId, 'editor');

    const parseResult = bookUpdateSchema.safeParse({
      libraryId,
      bookId,
      updates: req.body,
    });

    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await BookService.updateBook(user.uid, parseResult.data);
    res.json(result);
  } catch (err: unknown) {
    const error = err as {code?: string; message?: string};
    console.error('[API v1] Error updating book:', err);
    const code =
      error?.code === 'FORBIDDEN'
        ? 403
        : error?.code === 'NOT_FOUND'
          ? 404
          : 500;
    res.status(code).json({error: error?.message || 'Failed to update book'});
  }
});

// DELETE /api/v1/libraries/:libraryId/books/:bookId
apiV1Router.delete('/libraries/:libraryId/books/:bookId', async (req, res) => {
  try {
    const user = (req as AuthenticatedApiRequest).user;
    const {libraryId, bookId} = req.params;

    await PermissionService.verifyLibraryAccess(user, libraryId, 'editor');

    const parseResult = bookDeleteSchema.safeParse({
      libraryId,
      bookId,
    });

    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await BookService.deleteBook(user.uid, parseResult.data);
    res.json(result);
  } catch (err: unknown) {
    const error = err as {code?: string; message?: string};
    console.error('[API v1] Error deleting book:', err);
    const code =
      error?.code === 'FORBIDDEN'
        ? 403
        : error?.code === 'NOT_FOUND'
          ? 404
          : 500;
    res.status(code).json({error: error?.message || 'Failed to delete book'});
  }
});

// POST /api/v1/libraries/:libraryId/books/batch
apiV1Router.post('/libraries/:libraryId/books/batch', async (req, res) => {
  try {
    const user = (req as AuthenticatedApiRequest).user;
    const {libraryId} = req.params;

    await PermissionService.verifyLibraryAccess(user, libraryId, 'editor');

    const parseResult = bookBatchUpsertSchema.safeParse({
      ...req.body,
      libraryId,
    });

    if (!parseResult.success) {
      res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const result = await BookService.batchUpsert(user.uid, parseResult.data);
    res.json(result);
  } catch (err: unknown) {
    const error = err as {code?: string; message?: string};
    console.error('[API v1] Error batch upserting books:', err);
    const code =
      error?.code === 'FORBIDDEN'
        ? 403
        : error?.code === 'NOT_FOUND'
          ? 404
          : 500;
    res
      .status(code)
      .json({error: error?.message || 'Failed to batch upsert books'});
  }
});

// POST /api/v1/libraries/:libraryId/enrichment/trigger
apiV1Router.post(
  '/libraries/:libraryId/enrichment/trigger',
  async (req, res) => {
    try {
      const user = (req as AuthenticatedApiRequest).user;
      const {libraryId} = req.params;

      const parseResult = enrichmentTriggerSchema.safeParse({
        ...req.body,
        libraryId,
      });

      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        });
        return;
      }

      const result = await EnrichmentService.triggerBatchEnrichment(
        user.uid,
        user.email,
        parseResult.data,
      );

      res.json(result);
    } catch (err: unknown) {
      const error = err as {code?: string; message?: string};
      console.error('[API v1] Error triggering enrichment:', err);
      const code =
        error?.code === 'NOT_FOUND'
          ? 404
          : error?.code === 'FORBIDDEN'
            ? 403
            : 500;
      res
        .status(code)
        .json({error: error?.message || 'Failed to trigger enrichment'});
    }
  },
);
