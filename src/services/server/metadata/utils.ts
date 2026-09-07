import {CoreBookData, MetadataKey} from '../../../types/metadata';
import {MetadataRegistry} from './registry';

/**
 * Resolves synopses for a batch of books using bulk lookup.
 * Books that already contain a non-empty synopsis are preserved;
 * missing ones are queried in a single bulkFetch batch to the synopsis provider.
 */
export async function resolveBookSynopses(
  books: CoreBookData[],
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

  if (missingSynopsisBooks.length > 0) {
    const synopsisProvider = MetadataRegistry.getInstance().getProvider(
      MetadataKey.SYNOPSIS,
    );
    const isAvailable =
      typeof synopsisProvider?.isAvailable === 'function'
        ? synopsisProvider.isAvailable()
        : !!synopsisProvider;
    if (synopsisProvider && isAvailable) {
      try {
        const bulkSynopses = (await synopsisProvider.bulkFetch(
          missingSynopsisBooks,
        )) as Record<string, string>;
        if (bulkSynopses) {
          for (const [id, syn] of Object.entries(bulkSynopses)) {
            if (syn && typeof syn === 'string' && syn.trim().length > 0) {
              synopsisMap.set(id, syn.trim());
            }
          }
        }
      } catch (err) {
        console.error(
          '[resolveBookSynopses] Error in bulk fetching missing synopses:',
          err,
        );
      }
    }
  }

  return synopsisMap;
}
