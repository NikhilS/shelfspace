import {Timestamp} from 'firebase/firestore';
import {BookDetails} from './services/bookApi';

export type FirestoreDate = Timestamp;

export interface Library {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  sharedWith: string[];
  createdAt: Timestamp;
  heroImageUrl?: string;
  bookCount?: number;
}

export interface UserStatuses {
  [userId: string]: 'unset' | 'reading' | 'finished' | 'abandoned';
}

export interface Book extends Omit<BookDetails, 'synopsis'> {
  id: string;
  addedBy: string | null;
  addedAt: FirestoreDate;
  userStatuses?: UserStatuses;
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
}

export interface BookDetailsPayload {
  synopsis?: string;
  authorBio?: string;
  embedding?: number[];
  clusterCoordinates?: {x: number; y: number};
}
