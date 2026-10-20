import {
  CoreBookData,
  MetadataBulkFetchOptions,
  MetadataKey,
} from '../../../types/metadata';
import {MetadataRegistry} from './registry';

/**
 * Resolves synopses for a batch of books using bulk lookup.
 * Books that already contain a non-empty synopsis are preserved;
 * missing ones are queried via the synopsis provider, capturing incremental
 * per-book results so partial completions are never lost if a slow book times out.
 */
export async function resolveBookSynopses(
  books: CoreBookData[],
  options?: MetadataBulkFetchOptions,
): Promise<Map<string, string>> {
  const synopsisMap = new Map<string, string>();
  const missingSynopsisBooks: CoreBookData[] = [];

  for (const b of books) {
    const rawSynopsis =
      (b as Record<string, unknown>).synopsis ||
      (b as Record<string, unknown>).description;
    if (typeof rawSynopsis === 'string' && rawSynopsis.trim().length > 0) {
      synopsisMap.set(b.id, rawSynopsis.trim());
    } else {
      missingSynopsisBooks.push(b);
    }
  }

  if (missingSynopsisBooks.length > 0 && !options?.signal?.aborted) {
    const synopsisProvider = MetadataRegistry.getInstance().getProvider<
      string | null
    >(MetadataKey.SYNOPSIS);
    const isAvailable =
      typeof synopsisProvider?.isAvailable === 'function'
        ? synopsisProvider.isAvailable()
        : !!synopsisProvider;
    if (synopsisProvider && isAvailable) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const scopedAbort = new AbortController();
      const onParentAbort = () => scopedAbort.abort();
      options?.signal?.addEventListener('abort', onParentAbort, {once: true});

      try {
        const fetchTask = (async () => {
          if (typeof synopsisProvider.bulkFetch === 'function') {
            const bulkSynopses = await synopsisProvider.bulkFetch(
              missingSynopsisBooks,
              {signal: scopedAbort.signal},
            );
            if (bulkSynopses) {
              for (const [id, syn] of Object.entries(bulkSynopses)) {
                if (syn && typeof syn === 'string' && syn.trim().length > 0) {
                  synopsisMap.set(id, syn.trim());
                }
              }
            }
          } else if (typeof synopsisProvider.fetch === 'function') {
            await Promise.all(
              missingSynopsisBooks.map(async book => {
                if (scopedAbort.signal.aborted) return;
                const syn = await synopsisProvider.fetch(book, {
                  signal: scopedAbort.signal,
                });
                if (syn && typeof syn === 'string' && syn.trim().length > 0) {
                  synopsisMap.set(book.id, syn.trim());
                }
              }),
            );
          }
        })();

        const timeoutPromise = new Promise<void>(resolve => {
          timeoutId = setTimeout(() => {
            scopedAbort.abort();
            resolve();
          }, 15000);
        });

        await Promise.race([fetchTask, timeoutPromise]);
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error(
            '[resolveBookSynopses] Error in bulk fetching missing synopses:',
            err,
          );
        }
      } finally {
        options?.signal?.removeEventListener('abort', onParentAbort);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    }
  }

  return synopsisMap;
}
