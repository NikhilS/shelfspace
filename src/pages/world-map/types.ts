import {Book} from '../../types';

export interface FlattenedLocationPin {
  book: Book;
  name: string;
  adminLevel: 'city' | 'state' | 'country' | 'region';
  rationale: string;
  lat: number;
  lng: number;
}

export interface MapCluster {
  id: string;
  center: {lat: number; lng: number};
  pins: FlattenedLocationPin[];
}

export type WorldMapMode = 'map' | 'heat';
