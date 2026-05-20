import React, {useState, useEffect} from 'react';
import {Link, useLocation, Outlet} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {Library, LogOut, Menu, Shield} from 'lucide-react';
import {motion, AnimatePresence} from 'motion/react';
import {ConnectivityBanner} from './ConnectivityBanner';

interface AppLayoutProps {
  children?: React.ReactNode;
}

export default function AppLayout({children}: AppLayoutProps) {
  const {user, logOut} = useAuth();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const location = useLocation();

  const isHome = location.pathname === '/';

  // Close mobile nav when location changes
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location]);

  return (
    <div className="bg-background text-on-background font-body-md text-body-md antialiased flex min-h-screen relative w-full overflow-x-hidden">
      {/* Mobile Nav Overlay */}
      <AnimatePresence>
        {isMobileNavOpen && (
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: 0.2}}
            className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-sm"
            onClick={() => setIsMobileNavOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* SideNavBar Component */}
      <nav
        className={`fixed left-0 top-0 flex flex-col h-screen w-72 py-8 border-r border-outline-variant/30 bg-surface-container-low shadow-xl md:shadow-none z-50 transition-transform duration-300 ease-in-out md:translate-x-0 ${isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-8 mb-10 flex flex-col gap-1">
          <Link
            to="/"
            className="font-headline-lg text-headline-lg text-primary tracking-tight"
          >
            Athenaeum
          </Link>
          <span className="text-on-surface-variant font-label-caps text-label-caps opacity-80 uppercase tracking-widest mt-1 pl-1">
            Modern Archivist
          </span>
        </div>

        <div className="flex-grow flex flex-col gap-2 px-4">
          <Link
            to="/"
            onClick={() => setIsMobileNavOpen(false)}
            className={`sidebar-nav-item ${isHome ? 'active' : ''}`}
          >
            <Library
              className={`w-5 h-5 flex-shrink-0 ${isHome ? 'text-primary' : 'text-on-surface-variant'}`}
            />
            <span>My Libraries</span>
          </Link>

          {useAuth().isAdmin && (
            <Link
              to="/admin"
              onClick={() => setIsMobileNavOpen(false)}
              className={`sidebar-nav-item ${location.pathname === '/admin' ? 'active' : ''}`}
            >
              <div
                className={`w-5 h-5 flex-shrink-0 flex items-center justify-center ${location.pathname === '/admin' ? 'text-primary' : 'text-on-surface-variant'}`}
              >
                <Shield className="w-5 h-5" />
              </div>
              <span>Admin</span>
            </Link>
          )}

          <div
            id="sidebar-actions-root"
            className="contents"
            onClick={() => setIsMobileNavOpen(false)}
          />
        </div>

        <div className="mt-auto px-4">
          <button onClick={logOut} className="sidebar-nav-item">
            <LogOut className="text-on-surface-variant flex-shrink-0 w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </nav>

      {/* Main Content Wrapper */}
      <main className="flex-1 min-w-0 flex flex-col md:ml-72 pt-16 md:pt-0 min-h-screen relative">
        <ConnectivityBanner />
        {/* TopNavBar */}
        <header className="flex flex-col fixed md:sticky top-0 w-full md:w-auto mx-auto md:mx-0 z-30 bg-background/80 backdrop-blur-xl border-b border-outline-variant/20 shadow-sm font-body-md text-on-background transition-all">
          <div className="flex justify-between items-center h-16 px-4 md:px-8 w-full">
            <div className="flex items-center space-x-6 w-1/3">
              <button
                className="md:hidden p-2 -ml-2 text-on-surface hover:text-primary rounded-full hover:bg-surface-container transition-colors flex items-center justify-center"
                onClick={() => setIsMobileNavOpen(true)}
              >
                <Menu className="w-6 h-6" />
              </button>
            </div>
            <div className="text-xl font-serif font-semibold text-primary w-1/3 text-center tracking-tight md:hidden">
              Athenaeum
            </div>
            <div className="flex items-center justify-end space-x-4 w-1/3 ml-auto text-on-surface-variant">
              <div
                id="header-actions-root"
                className="flex items-center space-x-2"
              />
              <div className="h-9 w-9 border border-outline-variant/30 shadow-sm rounded-full bg-surface-variant overflow-hidden cursor-pointer hover:border-primary/50 transition-colors">
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-primary font-bold text-sm">
                    {user?.email?.[0]?.toUpperCase() || 'U'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {children || <Outlet />}
      </main>
    </div>
  );
}
