import {trpcVanilla} from '../../lib/trpc';
import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {uploadBase64Image} from '../../services/db/storage';
import {BookDetails} from '../../services/bookApi';
import {useAuth} from '../../stores/authStore';
import {logger} from '../../stores/debugStore';
import {toast} from 'sonner';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  }
  return (
    Math.random().toString(36).substring(2, 12) +
    Math.random().toString(36).substring(2, 12)
  );
}

export function useAddBooks(libraryId?: string) {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const [isAddingAll, setIsAddingAll] = useState(false);

  const addBooks = async (books: BookDetails[]) => {
    if (!libraryId || !user) {
      console.error('Library ID or User missing', {libraryId, user: !!user});
      throw new Error('Access denied or library not found');
    }
    if (books.length === 0) return [];

    setIsAddingAll(true);
    logger.info(`[useAddBooks] Starting addBooks for ${books.length} books`);

    const toastId = toast.loading(
      `Preparing to add ${books.length} book${books.length === 1 ? '' : 's'} to your library...`,
      {
        description: 'Starting background sync...',
      },
    );

    try {
      // 1. Give each new book an ID first so we can map results back correctly
      const booksWithIds = books.map(b => ({
        id: generateId(),
        ...b,
      }));

      // 2. Fetch all initial metadata from the unified layer
      const enrichedDataMap: Record<string, unknown> = {};
      try {
        logger.info(
          `[useAddBooks] Requesting TRPC server-side enrich-create for ${booksWithIds.length} books...`,
        );

        const data = await trpcVanilla.metadata.enrichCreate.mutate({
          libraryId,
          books: booksWithIds,
        });

        if (data.status === 'success' && data.results) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.results.forEach((r: any) => {
            enrichedDataMap[r.id] = r;
          });
        }
      } catch (err) {
        logger.error(`[useAddBooks] Failed to fetch enrich-create: ${err}`);
      }

      const booksToUpsert: Array<Record<string, unknown>> = [];

      for (let i = 0; i < booksWithIds.length; i++) {
        const book = booksWithIds[i];
        const added = i;
        const remaining = booksWithIds.length - i;

        toast.loading(`Processing "${book.title || 'Untitled Book'}"...`, {
          id: toastId,
          description: `Added: ${added} | Remaining: ${remaining} (Working...)`,
        });

        const cleanBook = Object.fromEntries(
          Object.entries(book).filter(
            ([, v]) => v !== undefined && v !== null && v !== '',
          ),
        ) as Record<string, string | string[] | undefined>;

        const bookId = book.id;

        if (typeof cleanBook.title === 'string')
          cleanBook.title = cleanBook.title.slice(0, 500);
        if (typeof cleanBook.author === 'string')
          cleanBook.author = cleanBook.author.slice(0, 500);

        if (
          cleanBook.coverUrl &&
          typeof cleanBook.coverUrl === 'string' &&
          cleanBook.coverUrl.startsWith('data:')
        ) {
          const storagePath = `libraries/${libraryId}/books/${bookId}/cover.png`;
          cleanBook.coverUrl = await uploadBase64Image(
            cleanBook.coverUrl,
            storagePath,
          );
        }

        if (
          cleanBook.coverUrlRaw &&
          typeof cleanBook.coverUrlRaw === 'string' &&
          cleanBook.coverUrlRaw.startsWith('data:')
        ) {
          const storagePath = `libraries/${libraryId}/books/${bookId}/cover_raw.png`;
          cleanBook.coverUrlRaw = await uploadBase64Image(
            cleanBook.coverUrlRaw,
            storagePath,
          );
        }

        const enrichedForBook = (enrichedDataMap[bookId] || {}) as Record<
          string,
          unknown
        >;

        const {
          synopsis = (enrichedForBook.synopsis as string) || undefined,
          authorBio = (enrichedForBook.authorBio as string) || undefined,
          embedding = (enrichedForBook.embeddings as number[]) || undefined,
          clusterCoordinates = undefined,
          ...otherEnrichedFields
        } = enrichedForBook;

        const {
          synopsis: _cleanSynopsis,
          authorBio: _cleanBio,
          embedding: _cleanEmbed,
          clusterCoordinates: _cleanCluster,
          ...lightweightData
        } = cleanBook;

        const hasSynopsis = Boolean(_cleanSynopsis || synopsis);
        const hasAuthorBio = Boolean(_cleanBio || authorBio);
        const hasEmbedding = Boolean((_cleanEmbed || embedding)?.length);
        const hasCluster = Boolean(_cleanCluster || clusterCoordinates);

        const coreBookData = {
          ...otherEnrichedFields, // Enriched fields at the base
          ...lightweightData, // Existing UI fields take precedence so user uploads aren't overwritten
          bookDetailsMetadata: {
            hasSynopsis,
            hasAuthorBio,
            hasEmbedding,
            hasClusterCoordinates: hasCluster,
          },
          addedBy: user.uid,
          format: lightweightData.format || 'physical',
        };

        const heavyData = {
          synopsis: _cleanSynopsis || synopsis,
          authorBio: _cleanBio || authorBio,
          embedding: _cleanEmbed || embedding,
          clusterCoordinates: _cleanCluster || clusterCoordinates,
        };
        const cleanHeavy = Object.fromEntries(
          Object.entries(heavyData).filter(([, v]) => v !== undefined),
        );

        booksToUpsert.push({
          id: bookId,
          action: 'create',
          ...coreBookData,
          heavyDetails:
            Object.keys(cleanHeavy).length > 0 ? cleanHeavy : undefined,
        });
      }

      toast.loading(
        `Committing ${books.length} book${books.length === 1 ? '' : 's'}...`,
        {
          id: toastId,
          description: 'Writing securely to cloud...',
        },
      );

      logger.info(
        `[useAddBooks] Committing additions for ${booksToUpsert.length} books via tRPC batchUpsert...`,
      );
      await trpcVanilla.book.batchUpsert.mutate({
        libraryId,
        books: booksToUpsert,
      });
      void queryClient.invalidateQueries({queryKey: ['books', libraryId]});
      logger.info('[useAddBooks] Batch commit successful.');

      const successTitle =
        books.length === 1
          ? `Successfully added "${books[0].title}"!`
          : `Successfully added ${books.length} books!`;
      const successDesc =
        books.length === 1
          ? 'Your book is now on your shelves.'
          : `Added: ${books.length} | Remaining: 0 (Done)`;

      toast.success(successTitle, {
        id: toastId,
        description: successDesc,
      });

      logger.info(`[useAddBooks] Successfully added ${books.length} books.`);
      return books;
    } catch (err) {
      logger.error(
        `[useAddBooks] Failed to add books: ${err instanceof Error ? err.message : String(err)}`,
      );
      toast.error('Failed to add books', {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      setIsAddingAll(false);
    }
  };

  return {addBooks, isAddingAll};
}
