import React, {useState} from 'react';
import {Navigate} from 'react-router-dom';
import {useAuth} from '../stores/authStore';
import {useAppPermissions} from '../hooks/useAppPermissions';
import {trpc} from '../lib/trpc';
import {Shield, X, PlusCircle, AlertTriangle, Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {toast} from 'sonner';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {WaitlistManagement} from '../components/admin/WaitlistManagement';

export default function AdminDashboard() {
  const {user} = useAuth();
  const {isAdmin, isAppAllowed, isLoadingPermissions} = useAppPermissions();
  const [newEmail, setNewEmail] = useState('');
  const [newUserAiPlan, setNewUserAiPlan] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingAiEmail, setTogglingAiEmail] = useState<string | null>(null);

  const utils = trpc.useUtils ? trpc.useUtils() : trpc.useContext();
  const {data, isLoading: loading} = trpc.auth.listAllowlist.useQuery(
    undefined,
    {
      enabled: !!isAdmin,
    },
  );

  const users = data?.users || [];

  const addMutation = trpc.auth.addAllowlistUser.useMutation({
    onSuccess: () => {
      void utils.auth.listAllowlist.invalidate();
    },
  });

  const removeMutation = trpc.auth.removeAllowlistUser.useMutation({
    onSuccess: () => {
      void utils.auth.listAllowlist.invalidate();
    },
  });

  const updateAiPlanMutation = trpc.auth.updateAllowlistAiPlan?.useMutation?.({
    onSuccess: () => {
      void utils.auth.listAllowlist.invalidate();
    },
  });

  if (isLoadingPermissions) {
    return (
      <div className="flex-grow flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAdmin || !isAppAllowed) {
    return <Navigate to="/" replace />;
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;

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
    <div className="flex-1 flex flex-col min-w-0">
      <div className="layout-page-content max-w-4xl mx-auto pt-8 sm:pt-12">
        <BackToLibrary
          customTo="/"
          label="Back to Libraries"
          className="mb-6"
        />
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-surface-container rounded-xl flex items-center justify-center text-primary shadow-sm border border-outline-variant/30">
            <Shield size={32} />
          </div>
          <div>
            <h1 className="layout-header-title mb-1 sm:mb-2">
              Admin Dashboard
            </h1>
            <p className="layout-header-subtitle">
              Manage reader onboarding, invite waitlists, AI Plan quotas, and
              authorized access credentials.
            </p>
          </div>
        </div>

        <div className="space-y-8">
          {/* Waitlist Queue Section */}
          <WaitlistManagement />

          {/* Authorized Users Section */}
          <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 architectural-shadow relative overflow-hidden">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-8 pb-6 border-b border-outline-variant/30">
              <div>
                <h2 className="section-heading">Authorized Users</h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  Standard readers default to public catalog metadata only.
                  Enable the AI Plan to grant Gemini-powered features.
                </p>
              </div>
            </div>

            {/* Add User Form */}
            <form
              onSubmit={handleAddUser}
              className="flex flex-col sm:flex-row gap-3 mb-10"
            >
              <div className="flex-1 relative">
                <Input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="developer@example.com"
                  className="w-full bg-surface border-outline-variant/50 rounded-xl px-4 py-3 text-on-surface h-11"
                  required
                />
              </div>
              <button
                type="button"
                id="new-user-ai-plan-toggle"
                onClick={() => setNewUserAiPlan(prev => !prev)}
                className={`h-11 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-colors ${
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
                className="flex items-center gap-2 px-6 h-11"
              >
                <PlusCircle size={18} />
                {isSubmitting ? 'Granting...' : 'Grant Access'}
              </Button>
            </form>

            {/* User List */}
            {loading ? (
              <div className="animate-pulse space-y-4">
                {[1, 2, 3].map(i => (
                  <div
                    key={i}
                    className="h-16 bg-surface-variant/40 rounded-xl"
                  ></div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {users.length === 0 ? (
                  <div className="text-center py-12 text-on-surface-variant flex flex-col items-center gap-3">
                    <AlertTriangle className="w-10 h-10 text-error opacity-50" />
                    <p>No users found. This shouldn't happen!</p>
                  </div>
                ) : (
                  users.map(u => {
                    const isUserAdmin = u.role === 'admin';
                    const hasAi = Boolean(isUserAdmin || u.hasAiPlan);
                    const isToggling = togglingAiEmail === u.email;

                    return (
                      <div
                        key={u.email}
                        className="flex flex-col sm:flex-row sm:items-center justify-between bg-surface-container border border-outline-variant/50 rounded-xl p-4 gap-4 transition-colors hover:border-outline-variant/80"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="flex flex-col min-w-0">
                            <span className="text-on-surface font-medium truncate">
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
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                          {!isUserAdmin && (
                            <button
                              type="button"
                              id={`toggle-ai-plan-${u.email.replace(/[@.]/g, '-')}`}
                              disabled={isToggling}
                              onClick={() =>
                                handleToggleAiPlan(u.email, !hasAi)
                              }
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
                                hasAi
                                  ? 'bg-surface border-outline-variant/60 text-on-surface-variant hover:text-on-surface'
                                  : 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15'
                              }`}
                              title={
                                hasAi
                                  ? 'Disable Gemini AI Plan for this user'
                                  : 'Enable Gemini AI Plan for this user'
                              }
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
                                onClick={() => handleRemoveUser(u.email)}
                                className="text-on-surface-variant hover:text-error hover:bg-error-container p-2 rounded-lg transition-colors flex items-center justify-center"
                                title="Revoke access"
                              >
                                <X size={20} />
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
        </div>
      </div>
    </div>
  );
}
