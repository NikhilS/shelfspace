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
      <header className="bg-surface/80 backdrop-blur-xl px-6 py-3 shadow-sm flex items-center justify-between sticky top-0 z-40 border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-accent to-teal-700 text-white rounded-full flex items-center justify-center shadow-md">
            <LibraryIcon size={16} strokeWidth={2} />
          </div>
          <h1 className="text-xl font-serif font-bold tracking-tight text-ink">ShelfSpace</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-paper px-2.5 py-1 rounded-full border border-border/60 shadow-sm">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-6 h-6 rounded-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-white text-xs font-medium">
                {user?.email?.[0].toUpperCase() || 'U'}
              </div>
            )}
            <span className="text-xs text-ink font-bold hidden sm:inline-block pr-2">{user?.displayName || user?.email}</span>
          </div>
          <button onClick={logOut} className="p-1.5 text-muted hover:text-ink transition-colors rounded-full hover:bg-paper" title="Log out">
            <LogOut size={18} strokeWidth={2} />
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
          <div>
            <h2 className="text-4xl font-serif font-bold tracking-tight mb-1">Your Libraries</h2>
            <p className="text-muted text-base">Manage your collections and reading lists.</p>
          </div>
          <button 
            onClick={() => setIsCreating(true)}
            className="flex items-center justify-center gap-2 bg-accent text-white px-5 py-2.5 rounded-full hover:bg-accent/90 transition-all shadow-sm font-bold text-sm"
          >
            <Plus size={16} strokeWidth={2.5} />
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
              className="bg-surface p-6 sm:p-8 rounded-[32px] shadow-xl shadow-accent/5 mb-8 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center border border-border/60 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-accent/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-yellow-200/40 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3 pointer-events-none" />
              
              <input
                type="text"
                value={newLibName}
                onChange={(e) => setNewLibName(e.target.value)}
                placeholder="Library Name (e.g. Living Room Shelf)"
                className="flex-1 bg-paper border-2 border-border/50 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-4 focus:ring-accent/20 focus:border-accent transition-all text-lg font-medium placeholder:text-muted/60 relative z-10"
                autoFocus
                disabled={isSubmitting}
              />
              <div className="flex gap-3 sm:gap-4 relative z-10">
                <button type="submit" disabled={isSubmitting} className="flex-1 sm:flex-none justify-center bg-accent text-white px-6 py-3.5 rounded-2xl font-bold hover:bg-accent/90 hover:shadow-lg hover:shadow-accent/30 hover:-translate-y-0.5 transition-all flex items-center gap-2 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none">
                  {isSubmitting ? <><Loader2 size={18} className="animate-spin" /> Generating...</> : 'Create'}
                </button>
                <button type="button" onClick={() => setIsCreating(false)} disabled={isSubmitting} className="flex-1 sm:flex-none justify-center text-ink px-5 py-3.5 rounded-2xl font-bold hover:bg-paper border-2 border-border/50 transition-colors disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {libraries.length === 0 && !isCreating ? (
          <div className="text-center py-20 bg-surface rounded-[32px] shadow-sm border border-border/60 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-accent/5 to-transparent pointer-events-none" />
            <div className="w-20 h-20 bg-paper rounded-full flex items-center justify-center mx-auto mb-5 shadow-inner border border-border/50 relative z-10">
              <Book size={32} className="text-accent" strokeWidth={1.5} />
            </div>
            <h3 className="text-2xl font-serif font-bold mb-2 text-ink relative z-10">No libraries yet</h3>
            <p className="text-muted text-base max-w-md mx-auto font-medium relative z-10">Create your first library to start organizing your books and reading lists.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                    <div className="bg-surface rounded-[32px] shadow-sm hover:shadow-2xl hover:shadow-accent/15 transition-all duration-400 border border-border/60 hover:border-accent/40 h-full flex flex-col overflow-hidden relative group-hover:-translate-y-2">
                      {lib.heroImageUrl ? (
                        <div className="h-48 w-full relative overflow-hidden">
                          <img src={lib.heroImageUrl} alt={lib.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                          <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent" />
                          <div className="absolute bottom-6 left-8 right-8 text-white">
                            <h3 className="text-3xl font-serif font-medium mb-1 tracking-tight leading-tight">{toTitleCase(lib.name)}</h3>
                          </div>
                        </div>
                      ) : (
                        <div className="p-8 pb-4 flex-1 flex flex-col justify-end relative overflow-hidden">
                          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-accent to-transparent pointer-events-none" />
                          <div className="w-14 h-14 bg-paper rounded-full flex items-center justify-center mb-6 text-accent group-hover:scale-110 transition-transform duration-500 shadow-md border border-border/50 relative z-10">
                            <Book size={24} strokeWidth={2} />
                          </div>
                          <h3 className="text-3xl font-serif font-medium mb-2 tracking-tight leading-tight text-ink relative z-10 group-hover:text-accent transition-colors">{toTitleCase(lib.name)}</h3>
                        </div>
                      )}
                      <div className={`px-8 py-6 mt-auto border-t border-border/30 ${lib.heroImageUrl ? 'bg-surface' : ''}`}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-accent" />
                          <p className="text-muted text-sm font-bold uppercase tracking-wider">
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
