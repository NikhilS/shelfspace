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
  BookReviewRecord,
} from '../schemas/book';

export * from './metadata';

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
  BookReviewRecord,
};

export interface Timestamp {
  seconds?: number;
  nanoseconds?: number;
  toDate?: () => Date;
  toMillis?: () => number;
}

export type FirestoreDate = Timestamp | Date | string | number;

export type ReadingStatusValue =
  'unset' | 'want_to_read' | 'reading' | 'finished' | 'completed' | 'abandoned';

export type OwnershipStatus = 'owned' | 'unowned';

export interface Library {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  access?: Record<string, 'owner' | 'editor' | 'viewer'>;
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

export interface UserStatuses {
  [userId: string]: ReadingStatusValue;
}

export interface UserRatings {
  [userId: string]: number;
}

export interface Book extends Omit<
  BookDetails,
  'synopsis' | 'authorBio' | 'isbn' | 'coverUrl' | 'publishedDate' | 'status'
> {
  id: string;
  libraryId?: string;
  libraryName?: string;
  isVirtual?: boolean;
  readingStatus?: ReadingStatusValue;
  userRating?: number;
  isbn?: string;
  coverUrl?: string;
  publishedDate?: string;
  status?: ReadingStatusValue;
  ownershipStatus?: OwnershipStatus;
  addedBy?: string | null;
  addedAt: FirestoreDate;
  updatedAt?: FirestoreDate;
  userStatuses?: UserStatuses;
  userRatings?: UserRatings;
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
  heavyDetails?: BookDetailsPayload;
}

export interface FilteredBookRecord {
  id: string;
  title: string;
  author: string;
  isbn?: string;
  synopsis?: string;
  primaryGenre?: string;
  subgenres?: string[];
  isCustomPrimary?: boolean;
  genre?: string;
  coverImage?: string;
  geoData?: BookGeoMetadata;
  temporalData?: BookTemporalMetadata;
  metadataStatus: {
    hasGeo: boolean;
    hasTemporal: boolean;
    hasGenre: boolean;
    hasSynopsis: boolean;
    hasCoverImage: boolean;
  };
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
