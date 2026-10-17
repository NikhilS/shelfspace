import type {BookDetails} from '../services/bookApi';

export * from './metadata';

export interface Timestamp {
  seconds?: number;
  nanoseconds?: number;
  toDate?: () => Date;
  toMillis?: () => number;
}

export type FirestoreDate = Timestamp | Date | string | number;

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
  callerRole?: 'owner' | 'editor' | 'viewer' | 'admin' | null;
  ownershipType?: 'owned' | 'shared' | 'global_admin';
  isOwner?: boolean;
  canEdit?: boolean;
}

export interface UserStatuses {
  [userId: string]:
    'unset' | 'reading' | 'finished' | 'completed' | 'abandoned';
}

export interface GeoLocationReference {
  name: string;
  adminLevel: 'city' | 'state' | 'country' | 'region';
  rationale: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface BookGeoMetadata {
  isNonEarth: boolean;
  locations: GeoLocationReference[];
  lastSyncedAt: string;
}

export interface BookTemporalMetadata {
  isNonHistorical: boolean;
  startYear?: number;
  endYear?: number;
  eraName?: string;
  rationale?: string;
  lastProcessedAt: string;
}

export type EnrichmentTypeStatus =
  | 'completed'
  | 'unsupported'
  | 'failed'
  | 'pending'
  | 'in_progress'
  | 'processing'
  | 'skipped';

export interface BookEnrichmentStatus {
  geo?: EnrichmentTypeStatus;
  temporal?: EnrichmentTypeStatus;
  genre?: EnrichmentTypeStatus;
  synopsis?: EnrichmentTypeStatus;
  authorBio?: EnrichmentTypeStatus;
  coverImage?: EnrichmentTypeStatus;
  embedding?: EnrichmentTypeStatus;
  lastAttemptedAt?: string;
}

export interface BookDetailsMetadata {
  hasSynopsis?: boolean;
  hasAuthorBio?: boolean;
  hasEmbedding?: boolean;
  hasDescription?: boolean;
  hasClusterCoordinates?: boolean;
}

export interface Book extends Omit<
  BookDetails,
  'synopsis' | 'authorBio' | 'isbn' | 'coverUrl' | 'publishedDate' | 'status'
> {
  id: string;
  libraryId?: string;
  isbn?: string;
  coverUrl?: string;
  publishedDate?: string;
  status?: 'unset' | 'reading' | 'finished' | 'completed' | 'abandoned';
  addedBy?: string | null;
  addedAt: FirestoreDate;
  updatedAt?: FirestoreDate;
  userStatuses?: UserStatuses;
  geoMetadata?: BookGeoMetadata;
  temporalMetadata?: BookTemporalMetadata;
  enrichmentStatus?: BookEnrichmentStatus;
  bookDetailsMetadata?: BookDetailsMetadata;
  coverUrlRaw?: string;
  synopsis?: string;
  authorBio?: string;
  embedding?: number[];
  clusterCoordinates?: {
    x: number;
    y: number;
    clusterId?: number;
    clusterName?: string;
  };
  heavyDetails?: BookDetailsPayload;
}

export interface BookDetailsPayload {
  synopsis?: string;
  authorBio?: string;
  embedding?: number[];
  clusterCoordinates?: {
    x: number;
    y: number;
    clusterId?: number;
    clusterName?: string;
  };
  description?: string;
  updatedAt?: FirestoreDate;
}

export interface BookReviewRecord {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  text: string;
  createdAt?: string;
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
