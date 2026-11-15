import {
  VISUALIZER_DESCRIPTORS,
  type VisualizerId,
} from '../constants/visualizerDescriptors';

export type PreloadableRouteKey =
  'library' | 'bookDetails' | 'addBook' | 'spruceUp' | 'admin' | VisualizerId;

const visualizerImporters = Object.fromEntries(
  VISUALIZER_DESCRIPTORS.map(d => [d.preloadKey, d.loadComponent]),
) as Record<VisualizerId, () => Promise<unknown>>;

const routeImporters: Record<PreloadableRouteKey, () => Promise<unknown>> = {
  library: () => import('../pages/LibraryView'),
  bookDetails: () => import('../pages/BookDetailsView'),
  addBook: () => import('../pages/AddBookView'),
  spruceUp: () => import('../pages/SpruceUpView'),
  admin: () => import('../pages/AdminDashboard'),
  ...visualizerImporters,
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
    return;
  }
  if (pathname.includes('/book/')) {
    preloadRouteChunk('bookDetails');
    return;
  }
  if (pathname.endsWith('/add')) {
    preloadRouteChunk('addBook');
    return;
  }
  if (pathname.endsWith('/spruce-up')) {
    preloadRouteChunk('spruceUp');
    return;
  }
  for (const descriptor of VISUALIZER_DESCRIPTORS) {
    if (pathname.endsWith(descriptor.routeSuffix)) {
      preloadRouteChunk(descriptor.preloadKey);
      return;
    }
  }
  if (pathname.startsWith('/library/')) {
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
    ...VISUALIZER_DESCRIPTORS.map(d => d.preloadKey),
    'spruceUp',
    'addBook',
  ];
  for (const key of keys) {
    preloadRouteChunk(key);
  }
}
