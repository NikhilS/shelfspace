import React, {useState, useEffect} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {Library, LogOut, Menu} from 'lucide-react';
import {motion, AnimatePresence} from 'motion/react';

interface AppLayoutProps {
  children: React.ReactNode;
  sidebarActions?: React.ReactNode;
}

export default function AppLayout({children, sidebarActions}: AppLayoutProps) {
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
            className="text-3xl font-serif font-bold text-primary font-headline-md tracking-tight"
          >
            Athenaeum
          </Link>
          <span className="text-on-surface-variant font-body-md text-xs opacity-80 uppercase tracking-[0.2em] mt-1 pl-1">
            Modern Archivist
          </span>
        </div>

        <div className="flex-grow flex flex-col gap-2 px-4">
          <Link
            to="/"
            onClick={() => setIsMobileNavOpen(false)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-serif text-lg tracking-tight ${
              isHome
                ? 'text-primary font-bold bg-primary/5 shadow-sm'
                : 'text-on-surface hover:text-primary hover:bg-surface-container'
            }`}
          >
            <Library
              className={`w-5 h-5 ${isHome ? 'text-primary' : 'text-on-surface-variant'}`}
            />
            <span>My Libraries</span>
          </Link>

          {sidebarActions && (
            <div
              className="mt-6 flex flex-col gap-2"
              onClick={() => setIsMobileNavOpen(false)}
            >
              <div className="px-4 text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-2 mt-2">
                Actions
              </div>
              {sidebarActions}
            </div>
          )}
        </div>

        <div className="mt-auto px-4">
          <button
            onClick={logOut}
            className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight"
          >
            <LogOut className="text-on-surface-variant w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </nav>

      {/* Main Content Wrapper */}
      <main className="flex-1 min-w-0 flex flex-col md:ml-72 pt-16 md:pt-0 min-h-screen relative">
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
            <div className="text-xl font-serif font-medium text-primary w-1/3 text-center md:hidden">
              Athenaeum
            </div>
            <div className="text-xl font-serif font-medium text-primary w-1/3 text-center max-md:hidden">
              Athenaeum
            </div>
            <div className="flex items-center justify-end space-x-6 w-1/3 ml-auto text-on-surface-variant">
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

        {children}
      </main>
    </div>
  );
}
