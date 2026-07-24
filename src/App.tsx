import React, {Suspense, lazy} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
} from 'react-router-dom';
import {useAuthStore} from './stores/authStore';
import {useAppStore} from './stores/appStore';
import {useAppPermissions} from './hooks/useAppPermissions';
import {DebugConsoleHUD} from './components/DebugConsoleHUD';
import {ErrorBoundary} from './components/ErrorBoundary';
import {Toaster} from 'sonner';
import AppLayout from './components/AppLayout';
import ScrollToTop from './components/ScrollToTop';
import {RequireLibraryPermission} from './components/RequireLibraryPermission';
import {BookLoader} from './components/BookLoader';
import {PageLoading} from './components/PageLoading';
import {useDebug} from './stores/debugStore';

function lazyWithRetry<T extends React.ComponentType>(
  factory: () => Promise<{default: T}>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      console.warn('Dynamic import failed, retrying in 1 second...', error);
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await factory();
      } catch (retryError) {
        console.error(
          'Dynamic import failed after retry, reloading page...',
          retryError,
        );
        window.location.reload();
        return new Promise(() => {});
      }
    }
  });
}

const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const LibraryView = lazyWithRetry(() => import('./pages/LibraryView'));
const BookDetailsView = lazyWithRetry(() => import('./pages/BookDetailsView'));
const AddBookView = lazyWithRetry(() => import('./pages/AddBookView'));
const ConstellationMap = lazyWithRetry(
  () => import('./pages/ConstellationMap'),
);
const WorldMap = lazyWithRetry(() => import('./pages/WorldMap'));
const Login = lazyWithRetry(() => import('./pages/Login'));
const SpruceUpView = lazyWithRetry(() => import('./pages/SpruceUpView'));
const AdminDashboard = lazyWithRetry(() => import('./pages/AdminDashboard'));
const TimelineView = lazyWithRetry(() => import('./pages/TimelineView'));

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <BookLoader size="lg" />
    </div>
  );
}

function PageWrapper({children}: {children?: React.ReactNode}) {
  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out flex-1">
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh]">
              <PageLoading
                title="Loading module..."
                subtitle="Downloading application assets and views."
              />
            </div>
          }
        >
          {children || <Outlet />}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function PrivateRoute({children}: {children?: React.ReactNode}) {
  const {user, isAuthReady} = useAuthStore();

  if (!isAuthReady) {
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
              <RequireLibraryPermission requires="editor">
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

          <Route
            path="/library/:libraryId/book/:bookId"
            element={
              <RequireLibraryPermission requires="viewer">
                <BookDetailsView />
              </RequireLibraryPermission>
            }
          />
        </Route>
      </Routes>
    </>
  );
}

import {httpBatchLink} from '@trpc/client';
import {trpc} from './lib/trpc';
import {auth} from './firebase';

const queryClient = new QueryClient();

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/trpc',
      async headers() {
        const token = await auth.currentUser?.getIdToken();
        return {
          Authorization: token ? `Bearer ${token}` : '',
        };
      },
    }),
  ],
});

// Initialize Auth
useAuthStore.getState()._initialize();

function AuthGuard({children}: {children: React.ReactNode}) {
  const {user, isAuthReady, authError, logOut} = useAuthStore();
  const {isAppAllowed, isLoadingPermissions} = useAppPermissions();

  if (isAuthReady && user && !isLoadingPermissions && !isAppAllowed) {
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
          <h1 className="text-3xl font-serif text-on-surface">Access Denied</h1>
          <p className="text-on-surface-variant leading-relaxed">
            It looks like {user.email} doesn't have access to this application
            yet. Please contact the administrator to be added to the allowlist.
          </p>
          <div className="pt-4">
            <button
              onClick={logOut}
              className="w-full bg-primary text-on-primary py-2 px-4 rounded-md font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
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
          <h1 className="text-3xl font-serif text-on-surface">Access Denied</h1>
          <p className="text-on-surface-variant leading-relaxed">{authError}</p>
          <div className="pt-4">
            <button
              onClick={logOut}
              className="w-full bg-primary text-on-primary py-2 px-4 rounded-md font-medium"
            >
              Go Back
            </button>
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

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  // Listen for system theme changes if mode is 'system'
  React.useEffect(() => {
    if (theme !== 'system') return;

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

function DebugDataClearer() {
  const location = useLocation();
  const {setDebugData} = useDebug();

  React.useEffect(() => {
    // Clear debug data on route change
    setDebugData(null);
  }, [location.pathname, setDebugData]);

  return null;
}

export default function App() {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <ThemeProvider>
            <AuthGuard>
              <BrowserRouter>
                <AnimatedRoutes />
                <DebugDataClearer />
                <DebugConsoleHUD />
              </BrowserRouter>
              <Toaster position="bottom-right" />
            </AuthGuard>
          </ThemeProvider>
        </ErrorBoundary>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
