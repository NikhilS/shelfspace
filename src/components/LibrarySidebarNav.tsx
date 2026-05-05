import React from 'react';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {
  Map,
  Plus,
  Wand2,
  Settings,
  Share2,
  Library as LibraryIcon,
} from 'lucide-react';
import SidebarActions from './SidebarActions';
import HeaderActions from './HeaderActions';
import {useAuth} from '../contexts/AuthContext';
import {useLibraryPermissions} from '../hooks/useLibraryPermissions';

interface LibrarySidebarNavProps {
  libraryId?: string;
  onOpenSettings?: () => void;
  onOpenShare?: () => void;
  isSettingsOpen?: boolean;
  isShareOpen?: boolean;
}

export function LibrarySidebarNav({
  libraryId,
  onOpenSettings,
  onOpenShare,
  isSettingsOpen = false,
  isShareOpen = false,
}: LibrarySidebarNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const {user} = useAuth();
  const {canEdit, isOwner} = useLibraryPermissions(libraryId, user?.uid);

  if (!libraryId) {
    return null;
  }

  const isLibraryView = location.pathname === `/library/${libraryId}`;

  const handleSettings = () => {
    if (onOpenSettings) onOpenSettings();
    else void navigate(`/library/${libraryId}`);
  };

  const handleShare = () => {
    if (onOpenShare) onOpenShare();
    else void navigate(`/library/${libraryId}`);
  };

  return (
    <>
      <HeaderActions>
        {canEdit && (
          <button
            onClick={handleSettings}
            title="Library Settings"
            className={`p-2 rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all ${isSettingsOpen ? 'text-primary bg-surface-container' : ''}`}
          >
            <Settings className="w-5 h-5 flex-shrink-0" />
          </button>
        )}

        {isOwner && (
          <button
            onClick={handleShare}
            title="Share Library"
            className={`p-2 rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all ${isShareOpen ? 'text-primary bg-surface-container' : ''}`}
          >
            <Share2 className="w-5 h-5 flex-shrink-0" />
          </button>
        )}
      </HeaderActions>

      <SidebarActions>
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
      </SidebarActions>
    </>
  );
}
