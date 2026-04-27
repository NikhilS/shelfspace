import React, {Suspense, lazy} from 'react';
import {BrowserRouter, Routes, Route, Navigate} from 'react-router-dom';
import {AuthProvider, useAuth} from './contexts/AuthContext';
import {ErrorBoundary} from './components/ErrorBoundary';
import {Toaster} from 'sonner';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const LibraryView = lazy(() => import('./pages/LibraryView'));
const BookDetailsView = lazy(() => import('./pages/BookDetailsView'));
const AddBookView = lazy(() => import('./pages/AddBookView'));
const ConstellationMap = lazy(() => import('./pages/ConstellationMap'));
const Login = lazy(() => import('./pages/Login'));
const WishlistRedirect = lazy(() => import('./components/WishlistRedirect'));

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-primary font-serif italic text-xl animate-in fade-in duration-300">
      Loading...
    </div>
  );
}

function PageWrapper({children}: {children: React.ReactNode}) {
  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out">
      {children}
    </div>
  );
}

function PrivateRoute({children}: {children: React.ReactNode}) {
  const {user, isAuthReady} = useAuth();

  if (!isAuthReady) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <PageWrapper>{children}</PageWrapper>
    </Suspense>
  );
}

function AnimatedRoutes() {
  return (
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
        path="/"
        element={
          <PrivateRoute>
            <Dashboard />
          </PrivateRoute>
        }
      />
      <Route
        path="/wishlist"
        element={
          <PrivateRoute>
            <WishlistRedirect />
          </PrivateRoute>
        }
      />
      <Route
        path="/library/:id"
        element={
          <PrivateRoute>
            <LibraryView />
          </PrivateRoute>
        }
      />
      <Route
        path="/library/:id/add"
        element={
          <PrivateRoute>
            <AddBookView />
          </PrivateRoute>
        }
      />
      <Route
        path="/library/:id/constellation"
        element={
          <PrivateRoute>
            <ConstellationMap />
          </PrivateRoute>
        }
      />
      <Route
        path="/library/:libraryId/book/:bookId"
        element={
          <PrivateRoute>
            <BookDetailsView />
          </PrivateRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AnimatedRoutes />
        </BrowserRouter>
        <Toaster position="bottom-right" />
      </AuthProvider>
    </ErrorBoundary>
  );
}
