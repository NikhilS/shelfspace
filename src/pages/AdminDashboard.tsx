import React, {useState, useEffect} from 'react';
import {Navigate} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import {Shield, X, PlusCircle, AlertTriangle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {toast} from 'sonner';

interface AllowlistUser {
  email: string;
  role: string | null;
}

export default function AdminDashboard() {
  const {user, isAdmin, isAppAllowed} = useAuth();
  const [users, setUsers] = useState<AllowlistUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;

    const fetchUsers = async () => {
      try {
        const snap = await getDocs(
          collection(db, 'appSettings/allowlist/users'),
        );
        const userList: AllowlistUser[] = [];
        snap.forEach(docSnap => {
          userList.push({
            email: docSnap.id,
            role: docSnap.data().role || 'user',
          });
        });
        setUsers(userList);
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.LIST,
          'appSettings/allowlist/users',
        );
      } finally {
        setLoading(false);
      }
    };

    void fetchUsers();
  }, [isAdmin]);

  if (!isAdmin || !isAppAllowed) {
    return <Navigate to="/" replace />;
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;

    setIsSubmitting(true);
    const email = newEmail.trim().toLowerCase();

    try {
      await setDoc(doc(db, 'appSettings/allowlist/users', email), {
        email: email,
        addedAt: serverTimestamp(),
      });

      setUsers([...users, {email, role: 'user'}]);
      setNewEmail('');
      toast.success(`Access granted for ${email}`);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `appSettings/allowlist/users/${email}`,
      );
      toast.error('Failed to add user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveUser = async (email: string) => {
    if (email === user?.email?.toLowerCase()) {
      toast.error('You cannot remove yourself from the allowlist');
      return;
    }

    try {
      await deleteDoc(doc(db, 'appSettings/allowlist/users', email));
      setUsers(users.filter(u => u.email !== email));
      toast.success('Access revoked');
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.DELETE,
        `appSettings/allowlist/users/${email}`,
      );
      toast.error('Failed to remove user');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="layout-page-content max-w-4xl mx-auto pt-16">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-surface-container rounded-full flex items-center justify-center text-primary shadow-sm border border-outline-variant/30">
            <Shield size={32} />
          </div>
          <div>
            <h1 className="text-4xl font-serif text-primary">
              Admin Dashboard
            </h1>
            <p className="text-on-surface-variant mt-2 text-lg">
              Manage the global allowlist. Only users listed below can sign in.
            </p>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 architectural-shadow relative overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between mb-8 pb-6 border-b border-outline-variant/30">
            <h2 className="text-xl font-medium text-on-surface">
              Authorized Users
            </h2>
          </div>

          {/* Add User Form */}
          <form onSubmit={handleAddUser} className="flex gap-4 mb-10">
            <div className="flex-1 relative">
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="developer@example.com"
                className="w-full bg-surface border border-outline-variant/50 rounded-xl px-4 py-3 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                required
              />
            </div>
            <Button
              type="submit"
              disabled={isSubmitting || !newEmail.trim()}
              className="flex items-center gap-2 px-6"
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
                users.map(u => (
                  <div
                    key={u.email}
                    className="flex flex-col sm:flex-row sm:items-center justify-between bg-surface-container border border-outline-variant/50 rounded-xl p-4 gap-4 transition-colors hover:border-outline-variant/80"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col">
                        <span className="text-on-surface font-medium">
                          {u.email}
                        </span>
                        {u.role === 'admin' && (
                          <span className="text-xs text-primary font-medium bg-primary/10 w-fit px-2 py-0.5 rounded-full mt-1">
                            System Administrator
                          </span>
                        )}
                      </div>
                    </div>

                    {u.email !== user?.email?.toLowerCase() &&
                      u.role !== 'admin' && (
                        <button
                          onClick={() => handleRemoveUser(u.email)}
                          className="text-on-surface-variant hover:text-error hover:bg-error-container p-2 rounded-lg transition-colors flex items-center justify-center self-end sm:self-auto"
                          title="Revoke access"
                        >
                          <X size={20} />
                        </button>
                      )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
