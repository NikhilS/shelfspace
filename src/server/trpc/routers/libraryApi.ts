import {z} from 'zod';
import {router, protectedProcedure, libraryProcedure} from '../trpc';
import {LibraryService} from '../../services/library';
import {
  libraryListSchema,
  libraryResetMetadataSchema,
  libraryUploadImageSchema,
} from '../../../schemas/libraryApi';
import {
  safeIdSchema,
  safeEmailSchema,
  safeUrlSchema,
} from '../../../schemas/common';

export const libraryApiRouter = router({
  list: protectedProcedure
    .input(libraryListSchema)
    .query(async ({ctx, input}) => {
      return await LibraryService.getUserLibraries(
        ctx.user.uid,
        ctx.user.email,
        input?.scopes ?? ['owned', 'shared'],
        ctx.isAdmin,
      );
    }),

  get: libraryProcedure('viewer')
    .input(z.object({libraryId: safeIdSchema}))
    .query(async ({ctx, input}) => {
      return await LibraryService.getLibrary(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        {
          skipAccessCheck: true,
          prefetchedData: ctx.libraryData,
          callerRole: ctx.callerRole,
        },
      );
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        heroImageUrl: safeUrlSchema.nullable().optional(),
      }),
    )
    .mutation(async ({ctx, input}) => {
      return await LibraryService.createLibrary(
        ctx.user.uid,
        ctx.user.email,
        ctx.user.name,
        input,
      );
    }),

  update: libraryProcedure('editor')
    .input(
      z.object({
        libraryId: safeIdSchema,
        name: z.string().trim().min(1).max(120).optional(),
        heroImageUrl: safeUrlSchema.nullable().optional(),
        access: z
          .record(safeEmailSchema, z.enum(['owner', 'editor', 'viewer']))
          .optional(),
      }),
    )
    .mutation(async ({ctx, input}) => {
      const {libraryId, ...updates} = input;
      return await LibraryService.updateLibrary(
        ctx.user.uid,
        ctx.user.email,
        libraryId,
        updates,
        {skipAccessCheck: true, callerRole: ctx.callerRole},
      );
    }),

  upsertCollaborator: libraryProcedure('owner')
    .input(
      z.object({
        libraryId: safeIdSchema,
        email: safeEmailSchema,
        role: z.enum(['editor', 'viewer']),
      }),
    )
    .mutation(async ({ctx, input}) => {
      return await LibraryService.upsertCollaborator(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.email,
        input.role,
        {skipAccessCheck: true},
      );
    }),

  removeCollaborator: libraryProcedure('owner')
    .input(
      z.object({
        libraryId: safeIdSchema,
        email: safeEmailSchema,
      }),
    )
    .mutation(async ({ctx, input}) => {
      return await LibraryService.removeCollaborator(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.email,
        {skipAccessCheck: true},
      );
    }),

  getCollaborators: libraryProcedure('viewer')
    .input(z.object({libraryId: safeIdSchema}))
    .query(async ({ctx, input}) => {
      return await LibraryService.getCollaboratorStatuses(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        {skipAccessCheck: true, prefetchedData: ctx.libraryData},
      );
    }),

  delete: libraryProcedure('owner')
    .input(z.object({libraryId: safeIdSchema}))
    .mutation(async ({ctx, input}) => {
      return await LibraryService.deleteLibrary(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        {skipAccessCheck: true},
      );
    }),

  getUserRole: protectedProcedure
    .input(z.object({libraryId: safeIdSchema}))
    .query(async ({ctx, input}) => {
      return await LibraryService.getUserRole(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
      );
    }),

  listAllowedDuplicates: libraryProcedure('viewer')
    .input(z.object({libraryId: safeIdSchema}))
    .query(async ({input}) => {
      return await LibraryService.listAllowedDuplicates(input.libraryId);
    }),

  allowDuplicateGroup: libraryProcedure('editor')
    .input(
      z.object({
        libraryId: safeIdSchema,
        bookIds: z.array(safeIdSchema).min(2).max(100),
      }),
    )
    .mutation(async ({input}) => {
      return await LibraryService.allowDuplicateGroup(
        input.libraryId,
        input.bookIds,
      );
    }),

  resetMetadata: libraryProcedure('editor')
    .input(libraryResetMetadataSchema)
    .mutation(async ({ctx, input}) => {
      return await LibraryService.resetMetadata(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.metadataType,
        {skipAccessCheck: true},
      );
    }),

  uploadImage: libraryProcedure('editor')
    .input(libraryUploadImageSchema)
    .mutation(async ({ctx, input}) => {
      return await LibraryService.uploadImage(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.path,
        input.base64Data,
        {skipAccessCheck: true},
      );
    }),
});
