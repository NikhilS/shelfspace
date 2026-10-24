import React from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {
  X,
  Share2,
  Settings,
  Download,
  Trash2,
  Shield,
  Copy,
  Check,
  Clock,
  CheckCircle2,
  ArrowUpRight,
} from 'lucide-react';
import {Library} from '../../types';
import {trpc} from '../../lib/trpc';
import {useAppPermissions} from '../../hooks/useAppPermissions';
import {AdminAllowlistDialog} from '../../components/admin/AdminAllowlistDialog';
import {toast} from 'sonner';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  isAdmin?: boolean;
  addShareEmail: (email: string, role: 'editor' | 'viewer') => Promise<void>;
  handleRemoveShare: (email: string) => void;
  handleUpdateRole?: (
    email: string,
    role: 'editor' | 'viewer',
  ) => Promise<void>;
  handleRenameLibrary?: (newName: string) => Promise<void>;
  handleExportToCsv: () => void;
  handleDeleteLibrary: () => void;
  confirmDeleteLibrary: () => void;
}

const shareSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['editor', 'viewer']),
});

type ShareFormValues = z.infer<typeof shareSchema>;

export function LibrarySettingsModals({
  isSettingsOpen,
  setIsSettingsOpen,
  isAdvancedSettingsOpen,
  setIsAdvancedSettingsOpen,
  libraryToDelete,
  setLibraryToDelete,
  library,
  isOwner,
  canEdit,
  isAdmin,
  addShareEmail,
  handleRemoveShare,
  handleUpdateRole,
  handleRenameLibrary,
  handleExportToCsv,
  handleDeleteLibrary,
  confirmDeleteLibrary,
}: LibrarySettingsModalsProps) {
  const {isAdmin: hookIsAdmin} = useAppPermissions();
  const effectiveIsAdmin = isAdmin ?? hookIsAdmin;
  const [isSharing, setIsSharing] = React.useState(false);
  const [copiedLink, setCopiedLink] = React.useState(false);
  const [libraryNameInput, setLibraryNameInput] = React.useState(
    library.name || '',
  );
  const [isSavingName, setIsSavingName] = React.useState(false);
  const [isAllowlistDialogOpen, setIsAllowlistDialogOpen] =
    React.useState(false);
  const [allowlistTargetEmail, setAllowlistTargetEmail] = React.useState<
    string | null
  >(null);

  const handleOpenAllowlistDialog = (email?: string) => {
    setAllowlistTargetEmail(email || null);
    setIsAllowlistDialogOpen(true);
  };

  React.useEffect(() => {
    setLibraryNameInput(library.name || '');
  }, [library.name, isAdvancedSettingsOpen]);

  const collaboratorsQuery = trpc.library?.getCollaborators?.useQuery
    ? trpc.library.getCollaborators.useQuery(
        {libraryId: library.id},
        {
          enabled: Boolean(isSettingsOpen && isOwner && library.id),
          staleTime: 1000 * 30,
        },
      )
    : undefined;

  const statusByEmail = React.useMemo(() => {
    const map: Record<string, 'approved' | 'pending_approval'> = {};
    for (const c of collaboratorsQuery?.data?.collaborators || []) {
      map[c.email.toLowerCase()] = c.allowlistStatus;
    }
    return map;
  }, [collaboratorsQuery?.data]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
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
      void collaboratorsQuery?.refetch?.();
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyLibraryLink = async () => {
    try {
      const shareUrl = `${window.location.origin}/library/${library.id}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      toast.success('Library link copied to clipboard');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const onRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = libraryNameInput.trim();
    if (!trimmed || trimmed === library.name || !handleRenameLibrary) {
      return;
    }
    setIsSavingName(true);
    try {
      await handleRenameLibrary(trimmed);
    } finally {
      setIsSavingName(false);
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
          <div className="flex items-center justify-between mb-6">
            <DialogTitle className="text-2xl font-sans font-bold flex items-center gap-3 text-on-surface">
              <div className="w-10 h-10 bg-surface-container rounded-full flex items-center justify-center text-primary border border-outline-variant/30">
                <Share2 size={20} />
              </div>
              Share Library
            </DialogTitle>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCopyLibraryLink()}
                className="h-9 px-3 rounded-xl text-xs font-medium gap-1.5"
                title="Copy link to this library"
              >
                {copiedLink ? (
                  <Check size={14} className="text-emerald-600" />
                ) : (
                  <Copy size={14} />
                )}
                <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsSettingsOpen(false)}
                className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors h-10 w-10 min-w-[44px] min-h-[44px]"
                aria-label="Close dialog"
              >
                <X size={20} />
              </Button>
            </div>
          </div>

          <p className="text-xs text-on-surface-variant mb-5 leading-relaxed">
            Invite friends or family by email to view or edit this library. New
            readers can join as soon as an admin approves their invite.
          </p>

          <div className="mb-6">
            <form
              onSubmit={handleSubmit(onShareSubmit)}
              className="flex flex-col gap-2 mb-6"
            >
              <div className="flex gap-2">
                <Input
                  type="email"
                  {...register('email')}
                  placeholder="friend@email.com"
                  className="flex-1 bg-surface-container border-outline-variant/50 rounded-xl px-3 py-2 text-sm text-on-surface min-w-0"
                />
                <Select
                  value={watch('role') || 'viewer'}
                  onValueChange={val =>
                    setValue('role', val as 'editor' | 'viewer', {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger className="w-[110px] bg-surface-container border-outline-variant/50 rounded-xl px-3 py-2 text-sm text-on-surface h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                  </SelectContent>
                </Select>
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

            <div className="space-y-3 max-h-56 overflow-y-auto pr-2 custom-scrollbar pb-4">
              <div className="flex items-center justify-between bg-surface-container/50 border border-outline-variant/30 px-4 py-3 rounded-xl text-sm">
                <span className="truncate mr-3 font-medium text-on-surface flex items-center gap-2">
                  <Shield size={16} className="text-primary" />
                  {library.ownerName}
                </span>
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                  Owner
                </span>
              </div>

              {sharedEmails.map(email => {
                const allowlistStatus = statusByEmail[email.toLowerCase()];
                return (
                  <div
                    key={email}
                    className="flex items-center justify-between bg-surface-container border border-outline-variant/50 px-4 py-3 rounded-xl text-sm group hover:border-outline-variant transition-colors gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-on-surface">
                        {email}
                      </div>
                      {allowlistStatus === 'pending_approval' ? (
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          <div className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                            <Clock size={11} />
                            <span>Pending Admin Approval</span>
                          </div>
                          {effectiveIsAdmin && (
                            <button
                              type="button"
                              onClick={() => handleOpenAllowlistDialog(email)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                              title="Open Admin Allowlist to approve this user"
                              aria-label={`Open Admin Allowlist for ${email}`}
                            >
                              <Shield size={11} />
                              <span>Manage Allowlist</span>
                              <ArrowUpRight size={11} />
                            </button>
                          )}
                        </div>
                      ) : allowlistStatus === 'approved' ? (
                        <div className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                          <CheckCircle2 size={11} />
                          <span>Active</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Select
                        value={getRoleForEmail(email)}
                        onValueChange={val => {
                          void handleUpdateRole?.(
                            email,
                            val as 'editor' | 'viewer',
                          );
                        }}
                      >
                        <SelectTrigger className="h-8 w-[100px] border-none bg-transparent text-xs text-on-surface-variant focus:outline-none focus:ring-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="editor">Editor</SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveShare(email)}
                        className="text-on-surface-variant hover:text-error h-8 w-8 p-1.5 rounded-md hover:bg-error-container transition-colors"
                        title="Remove access"
                        aria-label={`Remove access for ${email}`}
                      >
                        <X size={16} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {effectiveIsAdmin && (
        <AdminAllowlistDialog
          isOpen={isAllowlistDialogOpen}
          onClose={() => setIsAllowlistDialogOpen(false)}
          initialEmail={allowlistTargetEmail}
          onAllowlistUpdated={() => {
            void collaboratorsQuery?.refetch?.();
          }}
        />
      )}

      <Dialog
        open={isAdvancedSettingsOpen && canEdit}
        onOpenChange={open => !open && setIsAdvancedSettingsOpen(false)}
      >
        <DialogContent
          showCloseButton={false}
          className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-xl border border-outline-variant/30 gap-0"
        >
          <div className="flex items-center justify-between mb-8">
            <DialogTitle className="text-2xl font-sans font-bold flex items-center gap-3 text-on-surface">
              <div className="w-10 h-10 bg-surface-container rounded-full flex items-center justify-center text-primary border border-outline-variant/30">
                <Settings size={20} />
              </div>
              Library Settings
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsAdvancedSettingsOpen(false)}
              className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors h-10 w-10 min-w-[44px] min-h-[44px]"
              aria-label="Close dialog"
            >
              <X size={20} />
            </Button>
          </div>

          {handleRenameLibrary && (
            <form onSubmit={onRenameSubmit} className="mb-8">
              <h4 className="text-sm font-medium text-on-surface-variant mb-3 uppercase tracking-wider">
                Collection Name
              </h4>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={libraryNameInput}
                  onChange={e => setLibraryNameInput(e.target.value)}
                  maxLength={120}
                  placeholder="Library name"
                  className="flex-1 bg-surface-container border-outline-variant/50 rounded-xl px-3 py-2 text-sm text-on-surface"
                />
                <Button
                  type="submit"
                  disabled={
                    isSavingName ||
                    !libraryNameInput.trim() ||
                    libraryNameInput.trim() === library.name
                  }
                  className="shrink-0"
                >
                  {isSavingName ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          )}

          <div className="mb-10">
            <h4 className="text-sm font-medium text-on-surface-variant mb-4 uppercase tracking-wider">
              Export Data
            </h4>
            <Button
              variant="outline"
              onClick={handleExportToCsv}
              className="w-full flex items-center justify-center gap-2"
            >
              <Download size={18} /> Export to CSV
            </Button>
            <p className="text-xs text-on-surface-variant mt-3 text-center">
              Download your library as a CSV file to import into Google Sheets
              or Excel.
            </p>
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
            <DialogTitle className="text-2xl font-sans font-bold flex items-center gap-3 text-on-surface tracking-tight">
              <div className="w-10 h-10 bg-error-container rounded-full flex items-center justify-center text-error border border-error-container/50">
                <Trash2 size={20} />
              </div>
              Delete Library
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setLibraryToDelete(false)}
              className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors h-10 w-10 min-w-[44px] min-h-[44px]"
              aria-label="Close dialog"
            >
              <X size={20} />
            </Button>
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
}
