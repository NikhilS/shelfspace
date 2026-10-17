import React, {useState} from 'react';
import {Link, useLocation, Outlet} from 'react-router-dom';
import {useAuth} from '../../stores/authStore';
import {ConnectivityBanner} from './ConnectivityBanner';
import {UserProfileDialog} from '../account/UserProfileDialog';
import {Button} from '@/components/ui/button';

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
      {/* TopNavBar — Warm Archival Studio 3-Zone Contract */}
      <header className="sticky top-0 w-full z-30 bg-background/92 backdrop-blur-xl border-b border-outline-variant/60 font-body-md text-on-background transition-all">
        <div className="flex justify-between items-center h-16 px-4 sm:px-6 lg:px-8 w-full max-w-[1280px] mx-auto gap-8">
          {/* Zone 1: Brand / Logo */}
          <div className="flex items-center shrink-0">
            <Link
              to="/"
              className="flex items-center gap-3 group transition-opacity hover:opacity-85 whitespace-nowrap shrink-0"
              aria-label="book(ish) Home"
            >
              <span className="font-brand italic text-2xl sm:text-[28px] font-bold tracking-tight text-primary leading-none select-none inline-flex items-center">
                book(ish)
              </span>
              <span
                className="hidden sm:inline-block h-4 w-px bg-outline-variant/70 shrink-0 self-center"
                aria-hidden="true"
              />
              <span className="hidden sm:inline-flex items-center font-sans font-semibold text-[11px] tracking-widest uppercase text-on-surface-variant select-none leading-none">
                Modern Archivist
              </span>
            </Link>
          </div>

          {/* Zone 2: User Profile Action */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsProfileOpen(true)}
              className="group flex items-center gap-2.5 p-1 sm:px-2.5 sm:py-1.5 h-auto rounded-lg hover:bg-surface-container border border-transparent hover:border-outline-variant/60 transition-all min-h-[44px] min-w-[44px]"
              title="Account & Settings"
              aria-label="Open profile and settings"
            >
              <span className="hidden md:inline-block text-xs font-sans font-medium text-on-surface-variant group-hover:text-primary transition-colors max-w-[140px] truncate leading-normal self-center">
                {user?.displayName ||
                  user?.email?.split('@')[0] ||
                  'My Account'}
              </span>
              <div className="h-8 w-8 border border-outline-variant/70 shadow-2xs rounded-full bg-surface-container flex items-center justify-center overflow-hidden group-hover:border-primary/40 transition-all shrink-0">
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-full h-full object-cover rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="text-primary font-serif font-bold text-sm leading-none flex items-center justify-center">
                    {user?.email?.[0]?.toUpperCase() || 'U'}
                  </div>
                )}
              </div>
            </Button>
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
