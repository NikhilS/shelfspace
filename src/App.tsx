import React, {Suspense, lazy} from 'react';
import {QueryClientProvider} from '@tanstack/react-query';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
} from 'react-router-dom';
import {trpc, trpcClient} from './lib/trpc';
import {
  queryClient,
  isQueryCacheRestored,
  subscribeToQueryCacheRestore,
} from './lib/queryClient';
import {initAuthListener} from './services/authListener';
import {useAuthStore} from './stores/authStore';
import {useAppStore} from './stores/appStore';
import {useAppPermissions} from './hooks/useAppPermissions';
import {DebugConsoleHud} from './components/debug/DebugConsoleHud';
import {ErrorBoundary} from './components/layout/ErrorBoundary';
import {Toaster} from 'sonner';
import {AppLayout} from './components/layout/AppLayout';
import {
  ScrollToTop,
  getRouteBoundaryKey,
} from './components/layout/ScrollToTop';
import {RequireLibraryPermission} from './components/layout/RequireLibraryPermission';
import {BookLoader} from './components/book/BookLoader';
import {
  SuspenseFallbackRouter,
  useTrackNavigationWarmth,
} from './components/layout/SuspenseFallbackRouter';
import {useDebug} from './stores/debugStore';
import {createLogger} from './lib/telemetry';
import {Button} from './components/ui/button';
import {WaitlistScreen} from './components/account/WaitlistScreen';

import {Dashboard} from './pages/Dashboard';
import {LibraryView} from './pages/LibraryView';
import {Login} from './pages/Login';

// Initialize Auth
initAuthListener();

function lazyWithRetry<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{default: T}>,
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch {
      await new Promise(resolve => setTimeout(resolve, 400));
      return await factory();
    }
  });
}

const BookDetailsView = lazyWithRetry(() =>
  import('./pages/BookDetailsView').then(m => ({default: m.BookDetailsView})),
);
const AddBookView = lazyWithRetry(() =>
  import('./pages/AddBookView').then(m => ({default: m.AddBookView})),
);
const ConstellationMap = lazyWithRetry(() =>
  import('./pages/ConstellationMap').then(m => ({default: m.ConstellationMap})),
);
const WorldMap = lazyWithRetry(() =>
  import('./pages/WorldMap').then(m => ({default: m.WorldMap})),
);
const SpruceUpView = lazyWithRetry(() =>
  import('./pages/SpruceUpView').then(m => ({default: m.SpruceUpView})),
);
const AdminDashboard = lazyWithRetry(() =>
  import('./pages/AdminDashboard').then(m => ({default: m.AdminDashboard})),
);
const TimelineView = lazyWithRetry(() =>
  import('./pages/TimelineView').then(m => ({default: m.TimelineView})),
);

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <BookLoader size="lg" />
    </div>
  );
}

function NavigationWarmthCommit() {
  useTrackNavigationWarmth();
  return null;
}

function PageWrapper({children}: {children?: React.ReactNode}) {
  const location = useLocation();
  const routeBoundaryKey = getRouteBoundaryKey(location.pathname);

  return (
    <div className="w-full flex-1">
      <ErrorBoundary key={routeBoundaryKey}>
        <Suspense key={routeBoundaryKey} fallback={<SuspenseFallbackRouter />}>
          <NavigationWarmthCommit />
          {children || <Outlet />}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function PrivateRoute({children}: {children?: React.ReactNode}) {
  const {user, isAuthReady} = useAuthStore();
  const [isCacheRestored, setIsCacheRestored] = React.useState(() =>
    isQueryCacheRestored(),
  );

  React.useEffect(() => {
    if (isCacheRestored) {
      return undefined;
    }
    return subscribeToQueryCacheRestore(() => {
      setIsCacheRestored(true);
    });
  }, [isCacheRestored]);

  const isOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;

  if (!isAuthReady || (isOffline && !isCacheRestored)) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return <>{children || <Outlet />}</>;
}

function AnimatedRoutes() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route
          path="/login"
          element={
            <Suspense fallback={<LoadingScreen />}>
              <PageWrapper>
                <Login />
              </PageWrapper>
            </Suspense>
          }
        />

        <Route
          element={
            <PrivateRoute>
              <AppLayout>
                <PageWrapper />
              </AppLayout>
            </PrivateRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/admin" element={<AdminDashboard />} />

          <Route
            path="/library/:id"
            element={
              <RequireLibraryPermission requires="viewer">
                <LibraryView />
              </RequireLibraryPermission>
            }
          />

          <Route
            path="/library/:id/collection"
            element={
              <RequireLibraryPermission requires="viewer">
                <LibraryView />
              </RequireLibraryPermission>
            }
          />

          <Route
            path="/library/:id/add"
            element={
              <RequireLibraryPermission requires="editor">
                <AddBookView />
              </RequireLibraryPermission>
            }
          />

          <Route
            path="/library/:id/constellation"
            element={
              <RequireLibraryPermission requires="viewer">
                <ConstellationMap />
              </RequireLibraryPermission>
            }
          />

          <Route
            path="/library/:id/map"
            element={
              <RequireLibraryPermission requires="viewer">
                <WorldMap />
              </RequireLibraryPermission>
            }
          />

          <Route
            path="/library/:id/spruce-up"
            element={
              <RequireLibraryPermission requires="editor" requireAdmin>
                <SpruceUpView />
              </RequireLibraryPermission>
            }
          />

          <Route
            path="/library/:id/timeline"
            element={
              <RequireLibraryPermission requires="viewer">
                <TimelineView />
              </RequireLibraryPermission>
            }
          />

          <Route path="/reading/add" element={<AddBookView />} />

          <Route path="/reading/constellation" element={<ConstellationMap />} />

          <Route path="/reading/map" element={<WorldMap />} />

          <Route path="/reading/timeline" element={<TimelineView />} />

          <Route
            path="/library/:libraryId/book/:bookId"
            element={
              <RequireLibraryPermission requires="viewer">
                <BookDetailsView />
              </RequireLibraryPermission>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function AuthGuard({children}: {children: React.ReactNode}) {
  const {user, isAuthReady, authError, logOut} = useAuthStore();
  const {isAppAllowed, isLoadingPermissions, refetchPermissions} =
    useAppPermissions();

  if (isAuthReady && user && !isLoadingPermissions && !isAppAllowed) {
    return (
      <WaitlistScreen
        user={{
          email: user.email || '',
          displayName: user.displayName,
          photoURL: user.photoURL,
        }}
        onRefetchPermissions={refetchPermissions}
        onSignOut={logOut}
      />
    );
  }

  if (isAuthReady && authError) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center text-on-surface">
        <div className="max-w-md w-full bg-surface-variant/30 border border-outline-variant/30 rounded-2xl p-8 space-y-6">
          <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-8 h-8"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-3xl font-sans font-bold text-on-surface">
            Access Denied
          </h1>
          <p className="text-on-surface-variant leading-relaxed">{authError}</p>
          <div className="pt-4">
            <Button
              type="button"
              variant="default"
              onClick={logOut}
              className="w-full"
            >
              Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function ThemeProvider({children}: {children: React.ReactNode}) {
  const {theme} = useAppStore();

  React.useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'dark' || theme === 'light') {
      root.classList.add(theme);
      return;
    }

    const isDark =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
    const systemTheme = isDark ? 'dark' : 'light';
    root.classList.add(systemTheme);
  }, [theme]);

  // Listen for system theme changes if mode is 'system'
  React.useEffect(() => {
    if (
      theme !== 'system' ||
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(mediaQuery.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return <>{children}</>;
}

const routerLogger = createLogger('Router');

function DebugDataClearer() {
  const location = useLocation();
  const {setDebugData} = useDebug();
  const prevRouteKeyRef = React.useRef<string>(
    getRouteBoundaryKey(location.pathname),
  );

  React.useEffect(() => {
    const nextRouteKey = getRouteBoundaryKey(location.pathname);
    if (prevRouteKeyRef.current !== nextRouteKey) {
      setDebugData(null);
      prevRouteKeyRef.current = nextRouteKey;
    }
    routerLogger.info(`Navigated to ${location.pathname}${location.search}`, {
      pathname: location.pathname,
      search: location.search,
    });
  }, [location.pathname, location.search, setDebugData]);

  return null;
}

function TelemetryHud() {
  const isDebugMode = useDebug(state => state.isDebugMode);
  if (!isDebugMode) {
    return null;
  }
  return <DebugConsoleHud />;
}

export function App() {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <ThemeProvider>
            <AuthGuard>
              <BrowserRouter>
                <AnimatedRoutes />
                <DebugDataClearer />
                <TelemetryHud />
              </BrowserRouter>
            </AuthGuard>
            <Toaster position="bottom-right" />
          </ThemeProvider>
        </ErrorBoundary>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
