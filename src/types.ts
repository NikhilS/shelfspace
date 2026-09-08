import {Timestamp} from 'firebase/firestore';
import {BookDetails} from './services/bookApi';

export type FirestoreDate = Timestamp;

export interface Library {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  access?: Record<string, 'owner' | 'editor' | 'viewer'>;
  createdAt: Timestamp;
  heroImageUrl?: string;
  bookCount?: number;
}

export interface UserStatuses {
  [userId: string]: 'unset' | 'reading' | 'finished' | 'abandoned';
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
  'completed' | 'unsupported' | 'failed' | 'pending';

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

export interface Book extends Omit<BookDetails, 'synopsis' | 'authorBio'> {
  id: string;
  addedBy: string | null;
  addedAt: FirestoreDate;
  updatedAt?: string;
  userStatuses?: UserStatuses;
  geoMetadata?: BookGeoMetadata;
  temporalMetadata?: BookTemporalMetadata;
  enrichmentStatus?: BookEnrichmentStatus;
  bookDetailsMetadata?: BookDetailsMetadata;
  coverUrlRaw?: string;
}

export interface BookDetailsPayload {
  synopsis?: string;
  authorBio?: string;
  embedding?: number[];
  clusterCoordinates?: {x: number; y: number};
  description?: string;
  updatedAt?: string;
}
