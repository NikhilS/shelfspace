import React from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  Map,
  Plus,
  Wand2,
  Settings,
  Share2,
  BookOpen,
  Library as LibraryIcon,
  Globe,
  History,
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
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {user} = useAuth();
  const {canEdit, isOwner} = useLibraryPermissions(libraryId, user?.uid);

  if (!libraryId) {
    return null;
  }

  const isLibraryHomeActive = location.pathname === `/library/${libraryId}`;
  const isCollectionsActive =
    location.pathname === `/library/${libraryId}/collection`;

  const isSettingsActive =
    isSettingsOpen ||
    (location.pathname === `/library/${libraryId}` &&
      searchParams.get('settings') === 'true');
  const isShareActive =
    isShareOpen ||
    (location.pathname === `/library/${libraryId}` &&
      searchParams.get('share') === 'true');

  const handleSettings = () => {
    if (onOpenSettings) onOpenSettings();
    else void navigate(`/library/${libraryId}?settings=true`);
  };

  const handleShare = () => {
    if (onOpenShare) onOpenShare();
    else void navigate(`/library/${libraryId}?share=true`);
  };

  return (
    <>
      <HeaderActions>
        {canEdit && (
          <button
            onClick={handleSettings}
            title="Library Settings"
            className={`p-2 rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all ${isSettingsActive ? 'text-primary bg-surface-container' : ''}`}
          >
            <Settings className="w-5 h-5 flex-shrink-0" />
          </button>
        )}

        {isOwner && (
          <button
            onClick={handleShare}
            title="Share Library"
            className={`p-2 rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all ${isShareActive ? 'text-primary bg-surface-container' : ''}`}
          >
            <Share2 className="w-5 h-5 flex-shrink-0" />
          </button>
        )}
      </HeaderActions>

      <SidebarActions>
        <Link
          to={`/library/${libraryId}`}
          className={`sidebar-nav-item ${isLibraryHomeActive ? 'active' : ''}`}
        >
          <LibraryIcon className="w-5 h-5 flex-shrink-0" />
          <span>Library Home</span>
        </Link>

        <Link
          to={`/library/${libraryId}/collection`}
          className={`sidebar-nav-item ${isCollectionsActive ? 'active' : ''}`}
        >
          <BookOpen className="w-5 h-5 flex-shrink-0" />
          <span>Collections</span>
        </Link>

        <Link
          to={`/library/${libraryId}/constellation`}
          className={`sidebar-nav-item ${location.pathname.includes('/constellation') ? 'active' : ''}`}
        >
          <Map className="w-5 h-5 flex-shrink-0" />
          <span>Constellation Map</span>
        </Link>

        <Link
          to={`/library/${libraryId}/map`}
          className={`sidebar-nav-item ${location.pathname.endsWith('/map') ? 'active' : ''}`}
        >
          <Globe className="w-5 h-5 flex-shrink-0" />
          <span>World Map</span>
        </Link>

        <Link
          to={`/library/${libraryId}/timeline`}
          className={`sidebar-nav-item ${location.pathname.includes('/timeline') ? 'active' : ''}`}
        >
          <History className="w-5 h-5 flex-shrink-0" />
          <span>Timeline</span>
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
            <span>Shelf Care</span>
          </Link>
        )}
      </SidebarActions>
    </>
  );
}
