import React, {useState} from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
import {
  User as UserIcon,
  LogOut,
  Shield,
  Sun,
  Moon,
  Monitor,
  Share2,
  Settings,
  Library as LibraryIcon,
  Check,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {useAuth} from '../stores/authStore';
import {useAppStore} from '../stores/appStore';
import {useAppPermissions} from '../hooks/useAppPermissions';
import {toast} from 'sonner';

interface UserProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentLibraryId?: string;
}

export function UserProfileDialog({
  isOpen,
  onClose,
  currentLibraryId,
}: UserProfileDialogProps) {
  const {user, logOut} = useAuth();
  const {isAdmin} = useAppPermissions();
  const {theme, setTheme} = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (currentLibraryId) {
      // If we are in a library, trigger the library share modal via URL query param
      onClose();
      void navigate(`/library/${currentLibraryId}?share=true`);
      return;
    }

    // Otherwise, copy the current URL or share app
    try {
      const shareUrl = window.location.origin;
      if (navigator.share) {
        await navigator.share({
          title: 'book(ish) — Modern Archivist',
          text: 'Explore and curate your personal book archive',
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        toast.success('App link copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      toast.error('Could not share link');
    }
  };

  const handleSettings = () => {
    onClose();
    if (currentLibraryId) {
      void navigate(`/library/${currentLibraryId}?settings=true`);
    } else {
      toast.info('Open a library to manage its settings and exports');
    }
  };

  const handleAdmin = () => {
    onClose();
    void navigate('/admin');
  };

  const handleLibraries = () => {
    onClose();
    void navigate('/');
  };

  const handleLogOut = async () => {
    onClose();
    await logOut();
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-surface border border-outline-variant/30 shadow-elevation-3 rounded-2xl sm:rounded-3xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-outline-variant/20 bg-surface-container-lowest">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-primary font-serif font-bold text-lg overflow-hidden border border-outline-variant/40 shrink-0 shadow-xs">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt="Profile"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                user?.email?.[0]?.toUpperCase() || (
                  <UserIcon className="w-6 h-6" />
                )
              )}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-serif text-lg font-bold text-on-surface truncate leading-tight">
                {user?.displayName || 'Curator'}
              </DialogTitle>
              <DialogDescription className="font-sans text-xs text-on-surface-variant truncate mt-0.5">
                {user?.email || 'Logged in'}
              </DialogDescription>
              <div className="flex items-center gap-2 mt-1.5">
                {isAdmin ? (
                  <Badge
                    variant="default"
                    size="sm"
                    className="inline-flex items-center gap-1 font-label-caps-xs text-label-caps-xs bg-primary/10 text-primary border-primary/20"
                  >
                    <Shield className="w-3 h-3" />
                    Administrator
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    size="sm"
                    className="inline-flex items-center gap-1 font-label-caps-xs text-label-caps-xs bg-secondary/10 text-secondary border-secondary/20"
                  >
                    Curator
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6">
          {/* Appearance / Theme Selector */}
          <div>
            <div className="metadata-eyebrow text-on-surface-variant mb-2.5">
              Appearance
            </div>
            <div className="grid grid-cols-3 gap-2 bg-surface-container-low p-1.5 rounded-xl border border-outline-variant/30">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-sans font-medium transition-all ${
                  theme === 'light'
                    ? 'bg-surface text-primary shadow-xs font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Sun className="w-4 h-4" />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-sans font-medium transition-all ${
                  theme === 'dark'
                    ? 'bg-surface text-primary shadow-xs font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Moon className="w-4 h-4" />
                <span>Dark</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('system')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-sans font-medium transition-all ${
                  theme === 'system'
                    ? 'bg-surface text-primary shadow-xs font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Monitor className="w-4 h-4" />
                <span>System</span>
              </button>
            </div>
          </div>

          {/* Navigation & Contextual Actions */}
          <div>
            <div className="metadata-eyebrow text-on-surface-variant mb-2">
              Actions & Navigation
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={handleLibraries}
                className="w-full flex items-center justify-between p-2.5 rounded-xl text-left hover:bg-surface-container-low text-on-surface transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary">
                    <LibraryIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-sans font-medium">
                      My Libraries
                    </div>
                    <div className="text-xs text-on-surface-variant">
                      View all curated archives
                    </div>
                  </div>
                </div>
              </button>

              {currentLibraryId && (
                <button
                  type="button"
                  onClick={handleSettings}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl text-left hover:bg-surface-container-low text-on-surface transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary">
                      <Settings className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-sans font-medium">
                        Library Settings
                      </div>
                      <div className="text-xs text-on-surface-variant">
                        Export CSV, permissions & tools
                      </div>
                    </div>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={handleShare}
                className="w-full flex items-center justify-between p-2.5 rounded-xl text-left hover:bg-surface-container-low text-on-surface transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-sans font-medium">
                      {currentLibraryId ? 'Share Library' : 'Share book(ish)'}
                    </div>
                    <div className="text-xs text-on-surface-variant">
                      {currentLibraryId
                        ? 'Invite collaborators and assign reader permissions'
                        : 'Share archive application with fellow readers'}
                    </div>
                  </div>
                </div>
                {copied && (
                  <Check className="w-4 h-4 text-secondary shrink-0" />
                )}
              </button>

              {isAdmin && (
                <button
                  type="button"
                  onClick={handleAdmin}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left hover:bg-surface-container-low text-on-surface transition-colors ${
                    location.pathname === '/admin'
                      ? 'bg-surface-container-low'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-sans font-medium">
                        Admin Dashboard
                      </div>
                      <div className="text-xs text-on-surface-variant">
                        Manage user allowlist and telemetry
                      </div>
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* Log Out */}
          <div className="pt-2 border-t border-outline-variant/20">
            <Button
              type="button"
              variant="outline"
              onClick={handleLogOut}
              className="w-full flex items-center justify-center gap-2 min-h-[44px] text-error hover:text-error hover:bg-error/10 border-outline-variant/40 rounded-xl font-sans font-semibold"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
