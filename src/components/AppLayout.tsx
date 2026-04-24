import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Library, LogOut, Menu } from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
  sidebarActions?: React.ReactNode;
}

export default function AppLayout({ children, sidebarActions }: AppLayoutProps) {
  const { user, logOut } = useAuth();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const location = useLocation();

  const isHome = location.pathname === '/';

  return (
    <div className="bg-background text-on-background font-body-md text-body-md antialiased flex min-h-screen relative w-full overflow-x-hidden">
      
      {/* Mobile Nav Overlay */}
      {isMobileNavOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      {/* SideNavBar Component */}
      <nav className={`fixed left-0 top-0 flex flex-col h-screen w-64 py-8 border-r border-outline-variant/30 bg-surface-container-low shadow-md md:shadow-none z-50 transition-transform duration-300 ease-in-out md:translate-x-0 ${isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-6 mb-8 flex flex-col gap-1">
          <Link to="/" className="text-2xl font-serif font-bold text-primary font-headline-md tracking-tight">Athenaeum</Link>
          <span className="text-on-surface-variant font-body-md text-sm opacity-80 uppercase tracking-widest pl-1 mt-1">Modern Archivist</span>
        </div>
        
        <div className="flex-grow flex flex-col gap-2">
          <Link 
            to="/"
            onClick={() => setIsMobileNavOpen(false)}
            className={`flex items-center gap-3 pl-6 py-3 transition-colors duration-200 font-serif text-lg tracking-tight ${isHome ? 'text-primary font-bold border-l-2 border-primary bg-surface-container' : 'text-on-surface hover:text-primary hover:bg-surface-container'}`}
          >
            <Library className={`w-5 h-5 ${isHome ? 'text-primary' : 'text-on-surface-variant'}`} />
            <span>My Libraries</span>
          </Link>
          
          {sidebarActions && (
             <div className="mt-4 flex flex-col gap-2">
                <div className="px-6 text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-1 mt-2">Actions</div>
                {sidebarActions}
             </div>
          )}
        </div>
        
        <div className="mt-auto">
          <button 
            onClick={logOut}
            className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight"
          >
            <LogOut className="text-on-surface-variant w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </nav>

      {/* Main Content Wrapper */}
      <main className="flex-1 min-w-0 flex flex-col md:ml-64 pt-16 md:pt-0 min-h-screen">
        
        {/* TopNavBar */}
        <header className="flex justify-between items-center h-16 px-8 fixed md:sticky top-0 w-full md:w-auto mx-auto md:mx-0 z-40 bg-background md:bg-surface/80 backdrop-blur-md border-b border-outline-variant/30 shadow-[0_8px_30px_rgb(26,47,75,0.04)] font-body-md text-on-background">
          <div className="flex items-center space-x-6 w-1/3">
            <button 
              className="md:hidden p-2 -ml-2 text-on-surface hover:text-primary rounded-full hover:bg-surface-container transition-colors flex items-center justify-center"
              onClick={() => setIsMobileNavOpen(true)}
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
          <div className="text-2xl font-headline-md italic text-primary w-1/3 text-center md:block">Athenaeum</div>
          <div className="flex items-center justify-end space-x-6 w-1/3 ml-auto text-on-surface-variant">
            <div className="h-8 w-8 rounded-full bg-surface-variant overflow-hidden">
               {user?.photoURL ? (
                 <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
               ) : (
                 <div className="w-full h-full flex items-center justify-center text-primary font-bold">
                   {user?.email?.[0]?.toUpperCase() || 'U'}
                 </div>
               )}
            </div>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
