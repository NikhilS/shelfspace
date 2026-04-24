import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, or, getCountFromServer } from 'firebase/firestore';
import { Link, Navigate } from 'react-router-dom';
import { Book, Plus, Loader2, Library as LibraryIcon } from 'lucide-react';
import { toast } from 'sonner';
import { toTitleCase } from '../lib/utils';
import { generateLibraryHeroImage } from '../services/gemini';
import { motion, AnimatePresence } from 'motion/react';
import { Timestamp } from 'firebase/firestore';
import AppLayout from '../components/AppLayout';

type FirestoreDate = Timestamp | Date | string | number;

interface Library {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  sharedWith: string[];
  createdAt: FirestoreDate;
  heroImageUrl?: string;
  volumeCount?: number; // Added to match mock, would normally be computed
}

export default function Dashboard() {
  const { user, logOut } = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newLibName, setNewLibName] = useState('');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'libraries'),
      or(
        where('ownerId', '==', user.uid),
        where('sharedWith', 'array-contains', user.email)
      )
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const libs: Library[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        libs.push({ 
          id: doc.id, 
          ...data 
        } as Library);
      });

      // Optimistically update libraries, retaining previous volumeCounts to prevent flickering
      setLibraries(prevLibs => {
        return libs.map(lib => {
          const prevLib = prevLibs.find(p => p.id === lib.id);
          return {
            ...lib,
            volumeCount: prevLib !== undefined && prevLib.volumeCount !== undefined ? prevLib.volumeCount : 0
          };
        });
      });
      setIsLoading(false);

      // Fetch accurate counts asynchronously
      try {
        const updatedCounts = await Promise.all(libs.map(async (lib) => {
          const coll = collection(db, 'libraries', lib.id, 'books');
          const countSnap = await getCountFromServer(coll);
          return { id: lib.id, count: countSnap.data().count };
        }));
        
        setLibraries(currentLibs => {
          return currentLibs.map(lib => {
            const update = updatedCounts.find(u => u.id === lib.id);
            return update ? { ...lib, volumeCount: update.count } : lib;
          });
        });
      } catch (err) {
        console.error("Failed to fetch volume counts", err);
      }
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

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <AppLayout
      sidebarActions={
        <button 
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight"
        >
          <Plus className="text-primary w-5 h-5" />
          <span>Create Library</span>
        </button>
      }
    >
      <div className="flex-grow flex flex-col min-h-screen w-full">
        {/* Main Canvas */}
        <main className="flex-grow p-4 sm:p-8 lg:p-12 max-w-[1200px] mx-auto w-full">
          <div className="mb-8 flex flex-col gap-4">
            <div>
              <h2 className="font-headline-xl text-headline-xl text-primary-container mb-4">My Libraries</h2>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">Your curated collections, meticulously organized for deep focus and easy retrieval.</p>
            </div>
          </div>

          <AnimatePresence>
            {isCreating && (
              <motion.form 
                initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                onSubmit={handleCreateLibrary} 
                className="bg-surface-container p-6 sm:p-8 rounded-lg shadow-sm border border-outline-variant/30 mb-12 relative overflow-hidden"
              >
                <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center relative z-10 w-full">
                  <input
                    type="text"
                    value={newLibName}
                    onChange={(e) => setNewLibName(e.target.value)}
                    placeholder="Library Name (e.g. Private Study)"
                    className="flex-1 bg-surface border border-outline-variant/70 rounded-md px-6 py-4 focus:outline-none focus:ring-0 focus:border-primary transition-all text-base sm:text-lg placeholder:text-on-surface-variant/70"
                    autoFocus
                    disabled={isSubmitting}
                  />
                  <div className="flex gap-3 sm:gap-4 flex-shrink-0">
                    <button type="button" onClick={() => setIsCreating(false)} disabled={isSubmitting} className="flex-1 sm:flex-none justify-center text-primary px-6 py-4 rounded-md font-body-md hover:bg-surface-variant border border-outline-variant/50 transition-colors disabled:opacity-50">
                      Cancel
                    </button>
                    <button type="submit" disabled={isSubmitting} className="flex-1 sm:flex-none justify-center bg-primary text-on-primary px-8 py-4 rounded-md font-body-md hover:bg-primary/90 transition-all flex items-center gap-2 disabled:opacity-50 min-w-[140px] architectural-shadow">
                      {isSubmitting ? <><Loader2 size={18} className="animate-spin" /> Abstracting</> : 'Create Collection'}
                    </button>
                  </div>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-surface-container-low rounded-lg overflow-hidden border border-transparent shadow-[0_8px_30px_rgba(26,47,75,0.02)] flex flex-col h-full animate-pulse">
                  <div className="h-44 w-full bg-surface-variant/50"></div>
                  <div className="p-6 flex flex-col flex-grow justify-between bg-surface-container-lowest">
                    <div className="h-6 bg-surface-variant/50 rounded w-2/3 mb-4"></div>
                    <div className="flex items-center justify-between mt-6">
                      <div className="h-4 bg-surface-variant/50 rounded w-1/4"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : libraries.length === 0 && !isCreating ? (
            <div className="text-center py-24 px-6 bg-surface-container-low rounded-lg border border-outline-variant/30 architectural-shadow">
              <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-outline-variant/50">
                <LibraryIcon className="w-10 h-10 text-on-surface-variant" />
              </div>
              <h3 className="text-2xl font-serif font-bold mb-3 text-primary tracking-tight">The Archives are Empty</h3>
              <p className="text-on-surface-variant text-lg max-w-md mx-auto mb-8">Establish your first collection to begin cataloging your physical volumes.</p>
              <button 
                onClick={() => setIsCreating(true)}
                className="bg-primary text-on-primary px-6 py-3 rounded-md font-body-md hover:bg-primary/90 transition-all architectural-shadow flex items-center gap-2 mx-auto"
              >
                <Plus className="w-4 h-4" />
                Create Library
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <AnimatePresence>
                {libraries.map((lib, index) => (
                  <motion.div 
                    key={lib.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.05, ease: 'easeOut' }}
                    className="h-full"
                  >
                    <Link to={`/library/${lib.id}`} className="block h-full group">
                      <div className="bg-surface-container-low rounded-lg overflow-hidden border border-transparent shadow-[0_8px_30px_rgba(26,47,75,0.02)] hover:shadow-[0_12px_40px_rgba(26,47,75,0.08)] hover:border-outline-variant/30 transition-all duration-300 flex flex-col h-full cursor-pointer">
                        <div className="h-44 w-full overflow-hidden bg-surface-variant relative">
                          {lib.heroImageUrl ? (
                            <img alt={lib.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" src={lib.heroImageUrl} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-surface-container">
                              <Book className="w-12 h-12 text-on-surface-variant opacity-70 group-hover:scale-110 transition-transform duration-500" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-primary/10 to-transparent mix-blend-multiply opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                        </div>
                        
                        <div className="p-6 flex flex-col flex-grow justify-between bg-surface-container-lowest">
                          <div className="flex items-start justify-between">
                            <h3 className="font-headline-md text-headline-md text-on-surface group-hover:text-primary transition-colors line-clamp-1">{toTitleCase(lib.name)}</h3>
                          </div>
                          
                          <div className="flex items-center justify-between mt-6">
                            <div className="flex items-center gap-2 text-on-surface-variant flex-shrink-0">
                              <Book className="w-4 h-4" />
                              <span className="font-label-caps text-label-caps uppercase tracking-wider">{lib.volumeCount || 0} Volumes</span>
                            </div>
                            
                            {lib.ownerId !== user?.uid && (
                              <div className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant px-2 py-1 bg-surface-container rounded-sm border border-outline-variant/50 truncate max-w-[120px]">
                                By {toTitleCase(lib.ownerName)}
                              </div>
                            )}
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
      </div>
    </AppLayout>
  );
}
