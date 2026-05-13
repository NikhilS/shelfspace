import React, {Suspense, lazy} from 'react';
import {BrowserRouter, Routes, Route, Navigate, Outlet} from 'react-router-dom';
import {AuthProvider, useAuth} from './contexts/AuthContext';
import {DebugProvider} from './contexts/DebugContext';
import {DebugOverlay} from './components/DebugOverlay';
import {ErrorBoundary} from './components/ErrorBoundary';
import {Toaster} from 'sonner';
import AppLayout from './components/AppLayout';
import ScrollToTop from './components/ScrollToTop';
import {RequireLibraryPermission} from './components/RequireLibraryPermission';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const LibraryView = lazy(() => import('./pages/LibraryView'));
const BookDetailsView = lazy(() => import('./pages/BookDetailsView'));
const AddBookView = lazy(() => import('./pages/AddBookView'));
const ConstellationMap = lazy(() => import('./pages/ConstellationMap'));
const Login = lazy(() => import('./pages/Login'));
const SpruceUpView = lazy(() => import('./pages/SpruceUpView'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-primary font-serif italic text-xl animate-in fade-in duration-300">
      Loading...
    </div>
  );
}

function PageWrapper({children}: {children?: React.ReactNode}) {
  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out flex-1">
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex h-[50vh] items-center justify-center text-on-surface-variant font-serif italic text-lg animate-pulse">
              Loading...
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
  const {user, isAuthReady} = useAuth();

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
            path="/library/:id/spruce-up"
            element={
              <RequireLibraryPermission requires="editor">
                <SpruceUpView />
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

export default function App() {
  return (
    <ErrorBoundary>
      <DebugProvider>
        <AuthProvider>
          <BrowserRouter>
            <AnimatedRoutes />
          </BrowserRouter>
          <Toaster position="bottom-right" />
          <DebugOverlay />
        </AuthProvider>
      </DebugProvider>
    </ErrorBoundary>
  );
}
