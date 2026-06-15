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

export interface Book extends Omit<BookDetails, 'synopsis'> {
  id: string;
  addedBy: string | null;
  addedAt: FirestoreDate;
  userStatuses?: UserStatuses;
  geoMetadata?: BookGeoMetadata;
  temporalMetadata?: BookTemporalMetadata;
  // Metadata fields that might still be in the books collection (legacy)
  synopsis?: string;
  authorBio?: string;
  embedding?: number[];
  clusterCoordinates?: {x: number; y: number};

  // Field used during Spruce Up migrations to track what's still in the main document
  _inBooks?: {
    synopsis: boolean;
    authorBio: boolean;
    embedding: boolean;
    clusterCoordinates: boolean;
  };
  coverUrlRaw?: string;
}

export interface BookDetailsPayload {
  synopsis?: string;
  authorBio?: string;
  embedding?: number[];
  clusterCoordinates?: {x: number; y: number};
}
