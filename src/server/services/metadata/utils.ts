import {
  type CoreBookData,
  type MetadataBulkFetchOptions,
  type MetadataProvider,
} from '../../../types/metadata';
import {SynopsisMetadataProvider} from './providers/SynopsisMetadataProvider';

type SynopsisProviderResolver = () =>
  MetadataProvider<string | null> | undefined;

let synopsisProviderResolver: SynopsisProviderResolver | null = null;
let fallbackSynopsisProvider: SynopsisMetadataProvider | null = null;

/**
 * Registers a dynamic lookup hook for the active Synopsis provider so
 * `resolveBookSynopses` never imports `MetadataRegistry` (eliminating circular
 * module initialization between `registry.ts`, providers, and `utils.ts`).
 */
export function registerSynopsisProviderResolver(
  resolver: SynopsisProviderResolver,
): void {
  synopsisProviderResolver = resolver;
}

function getActiveSynopsisProvider():
  MetadataProvider<string | null> | undefined {
  if (synopsisProviderResolver) {
    return synopsisProviderResolver();
  }
  if (!fallbackSynopsisProvider) {
    fallbackSynopsisProvider = new SynopsisMetadataProvider();
  }
  return fallbackSynopsisProvider;
}

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
    const rawSynopsis = b.synopsis;
    if (typeof rawSynopsis === 'string' && rawSynopsis.trim().length > 0) {
      synopsisMap.set(b.id, rawSynopsis.trim());
    } else {
      missingSynopsisBooks.push(b);
    }
  }

  if (missingSynopsisBooks.length > 0 && !options?.signal?.aborted) {
    const synopsisProvider = getActiveSynopsisProvider();
    const isAvailable =
      typeof synopsisProvider?.isAvailable === 'function'
        ? synopsisProvider.isAvailable()
        : Boolean(synopsisProvider);
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
                if (scopedAbort.signal.aborted) {
                  return;
                }
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
