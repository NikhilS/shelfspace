import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from 'sonner';
import { AnimatePresence } from 'motion/react';
import Dashboard from './pages/Dashboard';
import LibraryView from './pages/LibraryView';
import BookDetailsView from './pages/BookDetailsView';
import AddBookView from './pages/AddBookView';
import Login from './pages/Login';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthReady } = useAuth();
  
  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-paper">Loading...</div>;
  }
  
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  return <>{children}</>;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/login" element={<Login />} />
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
    </AnimatePresence>
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
