export type PreloadableRouteKey =
  | 'library'
  | 'bookDetails'
  | 'addBook'
  | 'constellation'
  | 'worldMap'
  | 'spruceUp'
  | 'timeline'
  | 'admin';

const routeImporters: Record<PreloadableRouteKey, () => Promise<unknown>> = {
  library: () => import('../pages/LibraryView'),
  bookDetails: () => import('../pages/BookDetailsView'),
  addBook: () => import('../pages/AddBookView'),
  constellation: () => import('../pages/ConstellationMap'),
  worldMap: () => import('../pages/WorldMap'),
  spruceUp: () => import('../pages/SpruceUpView'),
  timeline: () => import('../pages/TimelineView'),
  admin: () => import('../pages/AdminDashboard'),
};

const preloadedRoutes = new Set<PreloadableRouteKey>();

export function preloadRouteChunk(key: PreloadableRouteKey): void {
  if (preloadedRoutes.has(key)) {
    return;
  }
  preloadedRoutes.add(key);
  void routeImporters[key]().catch(() => {
    preloadedRoutes.delete(key);
  });
}

export function preloadRouteByPathname(pathname: string): void {
  if (pathname.startsWith('/admin')) {
    preloadRouteChunk('admin');
  } else if (pathname.includes('/book/')) {
    preloadRouteChunk('bookDetails');
  } else if (pathname.endsWith('/add')) {
    preloadRouteChunk('addBook');
  } else if (pathname.endsWith('/constellation')) {
    preloadRouteChunk('constellation');
  } else if (pathname.endsWith('/map')) {
    preloadRouteChunk('worldMap');
  } else if (pathname.endsWith('/spruce-up')) {
    preloadRouteChunk('spruceUp');
  } else if (pathname.endsWith('/timeline')) {
    preloadRouteChunk('timeline');
  } else if (pathname.startsWith('/library/')) {
    preloadRouteChunk('library');
  }
}

export function preloadAllRouteChunks(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }
  const keys: PreloadableRouteKey[] = [
    'library',
    'bookDetails',
    'constellation',
    'worldMap',
    'timeline',
    'spruceUp',
    'addBook',
  ];
  for (const key of keys) {
    preloadRouteChunk(key);
  }
}
