import React, {useState, useEffect} from 'react';
import {Link} from 'react-router-dom';
import {
  Shield,
  X,
  PlusCircle,
  AlertTriangle,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {toast} from 'sonner';
import {useAuth} from '../../stores/authStore';
import {useAppPermissions} from '../../hooks/useAppPermissions';
import {trpc} from '../../lib/trpc';
import {WaitlistManagement} from './WaitlistManagement';

export interface AdminAllowlistDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string | null;
  onAllowlistUpdated?: () => void;
}

export function AdminAllowlistDialog({
  isOpen,
  onClose,
  initialEmail,
  onAllowlistUpdated,
}: AdminAllowlistDialogProps) {
  const {user} = useAuth();
  const {isAdmin} = useAppPermissions();
  const [newEmail, setNewEmail] = useState(initialEmail || '');
  const [newUserAiPlan, setNewUserAiPlan] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingAiEmail, setTogglingAiEmail] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialEmail) {
      setNewEmail(initialEmail);
    }
  }, [isOpen, initialEmail]);

  const utils = trpc.useUtils ? trpc.useUtils() : trpc.useContext();
  const {data, isLoading: loading} = trpc.auth.listAllowlist.useQuery(
    undefined,
    {
      enabled: Boolean(isOpen && isAdmin),
    },
  );

  const users = data?.users || [];

  const notifyAllowlistChanged = () => {
    void utils.auth.listAllowlist.invalidate();
    void utils.auth.listWaitlist?.invalidate?.();
    void utils.library?.getCollaborators?.invalidate?.();
    onAllowlistUpdated?.();
  };

  const addMutation = trpc.auth.addAllowlistUser.useMutation({
    onSuccess: () => {
      notifyAllowlistChanged();
    },
  });

  const removeMutation = trpc.auth.removeAllowlistUser.useMutation({
    onSuccess: () => {
      notifyAllowlistChanged();
    },
  });

  const updateAiPlanMutation = trpc.auth.updateAllowlistAiPlan?.useMutation?.({
    onSuccess: () => {
      notifyAllowlistChanged();
    },
  });

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) {
      return;
    }

    setIsSubmitting(true);
    const email = newEmail.trim().toLowerCase();

    try {
      await addMutation.mutateAsync({
        email,
        role: 'user',
        hasAiPlan: newUserAiPlan,
      });
      setNewEmail('');
      setNewUserAiPlan(false);
      toast.success(
        `Access granted for ${email}${newUserAiPlan ? ' (with AI Plan)' : ''}`,
      );
    } catch (error) {
      console.error('Failed to add user:', error);
      toast.error('Failed to add user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleAiPlan = async (email: string, nextAiPlan: boolean) => {
    setTogglingAiEmail(email);
    try {
      await updateAiPlanMutation.mutateAsync({
        email,
        hasAiPlan: nextAiPlan,
      });
      toast.success(
        nextAiPlan
          ? `Enabled AI Plan for ${email}`
          : `Disabled AI Plan for ${email}`,
      );
    } catch (error) {
      console.error('Failed to update AI Plan:', error);
      toast.error('Failed to update AI Plan');
    } finally {
      setTogglingAiEmail(null);
    }
  };

  const handleRemoveUser = async (email: string) => {
    if (email === user?.email?.toLowerCase()) {
      toast.error('You cannot remove yourself from the allowlist');
      return;
    }

    try {
      await removeMutation.mutateAsync({email});
      toast.success('Access revoked');
    } catch (error) {
      console.error('Failed to remove user:', error);
      toast.error('Failed to remove user');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-full sm:max-w-3xl max-h-[88dvh] bg-surface p-0 rounded-[28px] shadow-xl border border-outline-variant/30 gap-0 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 sm:px-8 py-5 border-b border-outline-variant/30 bg-surface-container-lowest shrink-0">
          <DialogTitle className="text-xl sm:text-2xl font-sans font-bold flex items-center gap-3 text-on-surface">
            <div className="w-10 h-10 bg-surface-container rounded-xl flex items-center justify-center text-primary border border-outline-variant/30 shrink-0">
              <Shield size={20} />
            </div>
            <div>
              <div>Admin Allowlist</div>
              <p className="text-xs font-normal text-on-surface-variant mt-0.5">
                Approve pending collaborators and manage global reader access.
              </p>
            </div>
          </DialogTitle>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/admin"
              onClick={onClose}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-outline-variant/50 bg-surface hover:bg-surface-container text-xs font-sans font-semibold text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span>Full Admin Dashboard</span>
              <ArrowUpRight size={14} />
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="p-2 text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors h-9 w-9"
              aria-label="Close allowlist dialog"
            >
              <X size={18} />
            </Button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 custom-scrollbar">
          {/* Authorized Users / Quick Grant Access */}
          <div className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 space-y-5">
            <div>
              <h3 className="section-heading text-base">Authorized Users</h3>
              <p className="text-xs text-on-surface-variant mt-1">
                Grant global access directly by email. Standard readers default
                to public catalog metadata only; enable the AI Plan to grant
                Gemini-powered features.
              </p>
            </div>

            <form
              onSubmit={handleAddUser}
              className="flex flex-col sm:flex-row gap-2.5"
            >
              <div className="flex-1 relative">
                <Input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="reader@example.com"
                  aria-label="Allowlist email address"
                  className="w-full bg-surface border-outline-variant/50 rounded-lg px-3.5 py-2 text-on-surface h-10 text-sm"
                  required
                />
              </div>
              <button
                type="button"
                onClick={() => setNewUserAiPlan(prev => !prev)}
                className={`h-10 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                  newUserAiPlan
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'bg-surface border-outline-variant/50 text-on-surface-variant hover:text-on-surface'
                }`}
                title="Grant Gemini AI Plan upon onboarding"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Plan: {newUserAiPlan ? 'ON' : 'OFF'}</span>
              </button>
              <Button
                type="submit"
                disabled={isSubmitting || !newEmail.trim()}
                className="flex items-center gap-1.5 px-4 h-10 rounded-lg text-xs font-semibold"
              >
                <PlusCircle size={16} />
                <span>{isSubmitting ? 'Granting...' : 'Grant Access'}</span>
              </Button>
            </form>

            {loading ? (
              <div className="animate-pulse space-y-2.5">
                {[1, 2].map(i => (
                  <div
                    key={i}
                    className="h-14 bg-surface-variant/40 rounded-xl"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                {users.length === 0 ? (
                  <div className="text-center py-8 text-on-surface-variant flex flex-col items-center gap-2 text-xs">
                    <AlertTriangle className="w-6 h-6 text-error opacity-50" />
                    <p>No authorized users found.</p>
                  </div>
                ) : (
                  users.map(u => {
                    const isUserAdmin = u.role === 'admin';
                    const hasAi = Boolean(isUserAdmin || u.hasAiPlan);
                    const isToggling = togglingAiEmail === u.email;

                    return (
                      <div
                        key={u.email}
                        className="flex flex-col sm:flex-row sm:items-center justify-between bg-surface-container border border-outline-variant/50 rounded-xl px-4 py-3 gap-3 transition-colors hover:border-outline-variant/80"
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm text-on-surface font-medium truncate">
                            {u.email}
                          </span>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {isUserAdmin && (
                              <Badge
                                variant="default"
                                size="sm"
                                className="bg-primary/10 text-primary border-primary/20 w-fit font-label-caps-sm text-label-caps-sm"
                              >
                                System Administrator
                              </Badge>
                            )}
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                                hasAi
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                                  : 'bg-surface-variant/60 text-on-surface-variant border-outline-variant/40'
                              }`}
                            >
                              <Sparkles className="w-3 h-3" />
                              {hasAi
                                ? 'AI Plan Enabled'
                                : 'Catalog Only (AI Off)'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                          {!isUserAdmin && (
                            <button
                              type="button"
                              disabled={isToggling}
                              onClick={() =>
                                void handleToggleAiPlan(u.email, !hasAi)
                              }
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                                hasAi
                                  ? 'bg-surface border-outline-variant/60 text-on-surface-variant hover:text-on-surface'
                                  : 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15'
                              }`}
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>
                                {isToggling
                                  ? 'Saving...'
                                  : hasAi
                                    ? 'Revoke AI Plan'
                                    : 'Enable AI Plan'}
                              </span>
                            </button>
                          )}

                          {u.email !== user?.email?.toLowerCase() &&
                            !isUserAdmin && (
                              <button
                                type="button"
                                onClick={() => void handleRemoveUser(u.email)}
                                className="text-on-surface-variant hover:text-error hover:bg-error-container p-1.5 rounded-lg transition-colors flex items-center justify-center cursor-pointer"
                                title="Revoke access"
                                aria-label={`Revoke access for ${u.email}`}
                              >
                                <X size={16} />
                              </button>
                            )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Waitlist Queue Section */}
          <WaitlistManagement onEntryReviewed={onAllowlistUpdated} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
