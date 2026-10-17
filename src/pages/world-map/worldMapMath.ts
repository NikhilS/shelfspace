import {Book} from '../../types';
import {FlattenedLocationPin, MapCluster} from './types';

export function extractLocationPins(books: Book[]): FlattenedLocationPin[] {
  const list: FlattenedLocationPin[] = [];
  for (const b of books) {
    if (
      b.geoMetadata &&
      !b.geoMetadata.isNonEarth &&
      Array.isArray(b.geoMetadata.locations)
    ) {
      for (const loc of b.geoMetadata.locations) {
        if (
          loc.coordinates?.lat !== undefined &&
          loc.coordinates?.lng !== undefined
        ) {
          list.push({
            book: b,
            name: loc.name,
            adminLevel: loc.adminLevel,
            rationale: loc.rationale,
            lat: loc.coordinates.lat,
            lng: loc.coordinates.lng,
          });
        }
      }
    }
  }
  return list;
}

export function filterLocationPins(
  flattenedPins: FlattenedLocationPin[],
  searchQuery: string,
  selectedGenre: string,
): FlattenedLocationPin[] {
  return flattenedPins.filter(pin => {
    const matchesSearch =
      pin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pin.book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (pin.book.author || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesGenre =
      selectedGenre === 'all' ||
      pin.book.primaryGenre?.toLowerCase() === selectedGenre.toLowerCase() ||
      (pin.book.subgenres &&
        pin.book.subgenres.some(
          sg => sg.toLowerCase() === selectedGenre.toLowerCase(),
        ));

    return matchesSearch && matchesGenre;
  });
}

export function extractGenresList(
  flattenedPins: FlattenedLocationPin[],
): string[] {
  const set = new Set<string>();
  for (const pin of flattenedPins) {
    if (pin.book.primaryGenre) {
      set.add(pin.book.primaryGenre);
    }
    if (Array.isArray(pin.book.subgenres)) {
      pin.book.subgenres.forEach(sg => set.add(sg));
    }
  }
  return Array.from(set).sort();
}

export function computeScaleClusters(
  filteredPins: FlattenedLocationPin[],
  zoom: number,
): MapCluster[] {
  const threshold =
    zoom <= 2 ? 26 : zoom <= 4 ? 14 : zoom <= 6 ? 6 : zoom <= 8 ? 2 : 0.5;

  if (zoom >= 10) {
    return filteredPins.map((p, i) => ({
      id: `pin-${i}-${p.name}`,
      center: {lat: p.lat, lng: p.lng},
      pins: [p],
    }));
  }

  const clusters: MapCluster[] = [];

  for (const pin of filteredPins) {
    let added = false;
    for (const clust of clusters) {
      const dLat = Math.abs(clust.center.lat - pin.lat);
      const dLng = Math.abs(clust.center.lng - pin.lng);

      if (dLat < threshold && dLng < threshold) {
        clust.pins.push(pin);
        clust.center.lat =
          (clust.center.lat * (clust.pins.length - 1) + pin.lat) /
          clust.pins.length;
        clust.center.lng =
          (clust.center.lng * (clust.pins.length - 1) + pin.lng) /
          clust.pins.length;
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({
        id: `cluster-${clusters.length}-${pin.name}`,
        center: {lat: pin.lat, lng: pin.lng},
        pins: [pin],
      });
    }
  }
  return clusters;
}
