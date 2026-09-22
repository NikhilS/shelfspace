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
  Bug,
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
import {useDebugMode} from '../hooks/useDebugMode';
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
  const {isDebugMode, toggleDebugMode} = useDebugMode();
  const hasDebugAccess = isAdmin || isDebugMode;
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
      <DialogContent
        className="w-full sm:max-w-md p-0 overflow-hidden bg-surface border border-outline-variant/30 shadow-elevation-3 rounded-t-3xl sm:rounded-3xl max-sm:p-0 max-sm:gap-0 max-sm:max-h-[90dvh] flex flex-col"
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <DialogHeader className="px-4 sm:px-6 pt-3 sm:pt-6 pb-3.5 sm:pb-4 border-b border-outline-variant/20 bg-surface-container-lowest shrink-0 pr-12 sm:pr-12">
          <div className="flex items-center gap-3 sm:gap-3.5">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-surface-container flex items-center justify-center text-primary font-sans font-bold text-base sm:text-lg overflow-hidden border border-outline-variant/40 shrink-0 shadow-xs">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt="Profile"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                user?.email?.[0]?.toUpperCase() || (
                  <UserIcon className="w-5 h-5 sm:w-6 sm:h-6" />
                )
              )}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-sans text-base sm:text-lg font-bold text-on-surface truncate leading-tight">
                {user?.displayName || 'Curator'}
              </DialogTitle>
              <DialogDescription className="font-sans text-xs text-on-surface-variant truncate mt-0.5">
                {user?.email || 'Logged in'}
              </DialogDescription>
              <div className="flex items-center gap-2 mt-1">
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
                    variant="outline"
                    size="sm"
                    className="inline-flex items-center gap-1 font-label-caps-xs text-label-caps-xs bg-surface-container text-on-surface-variant border-outline-variant/40"
                  >
                    Curator
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-5 sm:space-y-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
          {/* Top-Level Option: Debug Console HUD */}
          {hasDebugAccess && (
            <div>
              <div className="metadata-eyebrow text-on-surface-variant mb-2">
                Developer Options
              </div>
              <div
                id="toggle-debug-console-card"
                className={`w-full flex flex-col xs:flex-row xs:items-center justify-between gap-3 p-3 rounded-xl border transition-all text-left ${
                  isDebugMode
                    ? 'bg-surface-container border-outline shadow-xs'
                    : 'bg-surface-container-low border-outline-variant/30 hover:border-outline-variant/60'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      isDebugMode
                        ? 'bg-primary text-on-primary shadow-xs'
                        : 'bg-surface-container text-primary'
                    }`}
                  >
                    <Bug className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-sans font-medium text-on-surface flex items-center gap-2 flex-wrap">
                      <span>Debug Console HUD</span>
                      {isDebugMode && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-primary/15 text-primary border border-primary/20">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-on-surface-variant truncate">
                      Real-time telemetry, query traces & diagnostics HUD
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  id="toggle-debug-console-btn"
                  variant={isDebugMode ? 'default' : 'outline'}
                  onClick={() => {
                    toggleDebugMode();
                    toast.success(
                      isDebugMode
                        ? 'Debug Console disabled'
                        : 'Debug Console HUD enabled',
                    );
                  }}
                  className="h-8 px-3 text-xs font-sans font-medium shrink-0 self-end xs:self-auto min-w-[76px]"
                >
                  {isDebugMode ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
          )}

          {/* Appearance / Theme Selector */}
          <div>
            <div className="metadata-eyebrow text-on-surface-variant mb-2">
              Appearance
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 bg-surface-container-low p-1.5 rounded-xl border border-outline-variant/30">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-1.5 sm:gap-2 py-2 px-2 sm:px-3 rounded-lg text-xs font-sans font-medium transition-all ${
                  theme === 'light'
                    ? 'bg-surface text-primary shadow-xs font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="truncate">Light</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-1.5 sm:gap-2 py-2 px-2 sm:px-3 rounded-lg text-xs font-sans font-medium transition-all ${
                  theme === 'dark'
                    ? 'bg-surface text-primary shadow-xs font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="truncate">Dark</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('system')}
                className={`flex items-center justify-center gap-1.5 sm:gap-2 py-2 px-2 sm:px-3 rounded-lg text-xs font-sans font-medium transition-all ${
                  theme === 'system'
                    ? 'bg-surface text-primary shadow-xs font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <Monitor className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="truncate">System</span>
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
                className="w-full flex items-center justify-between p-2.5 sm:p-3 rounded-xl text-left hover:bg-surface-container-low active:bg-surface-container text-on-surface transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                    <LibraryIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-sans font-medium text-on-surface">
                      My Libraries
                    </div>
                    <div className="text-xs text-on-surface-variant truncate">
                      View all curated archives
                    </div>
                  </div>
                </div>
              </button>

              {currentLibraryId && (
                <button
                  type="button"
                  onClick={handleSettings}
                  className="w-full flex items-center justify-between p-2.5 sm:p-3 rounded-xl text-left hover:bg-surface-container-low active:bg-surface-container text-on-surface transition-colors min-h-[44px]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                      <Settings className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-sans font-medium text-on-surface">
                        Library Settings
                      </div>
                      <div className="text-xs text-on-surface-variant truncate">
                        Export CSV, permissions & tools
                      </div>
                    </div>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={handleShare}
                className="w-full flex items-center justify-between p-2.5 sm:p-3 rounded-xl text-left hover:bg-surface-container-low active:bg-surface-container text-on-surface transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant shrink-0">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-sans font-medium text-on-surface">
                      {currentLibraryId ? 'Share Library' : 'Share book(ish)'}
                    </div>
                    <div className="text-xs text-on-surface-variant truncate">
                      {currentLibraryId
                        ? 'Invite collaborators and assign reader permissions'
                        : 'Share archive application with fellow readers'}
                    </div>
                  </div>
                </div>
                {copied && (
                  <Check className="w-4 h-4 text-primary shrink-0 ml-2" />
                )}
              </button>

              {isAdmin && (
                <button
                  type="button"
                  onClick={handleAdmin}
                  className={`w-full flex items-center justify-between p-2.5 sm:p-3 rounded-xl text-left hover:bg-surface-container-low active:bg-surface-container text-on-surface transition-colors min-h-[44px] ${
                    location.pathname === '/admin'
                      ? 'bg-surface-container-low'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-sans font-medium text-on-surface">
                        Admin Dashboard
                      </div>
                      <div className="text-xs text-on-surface-variant truncate">
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
              className="w-full flex items-center justify-center gap-2 min-h-[44px] text-error hover:text-error hover:bg-error/10 active:bg-error/15 border-outline-variant/40 rounded-xl font-sans font-semibold text-sm transition-colors"
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
