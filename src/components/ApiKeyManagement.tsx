import React, {useState} from 'react';
import {trpc} from '../lib/trpc';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  Clock,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {toast} from 'sonner';

export const ApiKeyManagement: React.FC = () => {
  const [newKeyName, setNewKeyName] = useState('');
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<{id: string; name: string} | null>(null);

  const utils = trpc.useUtils();

  const {data: apiKeys, isLoading, refetch} = trpc.apiKey.list.useQuery();

  const createMutation = trpc.apiKey.create.useMutation({
    onSuccess: res => {
      setCreatedRawKey(res.key);
      setNewKeyName('');
      toast.success(`API Key '${res.name}' created successfully`);
      void utils.apiKey.list.invalidate();
    },
    onError: err => {
      toast.error(`Failed to create API Key: ${err.message}`);
    },
  });

  const revokeMutation = trpc.apiKey.revoke.useMutation({
    onSuccess: () => {
      toast.success('API Key revoked');
      setKeyToRevoke(null);
      void utils.apiKey.list.invalidate();
    },
    onError: err => {
      toast.error(`Failed to revoke API Key: ${err.message}`);
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    createMutation.mutate({name: newKeyName.trim()});
  };

  const handleCopyKey = () => {
    if (!createdRawKey) return;
    navigator.clipboard.writeText(createdRawKey);
    setCopied(true);
    toast.success('API Key copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (isoString: string | null) => {
    if (!isoString) return 'Never';
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 architectural-shadow relative overflow-hidden mt-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-outline-variant/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
            <Key size={20} />
          </div>
          <div>
            <h2 className="text-xl font-medium text-on-surface">API Keys & External Access</h2>
            <p className="text-sm text-on-surface-variant">
              Generate secret keys for programmatic REST / tRPC access to library enrichment APIs.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="flex items-center gap-2 text-xs"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* Create Key Form */}
      <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="flex-1">
          <input
            type="text"
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
            placeholder="Key description (e.g. CLI Sync, iOS Companion)"
            className="w-full bg-surface border border-outline-variant/50 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
            required
          />
        </div>
        <Button
          type="submit"
          disabled={createMutation.isPending || !newKeyName.trim()}
          className="flex items-center gap-2 px-6"
        >
          <Plus size={18} />
          {createMutation.isPending ? 'Generating...' : 'Create Secret Key'}
        </Button>
      </form>

      {/* API Key List */}
      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-16 bg-surface-variant/40 rounded-xl" />
          ))}
        </div>
      ) : !apiKeys || apiKeys.length === 0 ? (
        <div className="text-center py-8 text-on-surface-variant bg-surface/50 rounded-xl border border-dashed border-outline-variant/50">
          <Key className="w-8 h-8 mx-auto mb-2 opacity-40 text-primary" />
          <p className="text-sm font-medium">No API keys generated yet.</p>
          <p className="text-xs text-on-surface-variant/80 mt-1">
            Create an API key above to allow external integrations or scripts to query books and trigger enrichment.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {apiKeys.map(k => (
            <div
              key={k.id}
              className={`flex flex-col sm:flex-row sm:items-center justify-between bg-surface border ${
                k.revoked ? 'border-error/20 bg-error/5 opacity-70' : 'border-outline-variant/50 hover:border-outline-variant/80'
              } rounded-xl p-4 gap-4 transition-colors`}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-on-surface">{k.name}</span>
                  {k.revoked ? (
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-error/20 text-error">
                      Revoked
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center gap-1">
                      <ShieldCheck size={10} /> Active
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant font-mono">
                  <span>
                    Prefix: <code className="bg-surface-variant px-1.5 py-0.5 rounded">{k.keyPrefix}...{k.keySuffix}</code>
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> Last used: {formatDate(k.lastUsedAt)}
                  </span>
                  <span>Created: {new Date(k.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              {!k.revoked && (
                <button
                  type="button"
                  onClick={() => setKeyToRevoke({id: k.id, name: k.name})}
                  className="text-on-surface-variant hover:text-error hover:bg-error/10 p-2 rounded-lg transition-colors flex items-center gap-1 text-xs self-end sm:self-auto"
                  title="Revoke API key"
                >
                  <Trash2 size={16} />
                  <span>Revoke</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Secret Key Raw Value Display Modal */}
      <Dialog open={!!createdRawKey} onOpenChange={() => setCreatedRawKey(null)}>
        <DialogContent className="max-w-lg bg-surface-container-lowest border border-outline-variant">
          <DialogTitle className="text-xl font-serif text-primary flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            API Key Created Successfully
          </DialogTitle>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3 text-amber-700 dark:text-amber-300 text-xs">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Copy your secret API key now!</p>
                <p className="mt-0.5 opacity-90">
                  For security reasons, this key will <strong>never be shown again</strong>. Store it safely in your client environment or secret manager.
                </p>
              </div>
            </div>

            <div className="bg-surface border border-outline-variant/60 rounded-xl p-3 flex items-center justify-between gap-2 font-mono text-xs break-all select-all">
              <span className="text-primary font-semibold">{createdRawKey}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyKey}
                className="flex-shrink-0 flex items-center gap-1.5"
              >
                {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={() => setCreatedRawKey(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Modal */}
      <Dialog open={!!keyToRevoke} onOpenChange={() => setKeyToRevoke(null)}>
        <DialogContent className="max-w-md bg-surface-container-lowest border border-outline-variant">
          <DialogTitle className="text-lg font-serif text-error flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Revoke API Key?
          </DialogTitle>
          <p className="text-sm text-on-surface-variant">
            Are you sure you want to revoke key <strong>"{keyToRevoke?.name}"</strong>? Any external application or script using this secret key will immediately lose access. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setKeyToRevoke(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={revokeMutation.isPending}
              onClick={() => keyToRevoke && revokeMutation.mutate({keyId: keyToRevoke.id})}
            >
              {revokeMutation.isPending ? 'Revoking...' : 'Revoke Key'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
