import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from 'sonner';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const LibraryView = lazy(() => import('./pages/LibraryView'));
const BookDetailsView = lazy(() => import('./pages/BookDetailsView'));
const AddBookView = lazy(() => import('./pages/AddBookView'));
const Login = lazy(() => import('./pages/Login'));

function LoadingScreen() {
  return <div className="min-h-screen flex items-center justify-center bg-paper">Loading...</div>;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthReady } = useAuth();
  
  if (!isAuthReady) {
    return <LoadingScreen />;
  }
  
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <Routes location={location} key={location.pathname}>
      <Route path="/login" element={
        <Suspense fallback={<LoadingScreen />}>
          <Login />
        </Suspense>
      } />
      <Route path="/" element={
        <PrivateRoute>
          <Dashboard />
        </PrivateRoute>
      } />
      <Route path="/library/:id" element={
        <PrivateRoute>
          <LibraryView />
        </PrivateRoute>
      } />
      <Route path="/library/:id/add" element={
        <PrivateRoute>
          <AddBookView />
        </PrivateRoute>
      } />
      <Route path="/library/:libraryId/book/:bookId" element={
        <PrivateRoute>
          <BookDetailsView />
        </PrivateRoute>
      } />
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
