import {useMemo, useState, useEffect, useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import {Book} from '../../types';
import {toast} from 'sonner';
import {useAuth} from '../../stores/authStore';
import {useLibraryData} from '../../hooks/useLibraryData';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {instrumentMutation} from '../../lib/telemetry';
import {
  detectDuplicatesWithConfidence,
  DuplicateGroupMetadata,
} from '../../lib/duplicateDetection';
import {DuplicateMergePayload} from './DuplicateMergeModal';

export function useSpruceUp(libraryId: string | undefined) {
  const {user} = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  const {
    books,
    isBooksLoading: rawBooksLoading,
    isPaginating: booksPaginating,
  } = useLibraryData(libraryId, user?.uid, navigate);
  const booksLoading = Boolean(rawBooksLoading || booksPaginating);

  const allowedQuery = trpc.library.listAllowedDuplicates.useQuery(
    {libraryId: libraryId || ''},
    {enabled: !!libraryId},
  );

  const deleteBookMutation = trpc.book.delete.useMutation({
    onSuccess: () => {
      if (libraryId) {
        void utilsRef.current.book.list.invalidate({libraryId});
        void utilsRef.current.library.get?.invalidate({libraryId});
        void utilsRef.current.library.list?.invalidate();
      }
    },
  });

  const allowDuplicateGroupMutation =
    trpc.library.allowDuplicateGroup.useMutation({
      onSuccess: () => {
        if (libraryId) {
          void allowedQuery.refetch();
        }
      },
    });

  const allowedDuplicateGroups = useMemo(() => {
    return allowedQuery.data?.allowedDuplicateGroups || [];
  }, [allowedQuery.data]);

  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [isAuditingCovers, setIsAuditingCovers] = useState(false);
  const auditedLibrariesRef = useRef<Set<string>>(new Set());
  const [rawDuplicateGroups, setRawDuplicateGroups] = useState<
    DuplicateGroupMetadata[]
  >([]);
  const [isScanningDuplicates, setIsScanningDuplicates] = useState<boolean>(
    () => Boolean(booksLoading || (books && books.length >= 2)),
  );
  const workerRef = useRef<Worker | null>(null);
  const latestBooksRef = useRef<Book[]>(books);
  latestBooksRef.current = books;

  useEffect(() => {
    if (!libraryId || booksLoading || !books || books.length === 0) {
      return;
    }
    if (auditedLibrariesRef.current.has(libraryId)) {
      return;
    }

    const hasAuditableCovers = books.some(book => {
      const urls = [book.coverUrl, book.coverUrlRaw];
      return urls.some(
        u =>
          typeof u === 'string' &&
          (u.includes('books.google.com') ||
            u.includes('books.googleusercontent.com') ||
            u.includes('images.randomhouse.com') ||
            u.includes('covers.openlibrary.org')),
      );
    });

    auditedLibrariesRef.current.add(libraryId);
    if (!hasAuditableCovers) {
      return;
    }

    const enrichmentClient = (
      trpcVanilla as unknown as {
        enrichment?: {
          auditPlaceholderCovers?: {
            mutate: (input: {libraryId: string}) => Promise<{
              scannedCount: number;
              clearedCount: number;
              clearedBookIds: string[];
            }>;
          };
        };
      }
    ).enrichment;

    if (!enrichmentClient?.auditPlaceholderCovers?.mutate) {
      return;
    }

    let cancelled = false;
    setIsAuditingCovers(true);

    void enrichmentClient.auditPlaceholderCovers
      .mutate({libraryId})
      .then(result => {
        if (cancelled || !result || result.clearedCount <= 0) {
          return;
        }
        const clearedSet = new Set(result.clearedBookIds);
        if (typeof utilsRef.current.book?.list?.setData === 'function') {
          utilsRef.current.book.list.setData({libraryId}, old => {
            if (!old) {
              return old;
            }
            const clearBookCover = (b: Book): Book => {
              if (!clearedSet.has(b.id)) {
                return b;
              }
              const nextStatus = {...(b.enrichmentStatus || {})};
              delete nextStatus.coverImage;
              return {
                ...b,
                coverUrl: undefined,
                coverUrlRaw: undefined,
                enrichmentStatus: nextStatus,
              };
            };
            if (Array.isArray(old)) {
              return (old as Book[]).map(
                clearBookCover,
              ) as unknown as typeof old;
            }
            return {
              ...old,
              books: (old.books || []).map(clearBookCover),
            };
          });
        }
        void utilsRef.current.book?.list?.invalidate?.({libraryId});
        toast.info(
          result.clearedCount === 1
            ? 'Cleared 1 placeholder book cover so it can be backfilled.'
            : `Cleared ${result.clearedCount} placeholder book covers so they can be backfilled.`,
        );
      })
      .catch(err => {
        console.warn('Placeholder cover audit failed:', err);
      })
      .finally(() => {
        if (!cancelled) {
          setIsAuditingCovers(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [libraryId, booksLoading, books]);

  const booksFingerprint = useMemo(() => {
    if (!books || books.length === 0) {
      return '';
    }
    return `${books.length}:${books
      .map(b => `${b.id}:${b.isbn || ''}:${b.title}:${b.author || ''}`)
      .join('|')}`;
  }, [books]);

  useEffect(() => {
    if (booksLoading) {
      setIsScanningDuplicates(true);
      return;
    }

    const currentBooks = latestBooksRef.current;
    if (!currentBooks || currentBooks.length < 2) {
      setRawDuplicateGroups([]);
      setIsScanningDuplicates(false);
      return;
    }

    setIsScanningDuplicates(true);
    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const runAsyncFallback = () => {
      fallbackTimer = setTimeout(() => {
        if (cancelled) {
          return;
        }
        const computed = detectDuplicatesWithConfidence(currentBooks);
        if (!cancelled) {
          setRawDuplicateGroups(computed);
          setIsScanningDuplicates(false);
        }
      }, 0);
    };

    if (typeof Worker !== 'undefined') {
      try {
        workerRef.current?.terminate();
        const worker = new Worker(
          new URL(
            '../../workers/duplicateDetection.worker.ts',
            import.meta.url,
          ),
          {type: 'module'},
        );
        workerRef.current = worker;

        worker.onmessage = (
          e: MessageEvent<{groups: DuplicateGroupMetadata[]; error?: string}>,
        ) => {
          if (!cancelled) {
            if (!e.data.error && Array.isArray(e.data.groups)) {
              setRawDuplicateGroups(e.data.groups);
            } else {
              setRawDuplicateGroups(
                detectDuplicatesWithConfidence(currentBooks),
              );
            }
            setIsScanningDuplicates(false);
          }
          worker.terminate();
          if (workerRef.current === worker) {
            workerRef.current = null;
          }
        };

        worker.onerror = () => {
          worker.terminate();
          if (workerRef.current === worker) {
            workerRef.current = null;
          }
          if (!cancelled) {
            runAsyncFallback();
          }
        };

        worker.postMessage({books: currentBooks});
      } catch {
        runAsyncFallback();
      }
    } else {
      runAsyncFallback();
    }

    return () => {
      cancelled = true;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
      }
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [booksFingerprint, booksLoading]);

  const duplicateGroupsWithMeta = useMemo(() => {
    return rawDuplicateGroups.filter(group => {
      const groupIds = group.books.map(b => b.id);
      const isAllowed = allowedDuplicateGroups.some(allowedGroup =>
        groupIds.every(id => allowedGroup.includes(id)),
      );
      return !isAllowed;
    });
  }, [rawDuplicateGroups, allowedDuplicateGroups]);

  const duplicates = useMemo(
    () => duplicateGroupsWithMeta.map(g => g.books),
    [duplicateGroupsWithMeta],
  );

  const handleDelete = async (id: string) => {
    if (!libraryId) {
      return;
    }
    const originalData = utilsRef.current.book.list.getData({libraryId});
    setProcessingIds(prev => new Set(prev).add(id));
    try {
      utilsRef.current.book.list.setData({libraryId}, old => {
        if (!old) {
          return {books: []};
        }
        if (Array.isArray(old)) {
          return (old as Book[]).filter(
            b => b.id !== id,
          ) as unknown as typeof old;
        }
        return {
          ...old,
          books: (old.books || []).filter(b => b.id !== id),
        };
      });

      await instrumentMutation(
        'delete',
        `libraries/${libraryId}/books/${id}`,
        {libraryId, bookId: id},
        () => deleteBookMutation.mutateAsync({libraryId, bookId: id}),
      );
      toast.success('Book deleted');
    } catch (error) {
      if (originalData) {
        utilsRef.current.book.list.setData({libraryId}, originalData);
      }
      toast.error('Failed to delete book');
      console.error('Failed to delete book:', error);
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleAllowDuplicateGroup = async (group: Book[]) => {
    if (!libraryId) {
      return;
    }
    const bookIds = group.map(b => b.id);
    try {
      await instrumentMutation(
        'create',
        `libraries/${libraryId}/allowedDuplicates`,
        {bookIds},
        () =>
          allowDuplicateGroupMutation.mutateAsync({
            libraryId,
            bookIds,
          }),
      );
      toast.success('Duplicate suggestion dismissed');
    } catch (error) {
      toast.error('Failed to dismiss suggestion');
      console.error('Failed to dismiss duplicate suggestion:', error);
    }
  };

  const handleMergeDuplicates = async (payload: DuplicateMergePayload) => {
    if (!libraryId) {
      return;
    }
    const bookClient = trpcVanilla.book as unknown as {
      mergeDuplicates?: {
        mutate: (
          input: DuplicateMergePayload & {libraryId: string},
        ) => Promise<unknown>;
      };
    };

    try {
      if (bookClient?.mergeDuplicates?.mutate) {
        await bookClient.mergeDuplicates.mutate({
          libraryId,
          ...payload,
        });
      }
      await utilsRef.current.book.list.invalidate({libraryId});
      void utilsRef.current.library.get?.invalidate({libraryId});
      void utilsRef.current.library.list?.invalidate();
      toast.success('Duplicate records merged into surviving edition');
    } catch (error) {
      toast.error('Failed to merge duplicate books');
      console.error('Failed to merge duplicate books:', error);
      throw error;
    }
  };

  const loading = booksLoading;
  const isCheckingDuplicates = isScanningDuplicates || allowedQuery.isLoading;

  return {
    loading,
    isCheckingDuplicates,
    isAuditingCovers,
    books,
    duplicates,
    duplicateGroupsWithMeta,
    processingIds,
    handleDelete,
    handleAllowDuplicateGroup,
    handleMergeDuplicates,
  };
}
