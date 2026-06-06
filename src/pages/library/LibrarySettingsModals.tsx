import React from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {X, Share2, Settings, Download, Trash2, Shield} from 'lucide-react';
import {Library} from '../../types';
import {useDebugMode} from '../../hooks/useDebugMode';
import {Bug} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';

interface LibrarySettingsModalsProps {
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isAdvancedSettingsOpen: boolean;
  setIsAdvancedSettingsOpen: (open: boolean) => void;
  libraryToDelete: boolean;
  setLibraryToDelete: (toDelete: boolean) => void;
  library: Library;
  isOwner: boolean;
  canEdit: boolean;
  addShareEmail: (email: string, role: 'editor' | 'viewer') => Promise<void>;
  handleRemoveShare: (email: string) => void;
  handleUpdateRole?: (
    email: string,
    role: 'editor' | 'viewer',
  ) => Promise<void>;
  handleExportToCSV: () => void;
  handleDeleteLibrary: () => void;
  confirmDeleteLibrary: () => void;
}

const shareSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['editor', 'viewer']),
});

type ShareFormValues = z.infer<typeof shareSchema>;

export const LibrarySettingsModals: React.FC<LibrarySettingsModalsProps> = ({
  isSettingsOpen,
  setIsSettingsOpen,
  isAdvancedSettingsOpen,
  setIsAdvancedSettingsOpen,
  libraryToDelete,
  setLibraryToDelete,
  library,
  isOwner,
  canEdit,
  addShareEmail,
  handleRemoveShare,
  handleUpdateRole,
  handleExportToCSV,
  handleDeleteLibrary,
  confirmDeleteLibrary,
}) => {
  const {isDebugMode, toggleDebugMode} = useDebugMode();
  const [isSharing, setIsSharing] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: {errors, isValid},
  } = useForm<ShareFormValues>({
    resolver: zodResolver(shareSchema),
    mode: 'onChange',
    defaultValues: {
      role: 'viewer',
    },
  });

  const onShareSubmit = async (data: ShareFormValues) => {
    setIsSharing(true);
    try {
      await addShareEmail(data.email, data.role);
      reset();
    } finally {
      setIsSharing(false);
    }
  };

  const getRoleForEmail = (email: string) => {
    if (library.access && library.access[email]) {
      return library.access[email];
    }
    return 'viewer';
  };

  const sharedEmails = Object.keys(library.access || {}).filter(
    email => library.access?.[email] !== 'owner',
  );

  return (
    <>
      <Dialog
        open={isSettingsOpen && isOwner}
        onOpenChange={open => !open && setIsSettingsOpen(false)}
      >
        <DialogContent
          showCloseButton={false}
          className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-xl border border-outline-variant/30 gap-0"
        >
          <div className="flex items-center justify-between mb-8">
            <DialogTitle className="text-2xl font-serif font-medium flex items-center gap-3 text-on-surface">
              <div className="w-10 h-10 bg-surface-container rounded-full flex items-center justify-center text-primary border border-outline-variant/30">
                <Share2 size={20} />
              </div>
              Share Access
            </DialogTitle>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          <div className="mb-6">
            <form
              onSubmit={handleSubmit(onShareSubmit)}
              className="flex flex-col gap-2 mb-6"
            >
              <div className="flex gap-2">
                <input
                  type="email"
                  {...register('email')}
                  placeholder="friend@email.com"
                  className="flex-1 bg-surface-container border border-outline-variant/50 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-on-surface min-w-0"
                />
                <select
                  {...register('role')}
                  className="bg-surface-container border border-outline-variant/50 rounded-xl pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-on-surface appearance-none cursor-pointer"
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")",
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '1rem',
                  }}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <Button
                  type="submit"
                  disabled={!isValid || isSharing}
                  className="shrink-0 px-3"
                >
                  {isSharing ? '...' : 'Invite'}
                </Button>
              </div>
              {errors.email && (
                <p className="text-xs text-error">{errors.email.message}</p>
              )}
            </form>

            <h4 className="text-sm font-medium text-on-surface-variant mb-3 uppercase tracking-wider">
              Current Access
            </h4>

            <div className="space-y-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar pb-4">
              <div className="flex items-center justify-between bg-surface-container/50 border border-outline-variant/30 px-4 py-3 rounded-xl text-sm">
                <span className="truncate mr-3 font-medium text-on-surface flex items-center gap-2">
                  <Shield size={16} className="text-primary" />
                  {library.ownerName}
                </span>
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                  Owner
                </span>
              </div>

              {sharedEmails.map(email => (
                <div
                  key={email}
                  className="flex items-center justify-between bg-surface-container border border-outline-variant/50 px-4 py-3 rounded-xl text-sm group hover:border-outline-variant transition-colors"
                >
                  <span className="truncate mr-3 font-medium text-on-surface">
                    {email}
                  </span>

                  <div className="flex items-center gap-2">
                    <select
                      value={getRoleForEmail(email)}
                      onChange={e =>
                        handleUpdateRole?.(
                          email,
                          e.target.value as 'editor' | 'viewer',
                        )
                      }
                      className="bg-transparent border-none text-xs text-on-surface-variant focus:outline-none cursor-pointer pr-5 appearance-none"
                      style={{
                        backgroundImage:
                          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='currentColor'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")",
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right center',
                        backgroundSize: '0.75rem',
                      }}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>

                    <button
                      onClick={() => handleRemoveShare(email)}
                      className="text-on-surface-variant hover:text-error p-1.5 rounded-md hover:bg-error-container transition-colors"
                      title="Remove access"
                      aria-label={`Remove access for ${email}`}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAdvancedSettingsOpen && canEdit}
        onOpenChange={open => !open && setIsAdvancedSettingsOpen(false)}
      >
        <DialogContent
          showCloseButton={false}
          className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-xl border border-outline-variant/30 gap-0"
        >
          <div className="flex items-center justify-between mb-8">
            <DialogTitle className="text-2xl font-serif font-medium flex items-center gap-3 text-on-surface">
              <div className="w-10 h-10 bg-surface-container rounded-full flex items-center justify-center text-primary border border-outline-variant/30">
                <Settings size={20} />
              </div>
              Advanced Settings
            </DialogTitle>
            <button
              onClick={() => setIsAdvancedSettingsOpen(false)}
              className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          <div className="mb-10">
            <h4 className="text-sm font-medium text-on-surface-variant mb-4 uppercase tracking-wider">
              Export Data
            </h4>
            <Button
              variant="outline"
              onClick={handleExportToCSV}
              className="w-full flex items-center justify-center gap-2"
            >
              <Download size={18} /> Export to CSV
            </Button>
            <p className="text-xs text-on-surface-variant mt-3 text-center">
              Download your library as a CSV file to import into Google Sheets
              or Excel.
            </p>
          </div>

          <div className="mb-10">
            <h4 className="text-sm font-medium text-on-surface-variant mb-4 uppercase tracking-wider">
              Developer Tools
            </h4>
            <Button
              variant={isDebugMode ? 'default' : 'outline'}
              onClick={toggleDebugMode}
              className="w-full flex items-center justify-center gap-2"
            >
              <Bug size={18} />{' '}
              {isDebugMode ? 'Disable Debug Mode' : 'Enable Debug Mode'}
            </Button>
          </div>

          {isOwner && (
            <div className="pt-8 border-t border-outline-variant/30">
              <h4 className="text-sm font-medium text-error mb-4 uppercase tracking-wider">
                Danger Zone
              </h4>
              <Button
                variant="destructive"
                onClick={handleDeleteLibrary}
                className="w-full flex items-center justify-center gap-2"
              >
                <Trash2 size={18} /> Delete Library
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={libraryToDelete}
        onOpenChange={open => !open && setLibraryToDelete(false)}
      >
        <DialogContent
          showCloseButton={false}
          className="bg-surface rounded-[32px] p-8 max-w-md w-full shadow-xl border border-outline-variant/30 gap-0"
        >
          <div className="flex items-center justify-between mb-8">
            <DialogTitle className="text-2xl font-serif font-medium flex items-center gap-3 text-on-surface tracking-tight">
              <div className="w-10 h-10 bg-error-container rounded-full flex items-center justify-center text-error border border-error-container/50">
                <Trash2 size={20} />
              </div>
              Delete Library
            </DialogTitle>
            <button
              onClick={() => setLibraryToDelete(false)}
              className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mb-8">
            <p className="text-on-surface-variant text-sm leading-relaxed text-left">
              Are you sure you want to delete this entire library? This action
              cannot be undone and all books will be lost.
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setLibraryToDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteLibrary}>
              Delete Library
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
