import type {
  BookDetails,
  CoverCandidate,
  GeoLocationReference,
  BookGeoMetadata,
  BookTemporalMetadata,
  EnrichmentTypeStatus,
  BookEnrichmentStatus,
  BookDetailsMetadata,
  ClusterCoordinates,
  BookDetailsPayload,
  StoredBookDetailsDoc,
  StoredBookDoc,
  StoredReviewDoc,
  BookReviewRecord,
  StoredBookTombstoneDoc,
  ReadingStateKeyType,
  MinimalBookStub,
  UserReadingState,
  StoredUserReadingStateDoc,
  UserReadingStateBookSnapshot,
} from '../schemas/book';
import type {
  StoredLibraryDoc,
  StoredAllowedDuplicateDoc,
  StoredEnrichmentJobDoc,
  StoredUserProfileDoc,
  UserProfile,
} from '../schemas/libraryApi';
import type {
  StoredAllowlistUserDoc,
  StoredWaitlistEntryDoc,
} from '../schemas/waitlist';
import type {
  GeolocationCoordinates,
  StoredGeolocationCacheDoc,
} from '../schemas/geolocation';
import {
  computeReadingStateKey,
  resolveReadingStateKeyType,
} from '../schemas/book';

export * from './metadata';
export * from './readingTracker';

export {computeReadingStateKey, resolveReadingStateKeyType};

export type {
  BookDetails,
  CoverCandidate,
  GeoLocationReference,
  BookGeoMetadata,
  BookTemporalMetadata,
  EnrichmentTypeStatus,
  BookEnrichmentStatus,
  BookDetailsMetadata,
  ClusterCoordinates,
  BookDetailsPayload,
  StoredBookDetailsDoc,
  StoredBookDoc,
  StoredReviewDoc,
  BookReviewRecord,
  StoredBookTombstoneDoc,
  ReadingStateKeyType,
  MinimalBookStub,
  UserReadingState,
  StoredUserReadingStateDoc,
  UserReadingStateBookSnapshot,
  StoredLibraryDoc,
  StoredAllowedDuplicateDoc,
  StoredEnrichmentJobDoc,
  StoredUserProfileDoc,
  UserProfile,
  StoredAllowlistUserDoc,
  StoredWaitlistEntryDoc,
  GeolocationCoordinates,
  StoredGeolocationCacheDoc,
};

export interface Timestamp {
  seconds?: number;
  nanoseconds?: number;
  toDate?: () => Date;
  toMillis?: () => number;
}

export type FirestoreDate = Timestamp | Date | string | number;

export type ReadingStatusValue =
  'unset' | 'want_to_read' | 'reading' | 'finished' | 'abandoned';

export type OwnershipStatus = 'owned' | 'unowned';

export interface Library {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  access?: Record<string, 'owner' | 'editor' | 'viewer'>;
  collaboratorEmails?: string[];
  activeJobId?: string | null;
  createdAt: Timestamp | string;
  updatedAt?: Timestamp | string;
  heroImageUrl?: string | null;
  bookCount?: number;
  isVirtual?: boolean;
  callerRole?: 'owner' | 'editor' | 'viewer' | 'admin' | null;
  ownershipType?: 'owned' | 'shared' | 'global_admin';
  isOwner?: boolean;
  canEdit?: boolean;
}

export interface Book extends Omit<
  BookDetails,
  'synopsis' | 'authorBio' | 'isbn' | 'coverUrl' | 'publishedDate'
> {
  id: string;
  libraryId?: string;
  libraryName?: string;
  isVirtual?: boolean;
  readingStatus?: ReadingStatusValue;
  userRating?: number;
  readStatusReviewedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  isbn?: string;
  coverUrl?: string;
  publishedDate?: string;
  primaryGenreLower?: string;
  missingFlags?: string[];
  ownershipStatus?: OwnershipStatus;
  addedBy?: string | null;
  addedAt: FirestoreDate;
  updatedAt?: FirestoreDate;
  geoMetadata?: BookGeoMetadata;
  temporalMetadata?: BookTemporalMetadata;
  enrichmentStatus?: BookEnrichmentStatus;
  bookDetailsMetadata?: BookDetailsMetadata;
  cleanIsbn?: string;
  dedupeKey?: string;
  searchTokens?: string[];
  hasSearchTokens?: boolean;
  coverUrlRaw?: string;
  synopsis?: string;
  authorBio?: string;
  embedding?: number[];
  clusterCoordinates?: ClusterCoordinates;
}

export interface TelemetryLogPayload {
  fromCache?: boolean;
  durationMs?: number;
  byteSize?: number;
  status?: string;
  path?: string;
  operation?: string;
  [key: string]: unknown;
}
