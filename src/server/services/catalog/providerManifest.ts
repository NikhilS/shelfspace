import {AppleBooksProvider} from './providers/AppleBooksProvider';
import {GoogleBooksProvider} from './providers/GoogleBooksProvider';
import {HardcoverProvider} from './providers/HardcoverProvider';
import {InventaireWikidataProvider} from './providers/InventaireWikidataProvider';
import {LibraryOfCongressProvider} from './providers/LibraryOfCongressProvider';
import {LongitoodCoverProvider} from './providers/LongitoodCoverProvider';
import {OpenLibraryProvider} from './providers/OpenLibraryProvider';
import {PenguinRandomHouseProvider} from './providers/PenguinRandomHouseProvider';
import type {CatalogSourceProvider} from './types';

export const DEFAULT_WAVE_1_PROVIDER_IDS = new Set<string>([
  'apple-books',
  'penguin-random-house',
  'google-books',
  'open-library',
]);

/**
 * Instantiates the canonical ordered set of external catalog providers.
 * To add a new catalog vendor, implement `CatalogSourceProvider` and append
 * its constructor here.
 */
export function createDefaultCatalogProviders(): CatalogSourceProvider[] {
  return [
    new AppleBooksProvider(),
    new PenguinRandomHouseProvider(),
    new HardcoverProvider(),
    new GoogleBooksProvider(),
    new OpenLibraryProvider(),
    new InventaireWikidataProvider(),
    new LongitoodCoverProvider(),
    new LibraryOfCongressProvider(),
  ];
}
