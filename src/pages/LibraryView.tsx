import React, { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, collection, query, onSnapshot, addDoc, deleteDoc, serverTimestamp, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { ArrowLeft, Plus, Share2, Settings, Trash2, X, Sparkles, LayoutGrid, List, Table as TableIcon, ArrowUpDown, ArrowUp, ArrowDown, LogOut, Search, Filter, Download, Book as BookIcon, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { GoogleGenAI, Type } from '@google/genai';
import { enrichBooksMetadata, getPickOfTheDay } from '../services/gemini';
import BookCard from '../components/BookCard';
import Chatbot from '../components/Chatbot';
import { BookDetails, searchBookByTitleAndAuthor } from '../services/bookApi';
import { toSentenceCase, toTitleCase } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import AppLayout from '../components/AppLayout';

type FirestoreDate = Timestamp | Date | string | number;

function getFirestoreTime(dateObj?: FirestoreDate): number {
  if (!dateObj) return 0;
  if (typeof dateObj === 'object' && 'toMillis' in dateObj && typeof dateObj.toMillis === 'function') return dateObj.toMillis();
  const d = new Date(dateObj as string | number | Date);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

interface Library {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  sharedWith: string[];
  createdAt: FirestoreDate;
  heroImageUrl?: string;
}

interface Book extends BookDetails {
  id: string;
  addedBy: string;
  addedAt: FirestoreDate;
  userStatuses?: Record<string, 'unset' | 'reading' | 'finished' | 'abandoned'>;
}

type SortOption = 'added' | 'title' | 'author';
type GroupOption = 'none' | 'author' | 'genre' | 'series' | 'lucky';

export default function LibraryView() {
  const { id } = useParams<{ id: string }>();
  const { user, logOut } = useAuth();
  const navigate = useNavigate();
  
  const [library, setLibrary] = useState<Library | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [currentTab, setCurrentTab] = useState<'overview' | 'collection'>('overview');
  const [pickOfTheDay, setPickOfTheDay] = useState<{title: string, author: string, coverUrl?: string, reason: string} | null>(null);
  const [isGeneratingPick, setIsGeneratingPick] = useState(false);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);
  const [resyncTotal, setResyncTotal] = useState(0);
  const [resyncCompleted, setResyncCompleted] = useState(0);
  const [resyncErrors, setResyncErrors] = useState<{title: string, error: string}[]>([]);
  const [showResyncErrors, setShowResyncErrors] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [bookToDelete, setBookToDelete] = useState<string | null>(null);
  const [libraryToDelete, setLibraryToDelete] = useState<boolean>(false);

  const [sortBy, setSortBy] = useState<SortOption>('added');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'standard' | 'table'>('standard');
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());

  const toggleBookSelection = (e: React.MouseEvent, bookId: string) => {
    e.stopPropagation();
    const newSelected = new Set(selectedBooks);
    if (newSelected.has(bookId)) {
        newSelected.delete(bookId);
    } else {
        newSelected.add(bookId);
    }
    setSelectedBooks(newSelected);
  };

  const toggleAllBooks = (shelfBooksList: Book[]) => {
    const listIds = shelfBooksList.map(b => b.id);
    const allSelected = listIds.every(id => selectedBooks.has(id));
    const newSelected = new Set(selectedBooks);
    if (allSelected) {
        listIds.forEach(id => newSelected.delete(id));
    } else {
        listIds.forEach(id => newSelected.add(id));
    }
    setSelectedBooks(newSelected);
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedBooks.size === 0 || !user || !id) return;
    try {
      const promises = Array.from(selectedBooks).map(bookId => {
        const bookRef = doc(db, 'libraries', id, 'books', bookId);
        return updateDoc(bookRef, {
          [`userStatuses.${user.uid}`]: newStatus
        });
      });
      await Promise.all(promises);
      toast.success(`Updated status for ${selectedBooks.size} books`);
      setSelectedBooks(new Set());
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraries/${id}/books`);
    }
  };

  const mainRef = useRef<HTMLElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [filterGenre, setFilterGenre] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  const [filterYearMin, setFilterYearMin] = useState('');
  const [filterYearMax, setFilterYearMax] = useState('');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const generateNewPick = async () => {
    if (books.length === 0 || isGeneratingPick) return;
    setIsGeneratingPick(true);
    try {
      const sample = [...books].sort(() => Math.random() - 0.5).slice(0, 50);
      let pick = await getPickOfTheDay(sample);
      
      let attempts = 0;
      while (pick && attempts < 3) {
        const alreadyExists = books.some(b => b.title.toLowerCase() === pick!.title.toLowerCase() && b.author.toLowerCase() === pick!.author.toLowerCase());
        if (!alreadyExists) break;
        pick = await getPickOfTheDay(sample);
        attempts++;
      }

      if (pick) {
        let coverUrl: string | undefined = undefined;
        try {
          const results = await searchBookByTitleAndAuthor(pick.title, pick.author);
          if (results && results.length > 0 && results[0].coverUrl) {
            coverUrl = results[0].coverUrl;
          }
        } catch (err) {
          console.error("Failed to get cover for pick:", err);
        }
        setPickOfTheDay({ title: pick.title, author: pick.author, coverUrl, reason: pick.reason });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingPick(false);
    }
  };

  useEffect(() => {
    if (books.length > 0 && !pickOfTheDay && !isGeneratingPick && currentTab === 'overview') {
      generateNewPick();
    }
  }, [books, currentTab, pickOfTheDay, isGeneratingPick]);

  const topGenres = useMemo(() => {
    const counts: Record<string, number> = {};
    books.forEach(b => {
      if (b.genre) counts[b.genre] = (counts[b.genre] || 0) + 1;
    });
    return Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 2);
  }, [books]);

  const readingBooks = useMemo(() => {
    if (!user) return [];
    return books.filter(b => b.userStatuses?.[user.uid] === 'reading').slice(0, 2);
  }, [books, user]);

  const lastCatalogedDate = useMemo(() => {
    if (books.length === 0) return 'Never';
    const latestTime = Math.max(...books.map(b => getFirestoreTime(b.addedAt)));
    if (latestTime <= 0) return 'Unknown';
    return new Date(latestTime).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }, [books]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (libraryToDelete) setLibraryToDelete(false);
        else if (bookToDelete) setBookToDelete(null);
        else if (isSettingsOpen) setIsSettingsOpen(false);
        else if (isAdvancedSettingsOpen) setIsAdvancedSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [libraryToDelete, bookToDelete, isSettingsOpen, isAdvancedSettingsOpen]);

  useEffect(() => {
    // Resize observer removed as we now use CSS grid
  }, []);

  useEffect(() => {
    if (!id || !user) return;

    const libRef = doc(db, 'libraries', id);
    const unsubscribeLib = onSnapshot(libRef, (docSnap) => {
      if (docSnap.exists()) {
        setLibrary({ id: docSnap.id, ...docSnap.data() } as Library);
      } else {
        toast.error("Library not found");
        navigate('/');
      }
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `libraries/${id}`);
    });

    const booksRef = collection(db, 'libraries', id, 'books');
    const unsubscribeBooks = onSnapshot(booksRef, (snapshot) => {
      const bks: Book[] = [];
      snapshot.forEach((doc) => {
        bks.push({ id: doc.id, ...doc.data() } as Book);
      });
      const getTime = (dateObj: FirestoreDate | undefined) => {
        if (!dateObj) return 0;
        if (typeof dateObj === 'object' && 'toMillis' in dateObj && typeof dateObj.toMillis === 'function') return dateObj.toMillis();
        const d = new Date(dateObj as string | number | Date);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      
      // Sort by addedAt descending
      bks.sort((a, b) => getTime(b.addedAt) - getTime(a.addedAt));
      setBooks(bks);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `libraries/${id}/books`);
    });

    return () => {
      unsubscribeLib();
      unsubscribeBooks();
    };
  }, [id, user, navigate]);

  const canEdit = library?.ownerId === user?.uid || library?.sharedWith.includes(user?.email || '');
  const isOwner = library?.ownerId === user?.uid;

  useEffect(() => {
    // Backfill any books that have addedAt as a string (without the time) to a full Timestamp at midnight
    // AND backfill any books missing 'format' to 'physical'
    if (!canEdit || books.length === 0 || !id) return;

    let hasUpdates = false;

    books.forEach(b => {
      const updates: Partial<Book> = {};
      
      if (typeof b.addedAt === 'string') {
        const d = new Date(b.addedAt);
        if (!isNaN(d.getTime())) {
          d.setHours(0, 0, 0, 0);
          updates.addedAt = Timestamp.fromDate(d);
        }
      }

      if (!b.format) {
        updates.format = 'physical';
      }

      if (Object.keys(updates).length > 0) {
        hasUpdates = true;
        updateDoc(doc(db, 'libraries', id, 'books', b.id), {
          ...updates
        }).catch(err => console.error("Error backfilling book data", err));
      }
    });
  }, [books, canEdit, id]);

  const handleSort = (option: SortOption) => {
    if (sortBy === option) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(option);
      setSortOrder(option === 'added' ? 'desc' : 'asc');
    }
  };

  const availableGenres = useMemo(() => {
    const genres = new Set<string>();
    books.forEach(b => {
      if (b.genre) genres.add(b.genre);
    });
    return Array.from(genres).sort();
  }, [books]);

  const availableAuthors = useMemo(() => {
    const authors = new Set<string>();
    books.forEach(b => {
      if (b.author) authors.add(b.author);
    });
    return Array.from(authors).sort();
  }, [books]);

  const filteredBooks = useMemo(() => {
    return books.filter(book => {
      if (deferredSearchQuery) {
        const query = deferredSearchQuery.toLowerCase();
        const titleMatch = book.title?.toLowerCase().includes(query);
        const authorMatch = book.author?.toLowerCase().includes(query);
        if (!titleMatch && !authorMatch) return false;
      }
      
      if (filterGenre && book.genre !== filterGenre) {
        return false;
      }
      
      if (filterAuthor && book.author !== filterAuthor) {
        return false;
      }
      
      if (filterYearMin || filterYearMax) {
        const yearMatch = book.publishedDate?.match(/\d{4}/);
        const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
        
        if (filterYearMin && (year === null || year < parseInt(filterYearMin, 10))) return false;
        if (filterYearMax && (year === null || year > parseInt(filterYearMax, 10))) return false;
      }
      
      return true;
    });
  }, [books, deferredSearchQuery, filterGenre, filterAuthor, filterYearMin, filterYearMax]);

  const sortedBooks = useMemo(() => {
    const sorted = [...filteredBooks];
    if (sortBy === 'title') {
      sorted.sort((a, b) => sortOrder === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));
    } else if (sortBy === 'author') {
      sorted.sort((a, b) => sortOrder === 'asc' ? a.author.localeCompare(b.author) : b.author.localeCompare(a.author));
    } else {
      sorted.sort((a, b) => {
        const timeA = getFirestoreTime(a.addedAt);
        const timeB = getFirestoreTime(b.addedAt);
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      });
    }
    return sorted;
  }, [filteredBooks, sortBy, sortOrder]);

  const bookIdsString = books.map(b => b.id).sort().join(',');

  const handleDeleteBook = (bookId: string) => {
    if (!id || !canEdit) return;
    setBookToDelete(bookId);
  };

  const confirmDeleteBook = async () => {
    if (!id || !canEdit || !bookToDelete) return;
    
    try {
      await deleteDoc(doc(db, 'libraries', id, 'books', bookToDelete));
      toast.success("Book removed");
      if (selectedBook?.id === bookToDelete) {
        setSelectedBook(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `libraries/${id}/books/${bookToDelete}`);
    } finally {
      setBookToDelete(null);
    }
  };

  const handleUpdateBook = async (bookId: string, updatedData: Partial<Omit<Book, 'id'>>) => {
    if (!id || !canEdit) return;
    try {
      await updateDoc(doc(db, 'libraries', id, 'books', bookId), {
        ...updatedData
      });
      toast.success("Book updated");
      setSelectedBook(prev => prev && prev.id === bookId ? { ...prev, ...updatedData } : prev);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraries/${id}/books/${bookId}`);
    }
  };

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !isOwner || !shareEmail.trim() || !library) return;
    
    try {
      const newSharedWith = [...new Set([...library.sharedWith, shareEmail.trim().toLowerCase()])];
      await updateDoc(doc(db, 'libraries', id), {
        sharedWith: newSharedWith
      });
      setShareEmail('');
      toast.success(`Shared with ${shareEmail}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraries/${id}`);
    }
  };

  const handleRemoveShare = async (email: string) => {
    if (!id || !isOwner || !library) return;
    try {
      const newSharedWith = library.sharedWith.filter(e => e !== email);
      await updateDoc(doc(db, 'libraries', id), {
        sharedWith: newSharedWith
      });
      toast.success(`Removed access for ${email}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraries/${id}`);
    }
  };

  const handleDeleteLibrary = () => {
    if (!id || !isOwner) return;
    setLibraryToDelete(true);
  };

  const confirmDeleteLibrary = async () => {
    if (!id || !isOwner) return;
    
    try {
      const { writeBatch, collection, getDocs } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      // Delete all books in the library
      const booksRef = collection(db, 'libraries', id, 'books');
      const booksSnapshot = await getDocs(booksRef);
      booksSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      // Delete the library document itself
      batch.delete(doc(db, 'libraries', id));
      
      await batch.commit();
      toast.success("Library deleted");
      navigate('/');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `libraries/${id}`);
    } finally {
      setLibraryToDelete(false);
    }
  };

  const handleExportToCSV = () => {
    if (!library || books.length === 0) {
      toast.error("No books to export");
      return;
    }

    const headers = ['Title', 'Author', 'ISBN', 'Genre', 'Published Date', 'Added Date'];
    
    const escapeCSV = (str: string | undefined) => {
      if (!str) return '""';
      const escaped = String(str).replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const rows = books.map(book => {
      let addedDateStr = '';
      if (book.addedAt) {
        const time = getFirestoreTime(book.addedAt);
        if (time > 0) {
          addedDateStr = new Date(time).toLocaleString();
        }
      }
      return [
        escapeCSV(book.title),
        escapeCSV(book.author),
        escapeCSV(book.isbn),
        escapeCSV(book.genre),
        escapeCSV(book.publishedDate),
        escapeCSV(addedDateStr)
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${library.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success("Library exported to CSV");
  };

  const handleResyncAllBooks = async () => {
    if (!id || !canEdit) return;
    const booksToSync = books.filter(b => (!b.isbn || b.isbn === 'null' || !b.genre || !b.series) && b.author);
    
    if (booksToSync.length === 0) {
      toast.info("All books already have ISBN, Genre, and Series synced.");
      return;
    }

    setResyncTotal(booksToSync.length);
    setResyncCompleted(0);
    setIsResyncing(true);
    setResyncErrors([]);
    setShowResyncErrors(false);
    let updatedCount = 0;
    const currentErrors: {title: string, error: string}[] = [];

    try {
      // Process in batches of 10 to avoid overwhelming endpoints
      const batchSize = 10;
      for (let i = 0; i < booksToSync.length; i += batchSize) {
        const batch = booksToSync.slice(i, i + batchSize);
        // First, check ISBNs via normal API
        await Promise.all(batch.map(async (book) => {
          try {
            const changes: Partial<Omit<Book, 'id'>> = {};
            if (!book.isbn || book.isbn === 'null') {
              const results = await searchBookByTitleAndAuthor(book.title, book.author);
              if (results && results.length > 0 && results[0].isbn) {
                changes.isbn = results[0].isbn;
                if (!book.genre && results[0].genre) {
                  changes.genre = results[0].genre;
                }
              }
            }

            if (Object.keys(changes).length > 0) {
              await updateDoc(doc(db, 'libraries', id, 'books', book.id), {
                ...changes
              });
            }
          } catch (err: unknown) {
             currentErrors.push({ title: book.title, error: err instanceof Error ? err.message : "Failed to fetch ISBN" });
          }
        }));

        // Next, enrich any missing genre/series for the batch via Gemini
        const missingMetadataBooks = batch.filter(b => !b.genre || !b.series);
        if (missingMetadataBooks.length > 0) {
           try {
             const enrichments = await enrichBooksMetadata(missingMetadataBooks.map(b => ({
               id: b.id,
               title: b.title,
               author: b.author,
               currentGenre: b.genre
             })));
             
             await Promise.all((enrichments || []).map(async (enriched) => {
               const book = missingMetadataBooks.find(b => b.id === enriched.id);
               if (book) {
                 const changes: Partial<Omit<Book, 'id'>> = {};
                 if (!book.genre) changes.genre = enriched.genre;
                 if (!book.series) changes.series = enriched.series;
                 if (Object.keys(changes).length > 0) {
                   await updateDoc(doc(db, 'libraries', id, 'books', book.id), {
                     ...changes
                   });
                   updatedCount++;
                 }
               }
             }));
           } catch (err: unknown) {
             console.error("Batch enrichment failed", err);
           }
        }
        
        // Progress update
        setResyncCompleted(prev => prev + batch.length);

        // Add a small delay between batches to avoid rate limits
        if (i + batchSize < booksToSync.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      if (updatedCount > 0) {
        toast.success(`Successfully resynced ${updatedCount} books.`);
      } else if (currentErrors.length > 0) {
        toast.error(`Resync finished, but issues were found.`);
      } else {
        toast.info("Resync finished. No new metadata found.");
      }
    } catch (err) {
      toast.error("Failed to finish resyncing all books.");
    } finally {
      setIsResyncing(false);
      setResyncTotal(0);
      setResyncCompleted(0);
      setResyncErrors(currentErrors);
      if (currentErrors.length === 0) {
        setIsAdvancedSettingsOpen(false);
      }
    }
  };

  if (isLoading) {
    return (
      <AppLayout sidebarActions={<></>}>
        <div className="flex-grow flex flex-col min-h-screen w-full bg-background animate-pulse">
           <div className="w-full h-48 sm:h-64 bg-surface-variant/50 relative overflow-hidden"></div>
           <div className="flex-grow flex flex-col w-full max-w-screen-2xl mx-auto px-4 sm:px-8 py-8 gap-8">
              <div className="h-10 bg-surface-variant/50 w-64 rounded"></div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6 lg:gap-8">
                 {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="aspect-[2/3] bg-surface-variant/50 shadow-sm rounded-sm"></div>
                 ))}
              </div>
           </div>
        </div>
      </AppLayout>
    );
  }

  if (!library) return null;

  const renderShelves = (shelfBooksList: Book[], emptyMessage = "Empty Shelf") => {
    if (viewMode === 'table') {
      const SortIcon = ({ column }: { column: SortOption }) => {
        if (sortBy !== column) return <ArrowUpDown size={14} className="opacity-30" />;
        return sortOrder === 'asc' ? <ArrowUp size={14} className="text-accent" /> : <ArrowDown size={14} className="text-accent" />;
      };

      return (
        <div className="bg-surface-container-lowest rounded-xl border border-surface-variant overflow-hidden shadow-[0_2px_12px_rgba(2,26,53,0.03)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-surface-variant">
                  <th className="py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase w-1/2 cursor-pointer hover:bg-surface-variant/30 transition-colors" onClick={() => handleSort('title')}>
                    <div className="flex items-center gap-4">
                      {user && (
                         <div className={`w-8 flex items-center justify-center flex-shrink-0 transition-opacity ${selectedBooks.size > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={(e) => { e.stopPropagation(); toggleAllBooks(shelfBooksList); }}>
                           <input type="checkbox" checked={selectedBooks.size > 0 && shelfBooksList.length > 0 && shelfBooksList.every(b => selectedBooks.has(b.id))} ref={el => { if (el) el.indeterminate = selectedBooks.size > 0 && !shelfBooksList.every(b => selectedBooks.has(b.id)); }} onChange={() => {}} className="pointer-events-none w-4 h-4 accent-primary" />
                         </div>
                      )}
                      <div className="flex items-center gap-2">Title <SortIcon column="title" /></div>
                    </div>
                  </th>
                  <th className="py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase w-1/4 cursor-pointer hover:bg-surface-variant/30 transition-colors" onClick={() => handleSort('author')}>
                    <div className="flex items-center gap-2">Author <SortIcon column="author" /></div>
                  </th>
                  <th className="hidden sm:table-cell py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase text-right cursor-pointer hover:bg-surface-variant/30 transition-colors" onClick={() => handleSort('added')}>
                    <div className="flex items-center gap-2 justify-end">Added <SortIcon column="added" /></div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-variant/60">
                <AnimatePresence>
                  {shelfBooksList.map((book, idx) => {
                    const hash = book.title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                    const gradients = [
                      'from-[#2f4d40] to-[#163428]',
                      'from-[#7d5633] to-[#2e1500]',
                      'from-[#021a35] to-[#041c37]',
                      'from-[#8397b8] to-[#4b5f7e]',
                      'from-[#e5e2dc] to-[#dcdad4]'
                    ];
                    const gradientClass = gradients[hash % gradients.length];

                    return (
                      <motion.tr 
                        key={book.id} 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.2 }}
                        onClick={() => navigate(`/library/${id}/book/${book.id}`)}
                        className="group hover:bg-surface-container-low/50 transition-colors cursor-pointer"
                      >
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-4 group/cover">
                            <div 
                              className="h-12 w-8 flex-shrink-0 relative overflow-hidden rounded-sm cursor-pointer"
                              onClick={(e) => toggleBookSelection(e, book.id)}
                            >
                               {/* Checkbox Layer */}
                               {user && (
                                   <div className={`absolute inset-0 z-20 flex items-center justify-center transition-all ${(selectedBooks.size > 0 || selectedBooks.has(book.id)) ? 'opacity-100 bg-transparent' : 'opacity-0 group-hover/cover:opacity-100 hover:bg-surface-variant/30'}`}>
                                       <input type="checkbox" checked={selectedBooks.has(book.id)} onChange={() => {}} className="pointer-events-none w-4 h-4 accent-primary" />
                                   </div>
                               )}
                               
                               {/* Cover Layer */}
                               <div className={`absolute inset-0 bg-surface-variant shadow-sm border border-outline-variant/30 transition-opacity ${user && (selectedBooks.size > 0 || selectedBooks.has(book.id)) ? 'opacity-0' : 'opacity-100 group-hover/cover:opacity-0'}`}>
                                 {book.coverUrl ? (
                                   <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                                 ) : (
                                   <div className={`absolute inset-0 bg-gradient-to-br ${gradientClass} opacity-80`}></div>
                                 )}
                               </div>
                            </div>
                            <span className="font-headline-md text-[18px] sm:text-[20px] text-on-surface line-clamp-2 max-w-lg leading-snug">{toTitleCase(book.title)}</span>
                          </div>
                        </td>
                        <td className="py-4 px-6 font-body-md text-body-md text-on-surface-variant">{toTitleCase(book.author)}</td>
                        <td className="hidden sm:table-cell py-4 px-6 text-right font-body-md text-outline whitespace-nowrap">
                          {book.addedAt && getFirestoreTime(book.addedAt) > 0
                            ? new Date(getFirestoreTime(book.addedAt)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                            : 'Unknown'}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
                {shelfBooksList.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-on-surface-variant italic font-body-md text-sm">
                      {emptyMessage}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
        <AnimatePresence>
          {shelfBooksList.map((book, idx) => (
            <motion.div
              key={book.id}
              initial={{ opacity: 0, y: 15, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.35, delay: Math.min(idx, 15) * 0.03, ease: [0.25, 0.1, 0.25, 1.0] }}
            >
              <BookCard book={book} onClick={() => navigate(`/library/${id}/book/${book.id}`)} canEdit={canEdit} />
            </motion.div>
          ))}
        </AnimatePresence>
        {shelfBooksList.length === 0 && (
          <div className="col-span-full w-full py-12 flex flex-col items-center justify-center opacity-80 font-body-md text-sm pb-8 text-on-surface-variant">
            <div className="w-12 h-12 mb-3 border-2 border-dashed border-outline-variant/60 rounded-full flex items-center justify-center">
              <BookIcon size={20} className="text-on-surface-variant" />
            </div>
            {emptyMessage}
          </div>
        )}
      </div>
    );
  };

  const renderOverview = () => (
    <div className="flex-grow p-4 sm:p-8 lg:p-12 w-full max-w-screen-2xl mx-auto">
      <header className="mb-12">
        <h2 className="font-headline-xl text-headline-xl text-primary mb-2">Library Overview</h2>
        <p className="font-body-lg text-body-lg text-on-surface-variant">Your personal catalog of wisdom and narratives.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Stats Column (Spans 4 columns) */}
        <div className="md:col-span-4 flex flex-col gap-6">
          {/* Total Volumes Card */}
          <div 
            onClick={() => setCurrentTab('collection')}
            className="bg-surface-container-low p-6 shadow-[0_4px_24px_rgba(26,47,75,0.04)] relative overflow-hidden group cursor-pointer hover:bg-surface-container transition-colors"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <BookIcon className="w-16 h-16" />
            </div>
            <p className="font-label-caps text-label-caps text-secondary uppercase tracking-widest mb-2">Total Volumes</p>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-xl text-[56px] leading-none text-primary">{books.length}</span>
              <span className="font-body-md text-on-surface-variant">books</span>
            </div>
            <div className="mt-4 pt-4 border-t border-outline-variant/30 flex justify-between items-center">
              <span className="font-body-md text-sm text-on-surface-variant">Last Cataloged</span>
              <span className="font-body-md text-sm font-medium text-primary">{lastCatalogedDate}</span>
            </div>
          </div>

          {/* Genre Stats Card */}
          <div className="bg-surface p-6 border border-surface-variant relative shadow-sm">
            <p className="font-label-caps text-label-caps text-secondary uppercase tracking-widest mb-6">Key Disciplines</p>
            <div className="space-y-5">
              {topGenres.length > 0 ? topGenres.map(([genre, count], idx) => (
                <React.Fragment key={genre}>
                  <div className="flex items-center justify-between group cursor-pointer" onClick={() => { setFilterGenre(genre); setCurrentTab('collection'); setIsFiltersOpen(true); }}>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full ${idx === 0 ? 'bg-tertiary-fixed-dim/20 text-tertiary' : 'bg-secondary-container/20 text-secondary'} flex items-center justify-center`}>
                        <Sparkles size={18} />
                      </div>
                      <span className="font-body-md font-medium text-on-surface group-hover:text-primary transition-colors">{genre}</span>
                    </div>
                    <span className="font-headline-md text-headline-md text-primary">{count}</span>
                  </div>
                  {idx === 0 && topGenres.length > 1 && <div className="w-full h-[1px] bg-surface-variant"></div>}
                </React.Fragment>
              )) : (
                <p className="font-body-md text-on-surface-variant italic">No genres categorized yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Reading & Picks Column (Spans 8 columns) */}
        <div className="md:col-span-8 flex flex-col gap-6">
          {/* Currently Reading Card */}
          {readingBooks.length > 0 ? readingBooks.map(book => (
            <div key={`reading-${book.id}`} className="bg-surface-container-lowest p-8 shadow-[0_8px_32px_rgba(26,47,75,0.06)] border border-surface-variant flex flex-col md:flex-row gap-8 items-center">
              <div className="w-32 md:w-40 flex-shrink-0 relative group cursor-pointer" onClick={() => navigate(`/library/${id}/book/${book.id}`)}>
                <div className="absolute inset-0 bg-primary/10 -rotate-3 transform rounded-sm shadow-md"></div>
                {book.coverUrl ? (
                  <img alt={book.title} className="relative w-full h-auto object-cover rounded-sm shadow-lg border border-outline-variant/20 z-10 aspect-[2/3]" src={book.coverUrl} />
                ) : (
                  <div className="relative w-full h-48 sm:h-56 bg-surface-variant rounded-sm shadow-lg border border-outline-variant/20 z-10 flex items-center justify-center p-4 text-center">
                    <span className="font-serif text-sm font-bold text-on-surface-variant font-headline-md">{book.title}</span>
                  </div>
                )}
              </div>
              <div className="flex-grow w-full">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-label-caps text-label-caps text-primary border border-primary/20 uppercase tracking-widest bg-primary/5 px-3 py-1.5 rounded-sm inline-block shadow-sm">Currently Reading</h4>
                </div>
                <h3 className="font-headline-lg text-headline-lg text-primary mt-3 mb-1 line-clamp-2">{toTitleCase(book.title)}</h3>
                <p className="font-body-lg text-body-lg text-on-surface-variant italic mb-6">{toTitleCase(book.author)}</p>
                <div className="mt-auto flex justify-end">
                  <button onClick={() => navigate(`/library/${id}/book/${book.id}`)} className="px-6 py-2 bg-primary text-on-primary font-body-md font-medium rounded hover:bg-primary/90 transition-colors shadow-sm">View Details</button>
                </div>
              </div>
            </div>
          )) : (
            <div className="bg-surface-container-lowest p-8 shadow-[0_8px_32px_rgba(26,47,75,0.06)] border border-surface-variant flex flex-col gap-4 justify-center items-center text-center">
              <BookIcon className="w-12 h-12 text-on-surface-variant opacity-70" />
              <p className="font-body-lg text-on-surface-variant">You aren't currently reading any books in this library.</p>
              <button onClick={() => setCurrentTab('collection')} className="px-6 py-2 bg-primary text-on-primary font-body-md font-medium rounded hover:bg-primary/90 transition-colors shadow-sm">Browse Collection</button>
            </div>
          )}

          {/* Gemini Pick of the Day Card */}
          <div className="bg-gradient-to-br from-surface-container-low to-surface border border-outline-variant/30 p-8 relative overflow-hidden min-h-[220px] flex items-center">
            {/* Sparkle decorative element */}
            <div className="absolute top-6 right-6 text-[#A8C7FA] opacity-50">
              <Sparkles size={32} />
            </div>
            
            <button 
              onClick={() => generateNewPick()} 
              className="absolute top-4 left-4 p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container rounded-full transition-colors z-20"
              title="Get another recommendation"
            >
              <RefreshCw size={20} />
            </button>
            
            {isGeneratingPick ? (
              <div className="w-full flex flex-col items-center justify-center gap-4 py-8">
                <Loader2 className="animate-spin text-primary" size={32} />
                <p className="font-body-md text-on-surface-variant animate-pulse">Curating your pick of the day...</p>
              </div>
            ) : pickOfTheDay ? (
              <div className="flex flex-col md:flex-row gap-8 w-full z-10 w-full relative">
                <div className="w-24 md:w-32 flex-shrink-0 mt-10 md:mt-8 z-0">
                  {pickOfTheDay.coverUrl ? (
                    <img alt="Book Cover" className="w-full h-auto object-cover rounded-sm shadow-md border border-outline-variant/20 aspect-[2/3]" src={pickOfTheDay.coverUrl} />
                  ) : (
                    <div className="w-full h-36 bg-surface-variant rounded-sm shadow-md border border-outline-variant/20 flex items-center justify-center p-2 text-center text-xs font-serif text-on-surface-variant">
                      {pickOfTheDay.title}
                    </div>
                  )}
                </div>
                <div className="flex flex-col justify-center flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <h4 className="font-label-caps text-label-caps text-primary border border-primary/20 uppercase tracking-widest flex items-center gap-2 bg-primary/5 px-3 py-1.5 rounded-sm shadow-sm w-fit">
                      <Sparkles size={16} />
                      Curator's Pick
                    </h4>
                  </div>
                  <h3 className="font-headline-md text-headline-md text-primary mb-1">{toTitleCase(pickOfTheDay.title)}</h3>
                  <p className="font-body-md text-on-surface-variant italic mb-4">{toTitleCase(pickOfTheDay.author)}</p>
                  <div className="border-l-2 border-secondary/30 pl-4 py-1 pr-8">
                    <p className="font-body-md text-body-md text-on-surface leading-relaxed">
                      "{pickOfTheDay.reason}"
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <AppLayout
      sidebarActions={
        <>
          <Link 
            to="/"
            className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 font-serif text-lg tracking-tight"
          >
            <ArrowLeft className="w-5 h-5 text-on-surface-variant" />
            <span>Back to Libraries</span>
          </Link>

          {canEdit && (
            <button 
              onClick={() => {
                navigate(`/library/${id}/add`);
              }}
              className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight"
            >
              <Plus className="w-5 h-5 text-primary" />
              <span>Add Book</span>
            </button>
          )}

          {canEdit && (
            <button 
              onClick={() => {
                setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen);
              }}
              className={`flex items-center gap-3 pl-6 py-3 transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight ${isAdvancedSettingsOpen ? 'bg-surface-container text-primary border-r-2 border-primary' : 'text-on-surface hover:text-primary hover:bg-surface-container'}`}
            >
              <Settings className="w-5 h-5 opacity-80" />
              <span>Settings</span>
            </button>
          )}

          {isOwner && (
            <button 
              onClick={() => {
                setIsSettingsOpen(!isSettingsOpen);
              }}
              className={`flex items-center gap-3 pl-6 py-3 transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight ${isSettingsOpen ? 'bg-surface-container text-primary border-r-2 border-primary' : 'text-on-surface hover:text-primary hover:bg-surface-container'}`}
            >
              <Share2 className="w-5 h-5 opacity-80" />
              <span>Share</span>
            </button>
          )}
        </>
      }
    >
      <div className="flex-grow flex flex-col min-h-screen w-full">
        
        {/* Main Content Wrapper */}
        <div className="flex-grow flex flex-col w-full">
          <div className="w-full px-4 sm:px-8 pt-4 border-b border-outline-variant/30 flex flex-col sm:flex-row justify-between sm:items-end gap-3 sm:gap-0 bg-surface-container-lowest">
            <div className="flex gap-6 overflow-x-auto no-scrollbar">
              <button 
                onClick={() => setCurrentTab('overview')} 
                className={`pb-3 font-label-caps uppercase cursor-pointer tracking-wider text-sm transition-colors border-b-2 whitespace-nowrap ${currentTab === 'overview' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'}`}
              >
                Overview
              </button>
              <button 
                onClick={() => setCurrentTab('collection')} 
                className={`pb-3 font-label-caps uppercase cursor-pointer tracking-wider text-sm transition-colors border-b-2 whitespace-nowrap ${currentTab === 'collection' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'}`}
              >
                Collection
              </button>
            </div>
          </div>

          {currentTab === 'overview' ? (
            renderOverview()
          ) : (
            <>
              <div className={`w-full h-48 sm:h-64 relative overflow-hidden ${!library.heroImageUrl ? 'bg-primary' : ''}`}>

          {library.heroImageUrl && (
            <img src={library.heroImageUrl} alt={library.name} className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-6 left-6 sm:left-10 text-white">
            <h1 className="text-3xl sm:text-5xl font-serif font-medium tracking-tight drop-shadow-lg mb-2 leading-tight">{toTitleCase(library.name)}</h1>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              <p className="text-xs sm:text-sm font-sans font-medium uppercase tracking-wider text-white/90">
                {books.length} {books.length === 1 ? 'volume' : 'volumes'} • {isOwner ? 'Owned by you' : `Shared by ${toTitleCase(library.ownerName)}`}
              </p>
            </div>
          </div>
        </div>
      
      <div className="sticky top-0 z-40 flex flex-col shadow-[0_4px_20px_rgba(26,47,75,0.02)] border-b border-outline-variant/30 bg-surface/80 backdrop-blur-md">
        <div className="px-4 sm:px-8 min-h-16 py-2.5 flex flex-wrap lg:flex-nowrap items-center justify-between gap-y-3 gap-x-6 transition-all">
          
          {/* Sort, Group, Filter Controls */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {currentTab === 'collection' && (
              <div className="relative w-full sm:w-64 max-w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                <input 
                  className="w-full pl-9 pr-3 py-1.5 bg-surface-container border border-outline-variant/50 rounded-md font-body-md text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:ring-inset hover:border-primary/50 transition-colors" 
                  placeholder="Search collection..." 
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-md border border-outline-variant/40">
              <label className="text-xs font-label-caps text-on-surface-variant uppercase tracking-wider hidden sm:block">Sort by:</label>
              <select 
                value={sortBy} 
                onChange={e => handleSort(e.target.value as SortOption)}
                className="bg-transparent border-none text-on-surface font-body-md text-sm focus:outline-none cursor-pointer min-w-[125px] appearance-none hover:text-primary transition-colors"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 0 center', backgroundRepeat: 'no-repeat', backgroundSize: '1em', paddingRight: '1.25rem' }}
              >
                <option value="added">Recently Added</option>
                <option value="title">Title (A-Z)</option>
                <option value="author">Author (A-Z)</option>
              </select>
              {sortBy !== 'added' && (
                <button 
                  onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="p-0.5 text-on-surface hover:text-primary transition-colors rounded-full hover:bg-surface-container"
                >
                  {sortOrder === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                </button>
              )}
            </div>
            
            <button
              onClick={() => setIsFiltersOpen(!isFiltersOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-body-md transition-all border ${isFiltersOpen || searchQuery || filterGenre || filterAuthor || filterYearMin || filterYearMax ? 'bg-primary text-on-primary border-primary shadow-sm' : 'bg-surface text-on-surface border-outline-variant/60 hover:border-outline-variant hover:shadow-sm'}`}
            >
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">Filters</span>
              {(searchQuery || filterGenre || filterAuthor || filterYearMin || filterYearMax) && <span className="w-1.5 h-1.5 rounded-full bg-surface"></span>}
            </button>
          </div>

          {/* View Modes */}
          <div className="flex items-center gap-3 w-full lg:w-auto lg:ml-auto">
            <div className="flex items-center bg-surface-container-lowest rounded-md p-1 border border-outline-variant/40 flex-shrink-0">
              <button
                onClick={() => setViewMode('standard')}
                className={`p-1.5 sm:px-3 sm:py-1.5 rounded-md transition-all flex items-center gap-2 text-sm font-body-md ${viewMode === 'standard' ? 'bg-surface shadow-sm text-primary' : 'text-on-surface hover:text-primary'}`}
                title="Grid View"
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="hidden sm:inline">Grid</span>
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 sm:px-3 sm:py-1.5 rounded-md transition-all flex items-center gap-2 text-sm font-body-md ${viewMode === 'table' ? 'bg-surface shadow-sm text-primary' : 'text-on-surface hover:text-primary'}`}
                title="Table View"
              >
                <TableIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Table</span>
              </button>
            </div>
          </div>
        </div>

        {/* Filters Bar */}
          {isFiltersOpen && (
            <div className="px-4 sm:px-8 py-4 bg-surface border-t border-outline-variant/40 flex flex-wrap gap-4 items-center animate-in slide-in-from-top-2 fade-in duration-200">
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={filterGenre}
                  onChange={(e) => setFilterGenre(e.target.value)}
                  className="px-4 py-2 bg-surface border border-outline-variant/60 rounded-md text-sm focus:outline-none focus:border-primary font-body-md text-on-surface appearance-none min-w-[120px]"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 0.75rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1em' }}
                >
                  <option value="">All Genres</option>
                  {availableGenres.map(genre => (
                    <option key={genre} value={genre}>{genre}</option>
                  ))}
                </select>

                <select
                  value={filterAuthor}
                  onChange={(e) => setFilterAuthor(e.target.value)}
                  className="px-4 py-2 bg-paper/50 border border-border/60 rounded-full text-sm focus:outline-none focus:border-ink/50 font-sans text-ink max-w-[150px] truncate appearance-none"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 0.75rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1em' }}
                >
                  <option value="">All Authors</option>
                  {availableAuthors.map(author => (
                    <option key={author} value={author}>{author}</option>
                  ))}
                </select>

                <div className="flex items-center gap-1.5 text-sm font-sans text-muted bg-paper/50 px-3 py-1 border border-border/60 rounded-full">
                  <input
                    type="number"
                    placeholder="Min Yr"
                    value={filterYearMin}
                    onChange={(e) => setFilterYearMin(e.target.value)}
                    className="w-14 bg-transparent focus:outline-none text-ink text-center placeholder-muted/70"
                  />
                  <span className="opacity-40">-</span>
                  <input
                    type="number"
                    placeholder="Max Yr"
                    value={filterYearMax}
                    onChange={(e) => setFilterYearMax(e.target.value)}
                    className="w-14 bg-transparent focus:outline-none text-ink text-center placeholder-muted/70"
                  />
                </div>
              </div>

              {(searchQuery || filterGenre || filterAuthor || filterYearMin || filterYearMax) && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setFilterGenre('');
                    setFilterAuthor('');
                    setFilterYearMin('');
                    setFilterYearMax('');
                  }}
                  className="text-xs text-muted hover:text-ink font-bold uppercase tracking-wider transition-colors px-2"
                >
                  Clear All
                </button>
              )}
            </div>
          )}
      </div>

      <main ref={mainRef} className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col lg:flex-row gap-6 sm:gap-8">
        <div className="flex-1 min-w-0">
          {sortedBooks.length === 0 ? (
            <div className="text-center py-24 px-6 bg-surface-container-low rounded-lg border border-outline-variant/30 architectural-shadow">
              <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-outline-variant/30 relative z-10">
                <BookIcon size={36} className="text-on-surface-variant" strokeWidth={1.5} />
              </div>
              <h3 className="text-2xl font-serif font-bold mb-3 text-primary relative z-10 tracking-tight">No books found</h3>
              <p className="text-on-surface-variant text-lg max-w-md mx-auto relative z-10">
                {books.length === 0 ? "This library is empty. Let's add some great reads to your collection." : "No books match your current filters."}
              </p>
              {books.length === 0 && canEdit && (
                <button
                  onClick={() => navigate(`/library/${id}/add`)}
                  className="mt-8 inline-flex items-center gap-2 bg-primary text-on-primary px-6 py-3 rounded-md hover:bg-primary/90 transition-all font-body-md text-sm font-bold relative z-10 architectural-shadow"
                >
                  <Plus size={18} strokeWidth={2.5} />
                  Add Your First Book
                </button>
              )}
            </div>
          ) : (
            <div className="mb-10 sm:mb-12 last:mb-0">
              {renderShelves(sortedBooks)}
            </div>
          )}
        </div>
      </main>
      </>
      )}

      {/* Settings Modal */}
        <AnimatePresence>
          {isSettingsOpen && isOwner && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 font-sans" 
              onClick={() => setIsSettingsOpen(false)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-[0px_10px_40px_rgba(0,0,0,0.1)] h-fit max-h-[90vh] overflow-y-auto border border-border/50" 
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-serif font-medium flex items-center gap-3 text-ink tracking-tight">
                  <div className="w-10 h-10 bg-paper rounded-full flex items-center justify-center text-accent border border-border/50">
                    <Share2 size={20} strokeWidth={1.5} />
                  </div>
                  Share & Settings
                </h3>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2.5 text-muted hover:bg-paper hover:text-ink rounded-full transition-colors border border-transparent hover:border-border/50">
                  <X size={20} strokeWidth={1.5} />
                </button>
              </div>
              
              <div className="mb-10">
                <h4 className="text-sm font-medium text-muted mb-4 uppercase tracking-wider">Share Access</h4>
                <form onSubmit={handleShare} className="flex gap-3 mb-6">
                  <input
                    type="email"
                    value={shareEmail}
                    onChange={(e) => setShareEmail(e.target.value)}
                    placeholder="friend@email.com"
                    className="flex-1 bg-paper border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                    required
                  />
                  <button type="submit" className="bg-primary text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-opacity-90 transition-all shadow-sm">
                    Share
                  </button>
                </form>
                
                <div className="space-y-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  {library.sharedWith.length === 0 ? (
                    <div className="bg-paper border border-border/50 rounded-xl p-4 text-center">
                      <p className="text-sm text-muted">Not shared with anyone yet.</p>
                    </div>
                  ) : (
                    library.sharedWith.map(email => (
                      <div key={email} className="flex items-center justify-between bg-paper border border-border/50 px-4 py-3 rounded-xl text-sm group hover:border-border transition-colors">
                        <span className="truncate mr-3 font-medium text-ink">{email}</span>
                        <button onClick={() => handleRemoveShare(email)} className="text-muted hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100">
                          <X size={16} strokeWidth={2} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Advanced Settings Modal */}
        <AnimatePresence>
          {isAdvancedSettingsOpen && canEdit && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 font-sans" 
              onClick={() => setIsAdvancedSettingsOpen(false)}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-[0px_10px_40px_rgba(0,0,0,0.1)] h-fit max-h-[90vh] overflow-y-auto border border-border/50" 
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-serif font-medium flex items-center gap-3 text-ink tracking-tight">
                  <div className="w-10 h-10 bg-paper rounded-full flex items-center justify-center text-accent border border-border/50">
                    <Settings size={20} strokeWidth={1.5} />
                  </div>
                  Advanced Settings
                </h3>
                <button onClick={() => setIsAdvancedSettingsOpen(false)} className="p-2.5 text-muted hover:bg-paper hover:text-ink rounded-full transition-colors border border-transparent hover:border-border/50">
                  <X size={20} strokeWidth={1.5} />
                </button>
              </div>
              
              <div className="mb-10">
                <h4 className="text-sm font-medium text-muted mb-4 uppercase tracking-wider">Data Operations</h4>
                <button
                  onClick={handleResyncAllBooks}
                  disabled={isResyncing}
                  className={`w-full flex items-center justify-center gap-2 bg-paper text-ink border border-border px-5 py-4 rounded-xl hover:bg-surface hover:border-border/80 transition-colors text-sm font-medium shadow-sm ${isResyncing ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isResyncing ? (
                    <><Loader2 size={18} className="animate-spin" /> Resyncing ({resyncCompleted}/{resyncTotal})...</>
                  ) : (
                    <><Sparkles size={18} strokeWidth={1.5} /> Resync Missing Metadata</>
                  )}
                </button>
                <p className="text-xs text-muted mt-3 text-center">
                  Scans your library and attempts to fetch missing ISBNs or genre categories using Google Books API.
                </p>
                {resyncErrors.length > 0 && !isResyncing && (
                  <div className="mt-4 border border-red-500/20 bg-red-500/5 rounded-xl p-4 overflow-hidden">
                    <button 
                      onClick={() => setShowResyncErrors(!showResyncErrors)} 
                      className="text-red-600 text-sm font-bold flex items-center justify-between w-full transition-colors hover:text-red-700"
                    >
                      <div className="flex items-center gap-2">
                        <AlertCircle size={16} strokeWidth={2} />
                        Show Issues (Advanced)
                      </div>
                      <span>{resyncErrors.length}</span>
                    </button>
                    <AnimatePresence>
                      {showResyncErrors && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <ul className="mt-3 space-y-2 text-xs text-red-800/80 max-h-32 overflow-y-auto custom-scrollbar border-t border-red-500/10 pt-3">
                            {resyncErrors.map((e, index) => (
                              <li key={index} className="truncate">
                                <strong className="font-semibold">{e.title}</strong>: {e.error}
                              </li>
                            ))}
                          </ul>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              <div className="mb-10 pt-8 border-t border-border/50">
                <h4 className="text-sm font-medium text-muted mb-4 uppercase tracking-wider">Export Data</h4>
                <button
                  onClick={handleExportToCSV}
                  className="w-full flex items-center justify-center gap-2 bg-paper text-ink border border-border px-5 py-4 rounded-xl hover:bg-surface hover:border-border/80 transition-colors text-sm font-medium shadow-sm"
                >
                  <Download size={18} strokeWidth={1.5} /> Export to CSV (Google Sheets)
                </button>
                <p className="text-xs text-muted mt-3 text-center">
                  Download your library as a CSV file to import into Google Sheets or Excel.
                </p>
              </div>

              {isOwner && (
                <div className="pt-8 border-t border-border/50">
                  <h4 className="text-sm font-medium text-red-500 mb-4 uppercase tracking-wider">Danger Zone</h4>
                  <button
                    onClick={handleDeleteLibrary}
                    className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-600 border border-red-100 px-5 py-4 rounded-xl hover:bg-red-100 hover:border-red-200 transition-colors text-sm font-medium"
                  >
                    <Trash2 size={18} strokeWidth={1.5} /> Delete Library
                  </button>
                </div>
              )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      {/* Bulk Actions Bar */}
      <AnimatePresence>
        {selectedBooks.size > 0 && (
          <motion.div 
             initial={{ y: 100, opacity: 0 }}
             animate={{ y: 0, opacity: 1 }}
             exit={{ y: 100, opacity: 0 }}
             className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-surface border border-outline-variant/30 px-6 py-4 rounded-full shadow-[0_10px_30px_rgba(0,0,0,0.1)] flex items-center gap-6 z-[60] architectural-shadow"
          >
             <span className="font-headline-md text-sm text-on-surface whitespace-nowrap">{selectedBooks.size} selected</span>
             <div className="flex items-center gap-3 border-l border-outline-variant/30 pl-6">
                 <span className="text-sm font-label-caps text-on-surface-variant uppercase tracking-wider hidden sm:inline">Set Status</span>
                 <select 
                    className="bg-surface-container-low border border-outline-variant/50 rounded-lg px-4 py-2 text-sm font-body-md text-on-surface outline-none cursor-pointer hover:bg-surface-container transition-colors shadow-sm min-w-[140px]"
                    onChange={(e) => handleBulkStatusChange(e.target.value)}
                    value=""
                 >
                    <option value="" disabled>Choose...</option>
                    <option value="reading">Currently Reading</option>
                    <option value="finished">Finished</option>
                    <option value="abandoned">Abandoned</option>
                    <option value="unset">Remove Status</option>
                 </select>
             </div>
             <button onClick={() => setSelectedBooks(new Set())} className="ml-2 p-2 hover:bg-surface-variant/50 rounded-full transition-colors text-on-surface-variant hover:text-on-surface" title="Clear selection">
               <X size={18} strokeWidth={2} />
             </button>
          </motion.div>
        )}
      </AnimatePresence>

      <Chatbot libraryBooks={books.map(b => ({ title: b.title, author: b.author, genre: b.genre, description: b.description }))} />

      {/* Delete Book Confirmation Modal */}
      <AnimatePresence>
        {bookToDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 font-sans"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="bg-surface rounded-[32px] p-8 max-w-sm w-full shadow-[0px_10px_40px_rgba(0,0,0,0.1)] border border-border/50"
            >
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-5 border border-red-100">
              <Trash2 size={24} strokeWidth={1.5} />
            </div>
            <h3 className="text-2xl font-serif font-medium text-ink mb-3 tracking-tight">Remove Book</h3>
            <p className="text-muted mb-8 text-sm leading-relaxed">Are you sure you want to remove this book from your library? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setBookToDelete(null)}
                className="px-5 py-3 text-ink font-medium hover:bg-paper border border-border rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteBook}
                className="px-5 py-3 bg-red-500 text-white hover:bg-red-600 rounded-xl transition-colors font-medium text-sm shadow-sm"
              >
                Remove
              </button>
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Library Confirmation Modal */}
      <AnimatePresence>
        {libraryToDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 font-sans"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="bg-surface rounded-[32px] p-8 max-w-sm w-full shadow-[0px_10px_40px_rgba(0,0,0,0.1)] border border-border/50"
            >
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-5 border border-red-100">
              <Trash2 size={24} strokeWidth={1.5} />
            </div>
            <h3 className="text-2xl font-serif font-medium text-ink mb-3 tracking-tight">Delete Library</h3>
            <p className="text-muted mb-8 text-sm leading-relaxed">Are you sure you want to delete this entire library? This action cannot be undone and all books will be lost.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setLibraryToDelete(false)}
                className="px-5 py-3 text-ink font-medium hover:bg-paper border border-border rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteLibrary}
                className="px-5 py-3 bg-red-500 text-white hover:bg-red-600 rounded-xl transition-colors font-medium text-sm shadow-sm"
              >
                Delete Library
              </button>
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
        </div>
      </div>
    </AppLayout>
  );
}
