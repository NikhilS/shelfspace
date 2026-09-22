import React, {useState, useMemo} from 'react';
import {trpc} from '../../lib/trpc';
import {Button} from '../ui/button';
import {Input} from '../ui/input';
import {
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  User,
  RefreshCw,
  Copy,
  Check,
  UserCheck,
  Inbox,
  Sparkles,
} from 'lucide-react';
import {toast} from 'sonner';
import {WaitlistEntry, WaitlistStatus} from '../../schemas/waitlist';

function getRelativeTimeString(dateInput?: string | null): string {
  if (!dateInput) return 'Unknown';
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Unknown';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  } catch {
    return 'Unknown';
  }
}

function formatExactDate(dateInput?: string | null): string {
  if (!dateInput) return 'Unknown';
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Unknown';
  }
}

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected';

export function WaitlistManagement() {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [processingEmail, setProcessingEmail] = useState<string | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  const utils = trpc.useUtils ? trpc.useUtils() : trpc.useContext();

  const {data, isLoading, isFetching, refetch} =
    trpc.auth.listWaitlist.useQuery({status: filter}, {staleTime: 1000 * 15});

  const entries = data?.entries || [];

  const reviewMutation = trpc.auth.reviewWaitlistEntry.useMutation({
    onSuccess: (result, variables) => {
      void utils.auth.listWaitlist.invalidate();
      void utils.auth.listAllowlist.invalidate();
      if (variables.action === 'approve') {
        toast.success(`Access granted for ${variables.email}`);
      } else {
        toast.info(
          `Waitlist status updated to rejected for ${variables.email}`,
        );
      }
    },
    onError: (err, variables) => {
      toast.error(
        err.message || `Failed to review waitlist entry for ${variables.email}`,
      );
    },
  });

  // Calculate high-level stats from the fetched or cached dataset
  // We also query 'all' counts if current filter is narrowed
  const {data: allData} = trpc.auth.listWaitlist.useQuery(
    {status: 'all'},
    {
      staleTime: 1000 * 30,
      enabled: filter !== 'all',
    },
  );

  const allEntries = filter === 'all' ? entries : allData?.entries || [];

  const stats = useMemo(() => {
    let pendingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;

    for (const e of allEntries) {
      if (e.status === 'pending') pendingCount++;
      else if (e.status === 'approved') approvedCount++;
      else if (e.status === 'rejected') rejectedCount++;
    }

    return {
      total: allEntries.length,
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
    };
  }, [allEntries]);

  // Client-side search filtering
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const query = searchQuery.toLowerCase().trim();
    return entries.filter(e => {
      const emailMatch = e.email.toLowerCase().includes(query);
      const nameMatch = e.displayName?.toLowerCase().includes(query);
      return emailMatch || nameMatch;
    });
  }, [entries, searchQuery]);

  const handleReview = async (email: string, action: 'approve' | 'reject') => {
    setProcessingEmail(email);
    try {
      await reviewMutation.mutateAsync({email, action});
    } finally {
      setProcessingEmail(null);
    }
  };

  const handleApproveAllPending = async () => {
    const pendingToApprove = allEntries.filter(e => e.status === 'pending');
    if (pendingToApprove.length === 0) {
      toast.info('No pending applicants in queue.');
      return;
    }

    setIsBatchProcessing(true);
    let successCount = 0;
    try {
      for (const entry of pendingToApprove) {
        try {
          await reviewMutation.mutateAsync({
            email: entry.email,
            action: 'approve',
          });
          successCount++;
        } catch (e) {
          console.error(`Failed approving ${entry.email}:`, e);
        }
      }
      toast.success(
        `Cohort onboarding complete: Approved ${successCount} applicant${
          successCount === 1 ? '' : 's'
        }.`,
      );
      void utils.auth.listWaitlist.invalidate();
      void utils.auth.listAllowlist.invalidate();
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleCopyEmail = (email: string) => {
    void navigator.clipboard.writeText(email);
    setCopiedEmail(email);
    toast.success(`Copied ${email} to clipboard`);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  return (
    <section
      id="waitlist-management-section"
      className="bg-surface-container-lowest rounded-2xl p-6 sm:p-8 border border-outline-variant/30 architectural-shadow space-y-6"
    >
      {/* Header with Title and Global Cohort Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-outline-variant/30">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <h2 className="section-heading">Invite &amp; Waitlist Queue</h2>
          </div>
          <p className="text-sm text-on-surface-variant mt-1">
            Review onboarding requests from prospective readers before admitting
            them to the archive.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            id="waitlist-refresh-btn"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-9 px-3 gap-1.5 text-xs text-on-surface-variant hover:text-on-surface"
            title="Refresh queue"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            id="waitlist-batch-approve-btn"
            type="button"
            variant="default"
            size="sm"
            onClick={handleApproveAllPending}
            disabled={isBatchProcessing || stats.pending === 0}
            className="h-9 px-3.5 gap-1.5 text-xs font-semibold"
          >
            <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
            <span>
              {isBatchProcessing
                ? 'Onboarding...'
                : `Approve All Pending (${stats.pending})`}
            </span>
          </Button>
        </div>
      </div>

      {/* Queue Stat Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          id="waitlist-stat-all"
          type="button"
          onClick={() => setFilter('all')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            filter === 'all'
              ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/20'
              : 'bg-surface-container/50 border-outline-variant/30 hover:border-outline-variant/60'
          }`}
        >
          <div className="text-xs font-medium text-on-surface-variant">
            Total In Queue
          </div>
          <div className="text-xl font-bold font-sans text-on-surface mt-0.5">
            {stats.total}
          </div>
        </button>

        <button
          id="waitlist-stat-pending"
          type="button"
          onClick={() => setFilter('pending')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            filter === 'pending'
              ? 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/20'
              : 'bg-surface-container/50 border-outline-variant/30 hover:border-outline-variant/60'
          }`}
        >
          <div className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Pending Review
          </div>
          <div className="text-xl font-bold font-sans text-amber-900 dark:text-amber-200 mt-0.5">
            {stats.pending}
          </div>
        </button>

        <button
          id="waitlist-stat-approved"
          type="button"
          onClick={() => setFilter('approved')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            filter === 'approved'
              ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/20'
              : 'bg-surface-container/50 border-outline-variant/30 hover:border-outline-variant/60'
          }`}
        >
          <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
            Approved
          </div>
          <div className="text-xl font-bold font-sans text-emerald-900 dark:text-emerald-200 mt-0.5">
            {stats.approved}
          </div>
        </button>

        <button
          id="waitlist-stat-rejected"
          type="button"
          onClick={() => setFilter('rejected')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            filter === 'rejected'
              ? 'bg-slate-500/10 border-slate-500/40 ring-1 ring-slate-500/20'
              : 'bg-surface-container/50 border-outline-variant/30 hover:border-outline-variant/60'
          }`}
        >
          <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Rejected
          </div>
          <div className="text-xl font-bold font-sans text-slate-800 dark:text-slate-200 mt-0.5">
            {stats.rejected}
          </div>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-surface-container rounded-xl border border-outline-variant/40 w-fit">
          {(
            [
              {id: 'all', label: 'All'},
              {id: 'pending', label: `Pending (${stats.pending})`},
              {id: 'approved', label: 'Approved'},
              {id: 'rejected', label: 'Rejected'},
            ] as const
          ).map(tab => (
            <button
              key={tab.id}
              id={`waitlist-tab-${tab.id}`}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-surface text-on-surface shadow-xs border border-outline-variant/40'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Field */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
          <Input
            id="waitlist-search-input"
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter by name or email..."
            className="pl-9 pr-3 h-9 text-xs bg-surface border-outline-variant/50 rounded-xl"
          />
        </div>
      </div>

      {/* Waitlist Queue List */}
      {isLoading ? (
        <div className="animate-pulse space-y-3 pt-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-surface-variant/40 rounded-xl" />
          ))}
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-xl border border-dashed border-outline-variant/40 bg-surface-container/30 flex flex-col items-center justify-center gap-2">
          <Inbox className="w-8 h-8 text-on-surface-variant/50" />
          <p className="font-sans text-sm font-medium text-on-surface">
            No applicants found
          </p>
          <p className="font-sans text-xs text-on-surface-variant max-w-sm">
            {searchQuery
              ? `No waitlist applicants match "${searchQuery}".`
              : filter === 'pending'
                ? 'There are no pending requests awaiting review.'
                : 'No waitlist submissions under this view.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {filteredEntries.map(entry => (
            <WaitlistRow
              key={entry.email}
              entry={entry}
              isProcessing={processingEmail === entry.email}
              isCopied={copiedEmail === entry.email}
              onApprove={() => handleReview(entry.email, 'approve')}
              onReject={() => handleReview(entry.email, 'reject')}
              onCopy={() => handleCopyEmail(entry.email)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface WaitlistRowProps {
  entry: WaitlistEntry;
  isProcessing: boolean;
  isCopied: boolean;
  onApprove: () => void;
  onReject: () => void;
  onCopy: () => void;
}

function WaitlistRow({
  entry,
  isProcessing,
  isCopied,
  onApprove,
  onReject,
  onCopy,
}: WaitlistRowProps) {
  const relativeTime = getRelativeTimeString(entry.requestedAt);
  const exactTime = formatExactDate(entry.requestedAt);

  return (
    <div
      id={`waitlist-row-${entry.email.replace(/[@.]/g, '-')}`}
      className="flex flex-col sm:flex-row sm:items-center justify-between bg-surface-container/70 border border-outline-variant/40 rounded-xl p-4 gap-4 transition-colors hover:border-outline-variant/80"
    >
      {/* Left: Avatar & Applicant Details */}
      <div className="flex items-start sm:items-center gap-3.5 min-w-0">
        {entry.photoURL ? (
          <img
            src={entry.photoURL}
            alt={entry.displayName || entry.email}
            className="w-10 h-10 rounded-full object-cover border border-outline-variant/60 shrink-0 mt-0.5 sm:mt-0"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-bold text-sm shrink-0 mt-0.5 sm:mt-0">
            {entry.displayName ? (
              entry.displayName[0].toUpperCase()
            ) : (
              <User className="w-4 h-4" />
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-on-surface truncate">
              {entry.displayName || 'Reader'}
            </span>
            <StatusBadge status={entry.status} />
          </div>

          <div className="flex items-center gap-2 text-xs text-on-surface-variant truncate mt-0.5">
            <span className="truncate">{entry.email}</span>
            <button
              type="button"
              onClick={onCopy}
              className="text-on-surface-variant/70 hover:text-on-surface transition-colors p-0.5 rounded"
              title="Copy email address"
            >
              {isCopied ? (
                <Check className="w-3 h-3 text-emerald-600" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>

          {/* Timestamp and reviewer details */}
          <div className="flex items-center gap-2 text-[11px] text-on-surface-variant/80 mt-1 flex-wrap">
            <span title={exactTime} className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-on-surface-variant/60" />
              Requested {relativeTime}
            </span>
            {entry.reviewedBy && (
              <span>
                &middot; Reviewed by{' '}
                <span className="font-medium text-on-surface-variant">
                  {entry.reviewedBy}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
        {entry.status === 'pending' && (
          <>
            <Button
              id={`waitlist-approve-${entry.email}`}
              type="button"
              variant="default"
              size="sm"
              onClick={onApprove}
              disabled={isProcessing}
              className="h-8 px-3 text-xs font-medium gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{isProcessing ? 'Saving...' : 'Approve'}</span>
            </Button>

            <Button
              id={`waitlist-reject-${entry.email}`}
              type="button"
              variant="outline"
              size="sm"
              onClick={onReject}
              disabled={isProcessing}
              className="h-8 px-3 text-xs text-on-surface-variant hover:text-error hover:bg-error/10 gap-1.5 border-outline-variant/50"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Reject</span>
            </Button>
          </>
        )}

        {entry.status === 'rejected' && (
          <Button
            id={`waitlist-admit-${entry.email}`}
            type="button"
            variant="outline"
            size="sm"
            onClick={onApprove}
            disabled={isProcessing}
            className="h-8 px-3 text-xs font-medium gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950/40"
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Admit to Catalog</span>
          </Button>
        )}

        {entry.status === 'approved' && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Allowlist Active</span>
          </span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({status}: {status: WaitlistStatus}) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-600/30">
          <Clock className="w-3 h-3" />
          Pending
        </span>
      );
    case 'approved':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-600/30">
          <CheckCircle2 className="w-3 h-3" />
          Approved
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-600/30">
          <XCircle className="w-3 h-3" />
          Rejected
        </span>
      );
  }
}
