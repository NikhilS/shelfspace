import React, {useState} from 'react';
import {Link, useLocation, Outlet} from 'react-router-dom';
import {useAuth} from '../stores/authStore';
import {ConnectivityBanner} from './ConnectivityBanner';
import {UserProfileDialog} from './UserProfileDialog';

interface AppLayoutProps {
  children?: React.ReactNode;
}

export default function AppLayout({children}: AppLayoutProps) {
  const {user} = useAuth();
  const location = useLocation();
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const libraryIdMatch = location.pathname.match(/^\/library\/([^/]+)/);
  const currentLibraryId = libraryIdMatch ? libraryIdMatch[1] : undefined;

  return (
    <div className="bg-background text-on-background font-body-md text-body-md antialiased flex flex-col min-h-screen relative w-full overflow-x-hidden">
      {/* TopNavBar */}
      <header className="sticky top-0 w-full z-30 bg-background/90 backdrop-blur-xl border-b border-outline-variant/20 shadow-xs font-body-md text-on-background transition-all">
        <div className="flex justify-between items-center h-16 px-4 sm:px-6 lg:px-8 w-full max-w-7xl mx-auto">
          {/* Brand / Logo */}
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2.5 group transition-opacity hover:opacity-90"
              aria-label="book(ish) Home"
            >
              <span className="font-headline-lg text-headline-lg text-primary tracking-tight italic font-serif">
                book(ish)
              </span>
              <span className="hidden sm:inline-block text-[11px] font-sans font-medium uppercase tracking-widest text-on-surface-variant opacity-80 pl-2 border-l border-outline-variant/40">
                Modern Archivist
              </span>
            </Link>
          </div>

          {/* Right Header: User Profile Action */}
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => setIsProfileOpen(true)}
              className="group flex items-center gap-2.5 p-1 sm:px-2.5 sm:py-1.5 rounded-full hover:bg-surface-container-low border border-transparent hover:border-outline-variant/30 transition-all cursor-pointer"
              title="Account & Settings"
              aria-label="Open profile and settings"
            >
              <span className="hidden md:inline-block text-xs font-sans font-medium text-on-surface-variant group-hover:text-primary transition-colors max-w-[140px] truncate">
                {user?.displayName ||
                  user?.email?.split('@')[0] ||
                  'My Account'}
              </span>
              <div className="h-9 w-9 border border-outline-variant/40 shadow-xs rounded-full bg-surface-container flex items-center justify-center overflow-hidden group-hover:ring-2 group-hover:ring-primary/40 transition-all shrink-0">
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="text-primary font-serif font-bold text-sm">
                    {user?.email?.[0]?.toUpperCase() || 'U'}
                  </div>
                )}
              </div>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 flex flex-col min-h-screen relative w-full">
        <ConnectivityBanner />
        {children || <Outlet />}
      </main>

      {/* User Profile Dialog */}
      <UserProfileDialog
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        currentLibraryId={currentLibraryId}
      />
    </div>
  );
}
