import React from 'react';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {
  ArrowLeft,
  Map,
  Plus,
  Wand2,
  Settings,
  Share2,
  Library as LibraryIcon,
} from 'lucide-react';
import SidebarActions from './SidebarActions';
import {useAuth} from '../contexts/AuthContext';
import {useLibraryPermissions} from '../hooks/useLibraryPermissions';

interface LibrarySidebarNavProps {
  libraryId?: string;
  onOpenSettings?: () => void;
  onOpenShare?: () => void;
}

export function LibrarySidebarNav({
  libraryId,
  onOpenSettings,
  onOpenShare,
}: LibrarySidebarNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const {user} = useAuth();
  const {canEdit, isOwner} = useLibraryPermissions(libraryId, user?.uid);

  if (!libraryId) {
    return (
      <SidebarActions>
        <Link to="/" className="sidebar-nav-item">
          <ArrowLeft className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
          <span>Back to Libraries</span>
        </Link>
      </SidebarActions>
    );
  }

  const isLibraryView = location.pathname === `/library/${libraryId}`;

  const handleSettings = () => {
    if (onOpenSettings) onOpenSettings();
    else navigate(`/library/${libraryId}`); 
  };

  const handleShare = () => {
    if (onOpenShare) onOpenShare();
    else navigate(`/library/${libraryId}`); 
  };

  return (
    <SidebarActions>
      <Link to="/" className="sidebar-nav-item">
        <ArrowLeft className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
        <span>Back to Libraries</span>
      </Link>

      <Link
        to={`/library/${libraryId}`}
        className={`sidebar-nav-item ${isLibraryView ? 'active' : ''}`}
      >
        <LibraryIcon className="w-5 h-5 flex-shrink-0" />
        <span>Library View</span>
      </Link>

      <Link
        to={`/library/${libraryId}/constellation`}
        className={`sidebar-nav-item ${location.pathname.includes('/constellation') ? 'active' : ''}`}
      >
        <Map className="w-5 h-5 flex-shrink-0" />
        <span>Constellation Map</span>
      </Link>

      {canEdit && (
        <Link
          to={`/library/${libraryId}/add`}
          state={{from: location.pathname + location.search}}
          className={`sidebar-nav-item ${location.pathname.includes('/add') ? 'active' : ''}`}
        >
          <Plus className="w-5 h-5 flex-shrink-0" />
          <span>Add Books</span>
        </Link>
      )}

      {canEdit && (
        <Link
          to={`/library/${libraryId}/spruce-up`}
          className={`sidebar-nav-item ${location.pathname.includes('/spruce-up') ? 'active' : ''}`}
        >
          <Wand2 className="w-5 h-5 flex-shrink-0" />
          <span>Spruce Up Library</span>
        </Link>
      )}

      {canEdit && (
        <button onClick={handleSettings} className={`sidebar-nav-item ${onOpenSettings && location.pathname === `/library/${libraryId}` && !!document.querySelector('[data-settings-open="true"]') ? 'active-sub' : ''}`}>
          <Settings className="w-5 h-5 flex-shrink-0" />
          <span>Settings</span>
        </button>
      )}

      {isOwner && (
        <button onClick={handleShare} className={`sidebar-nav-item ${onOpenShare && location.pathname === `/library/${libraryId}` && !!document.querySelector('[data-share-open="true"]') ? 'active-sub' : ''}`}>
          <Share2 className="w-5 h-5 flex-shrink-0" />
          <span>Share</span>
        </button>
      )}
    </SidebarActions>
  );
}
