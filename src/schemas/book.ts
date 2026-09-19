import {z} from 'zod';

export const bookStatusEnum = z.enum([
  'unset',
  'reading',
  'finished',
  'abandoned',
]);

export const bookCreateSchema = z
  .object({
    libraryId: z.string().min(1, 'libraryId is required'),
    id: z.string().optional(),
    bookId: z.string().optional(),
    title: z.string().min(1, 'title is required'),
    author: z.string().default('Unknown Author'),
    isbn: z.string().optional(),
    coverUrl: z.string().optional(),
    coverUrlRaw: z.string().optional(),
    publishedDate: z.string().optional(),
    primaryGenre: z.string().optional(),
    subgenres: z.array(z.string()).optional(),
    isCustomPrimary: z.boolean().optional(),
    series: z.string().optional(),
    format: z.enum(['physical', 'digital']).optional().default('physical'),
    userStatuses: z.record(z.string(), bookStatusEnum).optional(),
    status: bookStatusEnum.optional(),
    synopsis: z.string().optional(),
    authorBio: z.string().optional(),
    embedding: z.array(z.number()).optional(),
    clusterCoordinates: z.object({x: z.number(), y: z.number()}).optional(),
    geoMetadata: z.any().optional(),
    temporalMetadata: z.any().optional(),
    bookDetailsMetadata: z.any().optional(),
    heavyDetails: z
      .object({
        synopsis: z.string().optional(),
        authorBio: z.string().optional(),
        embedding: z.array(z.number()).optional(),
        clusterCoordinates: z.object({x: z.number(), y: z.number()}).optional(),
        description: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export const bookUpdateSchema = z.object({
  libraryId: z.string().min(1, 'libraryId is required'),
  bookId: z.string().min(1, 'bookId is required'),
  updates: z.record(z.string(), z.any()),
});

export const bookDeleteSchema = z.object({
  libraryId: z.string().min(1, 'libraryId is required'),
  bookId: z.string().min(1, 'bookId is required'),
});

export const bookBatchItemSchema = z
  .object({
    id: z.string().optional(),
    bookId: z.string().optional(),
    title: z.string().optional(),
    author: z.string().optional(),
    action: z.enum(['create', 'update', 'delete', 'upsert']).optional(),
    operation: z.enum(['create', 'update', 'delete', 'upsert']).optional(),
    heavyDetails: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

export const bookBatchOperationSchema = z.object({
  type: z.enum(['create', 'update', 'delete', 'set']),
  bookId: z.string().optional(),
  data: z.record(z.string(), z.any()).optional(),
  heavyData: z.record(z.string(), z.any()).optional(),
  merge: z.boolean().optional(),
});

export const bookBatchUpsertSchema = z
  .object({
    libraryId: z.string().min(1, 'libraryId is required'),
    books: z.array(bookBatchItemSchema).optional(),
    operations: z.array(bookBatchOperationSchema).optional(),
  })
  .refine(
    data =>
      (data.books && data.books.length > 0) ||
      (data.operations && data.operations.length > 0),
    {
      message:
        'Either books or operations array must be provided and non-empty',
    },
  );

export const bookListSchema = z.object({
  libraryId: z.string().min(1, 'libraryId is required'),
  filters: z
    .object({
      missingMetadata: z
        .enum([
          'geo',
          'temporal',
          'genre',
          'primaryGenre',
          'synopsis',
          'coverImage',
        ])
        .optional(),
      primaryGenre: z.string().optional(),
      status: bookStatusEnum.optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(2000).optional().default(1000),
  cursor: z.string().optional(),
});

export type BookCreateInput = z.infer<typeof bookCreateSchema>;
export type BookUpdateInput = z.infer<typeof bookUpdateSchema>;
export type BookDeleteInput = z.infer<typeof bookDeleteSchema>;
export type BookBatchUpsertInput = z.infer<typeof bookBatchUpsertSchema>;
export type BookListInput = z.infer<typeof bookListSchema>;
