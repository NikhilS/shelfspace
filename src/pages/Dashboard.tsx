import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, or } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Book, Plus, LogOut, Library as LibraryIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { toTitleCase } from '../lib/utils';
import { generateLibraryHeroImage } from '../services/gemini';
import { motion, AnimatePresence } from 'motion/react';

interface Library {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  sharedWith: string[];
  createdAt: any;
  heroImageUrl?: string;
}

export default function Dashboard() {
  const { user, logOut } = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newLibName, setNewLibName] = useState('');

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'libraries'),
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.email)
      )
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const libs: Library[] = [];
      snapshot.forEach((doc) => {
        libs.push({ id: doc.id, ...doc.data() } as Library);
      });
      setLibraries(libs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'libraries');
    });

    return () => unsubscribe();
  }, [user]);

  const handleCreateLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLibName.trim() || !user || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const heroImageUrl = await generateLibraryHeroImage(newLibName.trim());

      await addDoc(collection(db, 'libraries'), {
        name: newLibName.trim(),
        ownerId: user.uid,
        ownerName: user.displayName || user.email || 'Unknown',
        sharedWith: [],
        createdAt: serverTimestamp(),
        heroImageUrl: heroImageUrl || null
      });
      setNewLibName('');
      setIsCreating(false);
      toast.success('Library created successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'libraries');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="min-h-screen bg-paper font-sans text-ink"
    >
      <header className="bg-surface/90 backdrop-blur-xl px-4 sm:px-8 py-4 sm:py-5 flex items-center justify-between sticky top-0 z-40 border-b border-border/40 shadow-sm transition-all">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-accent text-surface rounded-full flex items-center justify-center shadow-md">
            <LibraryIcon size={20} strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-serif font-bold tracking-tight text-ink">ShelfSpace</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-surface px-2.5 py-1.5 rounded-full border border-border/60 shadow-sm cursor-pointer group hover:bg-paper transition-colors">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-7 h-7 rounded-full object-cover group-hover:border-ink/20 border border-transparent transition-colors" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-border flex items-center justify-center text-ink text-xs font-bold group-hover:bg-ink group-hover:text-surface transition-colors">
                {user?.email?.[0].toUpperCase() || 'U'}
              </div>
            )}
            <span className="text-[11px] sm:text-xs text-ink font-bold hidden sm:inline-block pr-2 tracking-wide">{user?.displayName || user?.email}</span>
          </div>
          <button onClick={logOut} className="p-2 text-muted hover:text-ink transition-colors rounded-full hover:bg-surface border border-transparent hover:border-border/50" title="Log out">
            <LogOut size={18} strokeWidth={2} />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-10 sm:mb-12 gap-6">
          <div>
            <h2 className="text-3xl sm:text-5xl font-serif font-bold tracking-tight text-ink mb-2">Your Libraries</h2>
            <p className="text-muted text-lg font-medium">Manage your collections and reading lists.</p>
          </div>
          <button 
            onClick={() => setIsCreating(true)}
            className="flex items-center justify-center gap-2 bg-ink text-surface px-6 py-3 rounded-full hover:bg-ink/90 hover:-translate-y-0.5 hover:shadow-md transition-all font-medium text-sm flex-shrink-0"
          >
            <Plus size={18} strokeWidth={2.5} />
            New Library
          </button>
        </div>

        <AnimatePresence>
          {isCreating && (
            <motion.form 
              initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
              animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              onSubmit={handleCreateLibrary} 
              className="bg-surface/60 backdrop-blur-sm p-6 sm:p-8 rounded-3xl shadow-sm mb-10 sm:mb-12 border border-border/40 relative overflow-hidden"
            >
              <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center relative z-10 w-full">
                <input
                  type="text"
                  value={newLibName}
                  onChange={(e) => setNewLibName(e.target.value)}
                  placeholder="Library Name (e.g. Living Room Shelf)"
                  className="flex-1 bg-paper/50 border border-border/60 rounded-full px-6 py-4 focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition-all text-base sm:text-lg font-medium placeholder:text-muted/60"
                  autoFocus
                  disabled={isSubmitting}
                />
                <div className="flex gap-3 sm:gap-4 flex-shrink-0">
                  <button type="button" onClick={() => setIsCreating(false)} disabled={isSubmitting} className="flex-1 sm:flex-none justify-center text-ink px-6 py-4 rounded-full font-bold hover:bg-surface border border-border/60 transition-colors disabled:opacity-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={isSubmitting} className="flex-1 sm:flex-none justify-center bg-accent text-white px-8 py-4 rounded-full font-bold hover:bg-accent/90 hover:shadow-lg hover:shadow-accent/20 hover:-translate-y-0.5 transition-all flex items-center gap-2 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none min-w-[140px]">
                    {isSubmitting ? <><Loader2 size={18} className="animate-spin" /> Generating</> : 'Create'}
                  </button>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {libraries.length === 0 && !isCreating ? (
          <div className="text-center py-32 bg-surface/40 backdrop-blur-sm rounded-3xl shadow-sm border border-border/40 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-accent/5 to-transparent pointer-events-none" />
            <div className="w-24 h-24 bg-paper/80 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner border border-border/30 relative z-10">
              <Book size={36} className="text-accent/80" strokeWidth={1.5} />
            </div>
            <h3 className="text-3xl font-serif font-bold mb-3 text-ink relative z-10 tracking-tight">No libraries yet</h3>
            <p className="text-muted text-lg max-w-md mx-auto relative z-10">Create your first library to start organizing your books and reading lists.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            <AnimatePresence>
              {libraries.map((lib, index) => (
                <motion.div 
                  key={lib.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: index * 0.05, ease: 'easeOut' }}
                  className="h-full"
                >
                  <Link to={`/library/${lib.id}`} className="block group h-full">
                    <div className="bg-surface/60 backdrop-blur-sm rounded-3xl shadow-sm hover:shadow-xl hover:shadow-border/60 transition-all duration-400 border border-border/40 hover:border-border/80 h-full flex flex-col overflow-hidden relative group-hover:-translate-y-1.5 focus:outline-none focus:ring-2 focus:ring-ink/20">
                      {lib.heroImageUrl ? (
                        <div className="h-56 w-full relative overflow-hidden border-b border-border/20">
                          <img src={lib.heroImageUrl} alt={lib.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                          <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent" />
                          <div className="absolute bottom-6 left-8 right-8 text-white">
                            <h3 className="text-2xl sm:text-3xl font-serif font-medium mb-1 tracking-tight leading-tight line-clamp-2">{toTitleCase(lib.name)}</h3>
                          </div>
                        </div>
                      ) : (
                        <div className="p-8 pb-6 flex-1 flex flex-col justify-end relative overflow-hidden min-h-[14rem]">
                          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-accent to-transparent pointer-events-none" />
                          <div className="w-14 h-14 bg-paper/80 rounded-full flex items-center justify-center mb-6 text-accent group-hover:scale-110 transition-transform duration-500 shadow-sm border border-border/40 relative z-10">
                            <Book size={24} strokeWidth={2} />
                          </div>
                          <h3 className="text-2xl sm:text-3xl font-serif font-medium mb-2 tracking-tight leading-tight text-ink relative z-10 group-hover:text-accent transition-colors line-clamp-2">{toTitleCase(lib.name)}</h3>
                        </div>
                      )}
                      <div className={`px-8 py-5 mt-auto ${lib.heroImageUrl ? 'bg-surface/40' : 'border-t border-border/30 bg-surface/20'}`}>
                        <div className="flex items-center gap-2.5">
                          <div className="w-2 h-2 rounded-full bg-accent/80" />
                          <p className="text-muted text-xs font-bold uppercase tracking-wider">
                            {lib.ownerId === user?.uid ? 'Owned by you' : `Shared by ${toTitleCase(lib.ownerName)}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </motion.div>
  );
}
