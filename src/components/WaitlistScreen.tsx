import React, {useState} from 'react';
import {trpc} from '../lib/trpc';
import {Button} from './ui/button';
import {BookLoader} from './BookLoader';
import {
  BookOpen,
  Clock,
  CheckCircle2,
  RefreshCw,
  LogOut,
  User,
  ShieldAlert,
} from 'lucide-react';
import {toast} from 'sonner';

interface WaitlistScreenProps {
  user: {
    email: string;
    displayName?: string | null;
    photoURL?: string | null;
  };
  onRefetchPermissions: () => Promise<unknown> | void;
  onSignOut: () => Promise<void> | void;
}

export function WaitlistScreen({
  user,
  onRefetchPermissions,
  onSignOut,
}: WaitlistScreenProps) {
  const [isChecking, setIsChecking] = useState(false);

  const {
    data: waitlistData,
    isLoading,
    refetch: refetchWaitlist,
  } = trpc.auth.getWaitlistStatus.useQuery(undefined, {
    staleTime: 1000 * 30, // 30 seconds
  });

  const joinMutation = trpc.auth.joinWaitlist.useMutation({
    onSuccess: () => {
      toast.success('You have joined the access waitlist.');
      void refetchWaitlist();
    },
    onError: err => {
      toast.error(err.message || 'Failed to submit waitlist request.');
    },
  });

  const handleCheckStatus = async () => {
    setIsChecking(true);
    try {
      const [statusRes] = await Promise.all([
        refetchWaitlist(),
        onRefetchPermissions(),
      ]);

      if (statusRes.data?.status === 'approved') {
        toast.success(
          'Your invitation has been approved! Welcome to book(ish).',
        );
      } else if (statusRes.data?.status === 'pending') {
        toast.info(
          'Your request is still in the queue. We review applicants continually.',
        );
      } else if (statusRes.data?.status === 'rejected') {
        toast.error('Admissions for this cohort are currently full.');
      } else {
        toast.info('You have not requested access yet.');
      }
    } catch {
      toast.error('Unable to verify status at this moment.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleJoinWaitlist = () => {
    joinMutation.mutate({
      displayName: user.displayName || undefined,
      photoURL: user.photoURL || undefined,
    });
  };

  const status = waitlistData?.status || 'not_requested';
  const entry = waitlistData?.entry;

  const formattedDate = entry?.requestedAt
    ? new Date(entry.requestedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <div
      id="waitlist-page-container"
      className="min-h-screen bg-background text-on-surface antialiased flex flex-col justify-between selection:bg-primary/20 selection:text-primary"
    >
      {/* Top Brand Bar */}
      <header className="w-full border-b border-outline-variant/30 bg-surface/80 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-surface-container border border-outline-variant/40 flex items-center justify-center text-primary">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-brand italic text-2xl font-bold tracking-tight text-primary select-none">
              book(ish)
            </span>
            <span className="hidden sm:inline-block font-sans text-xs font-semibold tracking-wider uppercase text-on-surface-variant/70">
              Modern Archivist
            </span>
          </div>
        </div>

        <Button
          id="waitlist-header-signout"
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSignOut}
          className="text-on-surface-variant hover:text-on-surface text-xs font-medium gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </Button>
      </header>

      {/* Main Content Card */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
        <div
          id="waitlist-card"
          className="w-full max-w-lg bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-6 sm:p-10 shadow-[0_10px_30px_rgba(2,26,53,0.04)] text-center space-y-6"
        >
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-4">
              <BookLoader size="lg" />
              <p className="font-sans text-xs uppercase tracking-widest text-on-surface-variant font-semibold animate-pulse">
                Consulting archive ledger...
              </p>
            </div>
          ) : status === 'approved' ? (
            /* State C: Approved */
            <>
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>

              <div className="space-y-2">
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40">
                  Invitation Approved
                </span>
                <h1 className="font-sans text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                  Welcome to the Archives
                </h1>
                <p className="font-sans text-sm sm:text-base text-on-surface-variant leading-relaxed">
                  Your access to <strong>book(ish)</strong> has been granted.
                  Click below to enter your library.
                </p>
              </div>

              <div className="pt-2 space-y-3">
                <Button
                  id="waitlist-enter-btn"
                  type="button"
                  variant="default"
                  onClick={() => onRefetchPermissions()}
                  className="w-full font-medium h-11"
                >
                  Enter Library Catalog
                </Button>
              </div>
            </>
          ) : status === 'pending' ? (
            /* State B: Pending */
            <>
              <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-center mx-auto">
                <Clock className="w-7 h-7" />
              </div>

              <div className="space-y-2">
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40">
                  In Queue &middot; Pending Cohort Admission
                </span>
                <h1 className="font-sans text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                  You&apos;re on the list.
                </h1>
                <p className="font-sans text-sm sm:text-base text-on-surface-variant leading-relaxed">
                  We are rolling out access in small cohorts to preserve catalog
                  quality and dedicated Gemini AI compute.
                </p>
              </div>

              {/* User applicant metadata card */}
              <div className="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-left flex items-center gap-3.5">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || user.email}
                    className="w-11 h-11 rounded-full object-cover border border-outline-variant/50 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                    {user.displayName ? (
                      user.displayName[0].toUpperCase()
                    ) : (
                      <User className="w-5 h-5" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-sans font-semibold text-sm text-on-surface truncate">
                    {user.displayName || user.email.split('@')[0]}
                  </p>
                  <p className="font-sans text-xs text-on-surface-variant truncate">
                    {user.email}
                  </p>
                  {formattedDate && (
                    <p className="font-sans text-[11px] text-on-surface-variant/80 mt-0.5">
                      Requested on {formattedDate}
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-2 space-y-2.5">
                <Button
                  id="waitlist-check-status-btn"
                  type="button"
                  variant="default"
                  onClick={handleCheckStatus}
                  disabled={isChecking}
                  className="w-full font-medium h-11 gap-2"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isChecking ? 'Verifying access...' : 'Check Access Status'}
                  </span>
                </Button>

                <Button
                  id="waitlist-signout-pending-btn"
                  type="button"
                  variant="outline"
                  onClick={onSignOut}
                  className="w-full font-medium text-on-surface-variant hover:text-on-surface"
                >
                  Sign Out / Use Another Account
                </Button>
              </div>
            </>
          ) : status === 'rejected' ? (
            /* State D: Rejected / Deferred */
            <>
              <div className="w-14 h-14 rounded-full bg-slate-500/10 border border-slate-500/20 text-slate-600 dark:text-slate-400 flex items-center justify-center mx-auto">
                <ShieldAlert className="w-7 h-7" />
              </div>

              <div className="space-y-2">
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-800">
                  Cohort At Capacity
                </span>
                <h1 className="font-sans text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                  Registration is at Capacity
                </h1>
                <p className="font-sans text-sm sm:text-base text-on-surface-variant leading-relaxed">
                  Public admissions are currently paused for this cohort. We
                  have retained your submission and will invite you as future
                  archive capacity expands.
                </p>
              </div>

              <div className="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-3.5 text-xs text-on-surface-variant text-center">
                Signed in as{' '}
                <strong className="text-on-surface">{user.email}</strong>
              </div>

              <div className="pt-2">
                <Button
                  id="waitlist-signout-rejected-btn"
                  type="button"
                  variant="outline"
                  onClick={onSignOut}
                  className="w-full font-medium"
                >
                  Sign Out / Use Another Account
                </Button>
              </div>
            </>
          ) : (
            /* State A: Not on Waitlist */
            <>
              <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto">
                <BookOpen className="w-7 h-7" />
              </div>

              <div className="space-y-2">
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide bg-secondary/10 text-secondary border border-secondary/20">
                  Early Reader Access
                </span>
                <h1 className="font-sans text-2xl sm:text-3xl font-bold tracking-tight text-primary">
                  An intimate archive for physical &amp; digital books.
                </h1>
                <p className="font-sans text-sm sm:text-base text-on-surface-variant leading-relaxed">
                  We are steadily admitting readers and collectors to ensure
                  optimal AI metadata enrichment and community focus.
                </p>
              </div>

              {/* Authenticated Account Box */}
              <div className="bg-surface-container/60 border border-outline-variant/30 rounded-xl p-4 text-left flex items-center gap-3.5">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || user.email}
                    className="w-10 h-10 rounded-full object-cover border border-outline-variant/50 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                    {user.displayName ? (
                      user.displayName[0].toUpperCase()
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-sans font-semibold text-sm text-on-surface truncate">
                    {user.displayName || user.email.split('@')[0]}
                  </p>
                  <p className="font-sans text-xs text-on-surface-variant truncate">
                    {user.email}
                  </p>
                </div>
              </div>

              <div className="pt-2 space-y-2.5">
                <Button
                  id="waitlist-request-access-btn"
                  type="button"
                  variant="default"
                  onClick={handleJoinWaitlist}
                  disabled={joinMutation.isPending}
                  className="w-full font-medium h-11"
                >
                  {joinMutation.isPending
                    ? 'Submitting request...'
                    : 'Request Access'}
                </Button>

                <Button
                  id="waitlist-signout-new-btn"
                  type="button"
                  variant="outline"
                  onClick={onSignOut}
                  className="w-full font-medium text-on-surface-variant hover:text-on-surface"
                >
                  Sign Out / Use Another Account
                </Button>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-outline-variant/20 py-4 px-6 text-center text-xs text-on-surface-variant/70">
        &copy; {new Date().getFullYear()} book(ish). Curated library archive.
      </footer>
    </div>
  );
}
