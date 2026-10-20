import {describe, it, expect} from 'vitest';
import {
  extractLocationPins,
  filterLocationPins,
  extractGenresList,
  computeScaleClusters,
} from './worldMapMath';
import {Book} from '../../types';

const makeGeoBook = (
  id: string,
  title: string,
  author: string,
  primaryGenre: string,
  subgenres: string[],
  isNonEarth: boolean,
  locations: Array<{
    name: string;
    adminLevel: 'city' | 'state' | 'country' | 'region';
    rationale: string;
    coordinates?: {lat: number; lng: number};
  }>,
): Book =>
  ({
    id,
    title,
    author,
    primaryGenre,
    subgenres,
    createdAt: 1000,
    geoMetadata: {
      isNonEarth,
      locations,
    },
  }) as Book;

describe('worldMapMath spatial engine', () => {
  const sampleBooks: Book[] = [
    makeGeoBook(
      'b1',
      'Norwegian Wood',
      'Haruki Murakami',
      'Literary Fiction',
      ['Coming of Age'],
      false,
      [
        {
          name: 'Tokyo, Japan',
          adminLevel: 'city',
          rationale: 'University years',
          coordinates: {lat: 35.6762, lng: 139.6503},
        },
        {
          name: 'Kyoto, Japan',
          adminLevel: 'city',
          rationale: 'Sanatorium setting',
          coordinates: {lat: 35.0116, lng: 135.7681},
        },
      ],
    ),
    makeGeoBook(
      'b2',
      'Dune',
      'Frank Herbert',
      'Science Fiction',
      ['Space Opera'],
      true,
      [
        {
          name: 'Arrakis',
          adminLevel: 'region',
          rationale: 'Desert planet',
          coordinates: {lat: 0, lng: 0},
        },
      ],
    ),
    makeGeoBook(
      'b3',
      'The Dubliners',
      'James Joyce',
      'Literary Fiction',
      ['Short Stories'],
      false,
      [
        {
          name: 'Dublin, Ireland',
          adminLevel: 'city',
          rationale: 'City stories',
          coordinates: {lat: 53.3498, lng: -6.2603},
        },
        {
          name: 'Missing Coords',
          adminLevel: 'city',
          rationale: 'No lat/lng',
        },
      ],
    ),
  ];

  it('extracts only valid Earth-based pins with coordinates', () => {
    const pins = extractLocationPins(sampleBooks);
    expect(pins).toHaveLength(3);
    expect(pins.map(p => p.name)).toEqual([
      'Tokyo, Japan',
      'Kyoto, Japan',
      'Dublin, Ireland',
    ]);
  });

  it('filters pins by case-insensitive search query (location, title, author) and primary/subgenre', () => {
    const pins = extractLocationPins(sampleBooks);

    expect(filterLocationPins(pins, 'kyoto', 'all')).toHaveLength(1);
    expect(filterLocationPins(pins, 'murakami', 'all')).toHaveLength(2);
    expect(filterLocationPins(pins, 'dubliners', 'all')).toHaveLength(1);
    expect(filterLocationPins(pins, '', 'Coming of Age')).toHaveLength(2);
    expect(filterLocationPins(pins, '', 'Short Stories')).toHaveLength(1);
    expect(filterLocationPins(pins, '', 'Cyberpunk')).toHaveLength(0);
  });

  it('extracts sorted unique genres and subgenres from pins', () => {
    const pins = extractLocationPins(sampleBooks);
    expect(extractGenresList(pins)).toEqual([
      'Coming of Age',
      'Literary Fiction',
      'Short Stories',
    ]);
  });

  it('clusters nearby pins at low zoom levels and unclusters individual pins at zoom >= 10', () => {
    const pins = extractLocationPins(sampleBooks);

    // At zoom 2 (threshold = 26 degrees), Tokyo and Kyoto (~4 degrees apart) merge into one cluster
    const lowZoomClusters = computeScaleClusters(pins, 2);
    expect(lowZoomClusters).toHaveLength(2);
    const japanCluster = lowZoomClusters.find(c => c.pins.length === 2)!;
    expect(japanCluster).toBeDefined();
    expect(japanCluster.center.lat).toBeCloseTo((35.6762 + 35.0116) / 2, 4);
    expect(japanCluster.center.lng).toBeCloseTo((139.6503 + 135.7681) / 2, 4);

    // At zoom 8 (threshold = 2 degrees), Tokyo and Kyoto (~3.88 degrees lng apart) separate
    const midHighClusters = computeScaleClusters(pins, 8);
    expect(midHighClusters).toHaveLength(3);

    // At zoom 10, every pin gets its own individual pin-* entry
    const maxZoomClusters = computeScaleClusters(pins, 10);
    expect(maxZoomClusters).toHaveLength(3);
    expect(maxZoomClusters[0].id).toContain('pin-0-');
  });
});
