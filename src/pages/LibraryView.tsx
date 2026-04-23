import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, collection, query, onSnapshot, addDoc, deleteDoc, serverTimestamp, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { ArrowLeft, Plus, Share2, Settings, Trash2, X, Sparkles, LayoutGrid, List, Table as TableIcon, ArrowUpDown, ArrowUp, ArrowDown, LogOut, Search, Filter, Download, Book as BookIcon, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { GoogleGenAI, Type } from '@google/genai';
import { enrichBooksMetadata } from '../services/gemini';
import AddBookModal from '../components/AddBookModal';
import BookCard from '../components/BookCard';
import RecommendationsModal from '../components/RecommendationsModal';
import Chatbot from '../components/Chatbot';
import { BookDetails, searchBookByTitleAndAuthor } from '../services/bookApi';
import { toSentenceCase, toTitleCase } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

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
}

type SortOption = 'added' | 'title' | 'author';
type GroupOption = 'none' | 'author' | 'genre' | 'series' | 'lucky';

export default function LibraryView() {
  const { id } = useParams<{ id: string }>();
  const { user, logOut } = useAuth();
  const navigate = useNavigate();
  
  const [library, setLibrary] = useState<Library | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRecommendationsModalOpen, setIsRecommendationsModalOpen] = useState(false);
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
  const [viewMode, setViewMode] = useState<'standard' | 'table'>('table');
  const mainRef = useRef<HTMLElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterGenre, setFilterGenre] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  const [filterYearMin, setFilterYearMin] = useState('');
  const [filterYearMax, setFilterYearMax] = useState('');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (libraryToDelete) setLibraryToDelete(null);
        else if (bookToDelete) setBookToDelete(null);
        else if (isSettingsOpen) setIsSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [libraryToDelete, bookToDelete, isSettingsOpen]);

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
        updateDoc(doc(db, 'libraries', id, 'books', b.id), updates)
          .catch(err => console.error("Error backfilling book data", err));
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
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
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
  }, [books, searchQuery, filterGenre, filterAuthor, filterYearMin, filterYearMax]);

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

  const handleAddBook = async (bookDetails: BookDetails) => {
    if (!id || !user || !canEdit) return;
    try {
      let enrichedDetails = { ...bookDetails };
      
      // Attempt to quickly enrich genre/series if missing
      if (!enrichedDetails.genre || !enrichedDetails.series) {
        try {
          const enrichments = await enrichBooksMetadata([{
            id: 'temp', 
            title: enrichedDetails.title, 
            author: enrichedDetails.author,
            description: enrichedDetails.description,
            currentGenre: enrichedDetails.genre
          }]);
          if (enrichments.length > 0) {
            enrichedDetails.genre = enrichedDetails.genre || enrichments[0].genre;
            enrichedDetails.series = enrichedDetails.series || enrichments[0].series;
          }
        } catch (e) {
          console.warn("Failed to enrich metadata on add", e);
        }
      }

      await addDoc(collection(db, 'libraries', id, 'books'), {
        ...enrichedDetails,
        addedBy: user.uid,
        addedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `libraries/${id}/books`);
    }
  };

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
      await updateDoc(doc(db, 'libraries', id, 'books', bookId), updatedData);
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
              await updateDoc(doc(db, 'libraries', id, 'books', book.id), changes);
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
                   await updateDoc(doc(db, 'libraries', id, 'books', book.id), changes);
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
    return <div className="min-h-screen flex items-center justify-center bg-paper text-ink">Loading library...</div>;
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
                    <div className="flex items-center gap-2">Title <SortIcon column="title" /></div>
                  </th>
                  <th className="py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase w-1/4 cursor-pointer hover:bg-surface-variant/30 transition-colors" onClick={() => handleSort('author')}>
                    <div className="flex items-center gap-2">Author <SortIcon column="author" /></div>
                  </th>
                  <th className="py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase text-right cursor-pointer hover:bg-surface-variant/30 transition-colors" onClick={() => handleSort('added')}>
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
                        transition={{ duration: 0.2, delay: idx * 0.02 }}
                        onClick={() => navigate(`/library/${id}/book/${book.id}`)}
                        className="group hover:bg-surface-container-low/50 transition-colors cursor-pointer"
                      >
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-4">
                            <div className="h-12 w-8 bg-surface-variant rounded-sm shadow-sm flex-shrink-0 overflow-hidden relative border border-outline-variant/30">
                              {book.coverUrl ? (
                                <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                              ) : (
                                <div className={`absolute inset-0 bg-gradient-to-br ${gradientClass} opacity-80`}></div>
                              )}
                            </div>
                            <span className="font-headline-md text-[18px] sm:text-[20px] text-on-surface line-clamp-2 max-w-lg leading-snug">{toTitleCase(book.title)}</span>
                          </div>
                        </td>
                        <td className="py-4 px-6 font-body-md text-body-md text-on-surface-variant">{toTitleCase(book.author)}</td>
                        <td className="py-4 px-6 text-right font-body-md text-outline whitespace-nowrap">
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
              transition={{ duration: 0.35, delay: idx * 0.05, ease: [0.25, 0.1, 0.25, 1.0] }}
            >
              <BookCard book={book} onDelete={handleDeleteBook} onClick={() => navigate(`/library/${id}/book/${book.id}`)} canEdit={canEdit} />
            </motion.div>
          ))}
        </AnimatePresence>
        {shelfBooksList.length === 0 && (
          <div className="col-span-full w-full py-12 flex flex-col items-center justify-center opacity-40 font-sans text-sm pb-8 text-ink/70">
            <div className="w-12 h-12 mb-3 border-2 border-dashed border-ink/40 rounded-full flex items-center justify-center">
              <BookIcon size={20} className="text-ink/60" />
            </div>
            {emptyMessage}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-background text-on-background font-body-md text-body-md antialiased flex min-h-screen relative w-full overflow-x-hidden">
      
      {/* Mobile Nav Overlay */}
      {isMobileNavOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      {/* SideNavBar Component */}
      <nav className={`fixed left-0 top-0 flex flex-col h-screen w-64 py-8 border-r border-outline-variant/30 bg-surface shadow-md md:shadow-none z-50 transition-transform duration-300 ease-in-out md:translate-x-0 ${isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-6 mb-8 flex flex-col gap-1">
          <Link to="/" className="text-2xl font-serif font-bold text-primary font-headline-md text-headline-md tracking-tight">Athenaeum</Link>
          <span className="text-on-surface-variant font-body-md text-body-md opacity-80">Modern Archivist</span>
        </div>
        
        <div className="flex-grow flex flex-col gap-2">
          <Link 
            to="/"
            onClick={() => setIsMobileNavOpen(false)}
            className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 font-serif text-lg tracking-tight"
          >
            <span className="material-symbols-outlined text-primary">arrow_back</span>
            <span>Back to Libraries</span>
          </Link>

          {canEdit && (
            <button 
              onClick={() => {
                setIsAddModalOpen(true);
                setIsMobileNavOpen(false);
              }}
              className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight"
            >
              <span className="material-symbols-outlined text-primary">add</span>
              <span>Add Book</span>
            </button>
          )}

          {canEdit && (
            <button 
              onClick={() => {
                setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen);
                setIsMobileNavOpen(false);
              }}
              className={`flex items-center gap-3 pl-6 py-3 transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight ${isAdvancedSettingsOpen ? 'bg-surface-container text-primary border-r-2 border-primary' : 'text-on-surface hover:text-primary hover:bg-surface-container'}`}
            >
              <span className="material-symbols-outlined text-primary">settings</span>
              <span>Settings</span>
            </button>
          )}

          {isOwner && (
            <button 
              onClick={() => {
                setIsSettingsOpen(!isSettingsOpen);
                setIsMobileNavOpen(false);
              }}
              className={`flex items-center gap-3 pl-6 py-3 transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight ${isSettingsOpen ? 'bg-surface-container text-primary border-r-2 border-primary' : 'text-on-surface hover:text-primary hover:bg-surface-container'}`}
            >
              <span className="material-symbols-outlined text-primary">share</span>
              <span>Share</span>
            </button>
          )}
        </div>
        
        <div className="mt-auto">
          <button 
            onClick={logOut}
            className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight"
          >
            <span className="material-symbols-outlined text-primary">logout</span>
            <span>Logout</span>
          </button>
        </div>
      </nav>

      {/* Main Content Wrapper */}
      <div className="flex-grow flex flex-col md:ml-64 min-h-screen w-full lg:w-[calc(100%-16rem)]">
        
        {/* TopAppBar Component */}
        <header className="flex justify-between items-center w-full px-4 sm:px-8 h-16 border-b border-outline-variant/30 bg-surface/80 backdrop-blur-md shadow-[0_4px_20px_rgba(26,47,75,0.02)] z-10 sticky top-0">
          <div className="flex-1 flex items-center max-w-2xl gap-3">
            <button 
              className="md:hidden p-2 -ml-2 text-on-surface hover:text-primary rounded-full hover:bg-surface-container transition-colors flex items-center justify-center"
              onClick={() => setIsMobileNavOpen(true)}
            >
              <span className="material-symbols-outlined">menu</span>
            </button>
            <div className="relative w-full max-w-md hidden sm:block">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
              <input 
                className="w-full pl-10 pr-4 py-2 bg-surface-container-low border border-outline-variant/50 rounded-DEFAULT font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:ring-inset hover:border-primary/50 transition-colors" 
                placeholder="Search collection..." 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          
          <div className="flex-none ml-4 group cursor-pointer relative">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-10 h-10 rounded-full object-cover border border-outline-variant/50 group-hover:border-primary transition-colors" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-surface-container border border-outline-variant/50 flex items-center justify-center text-primary font-bold shadow-sm group-hover:border-primary transition-colors">
                {user?.email?.[0].toUpperCase() || 'U'}
              </div>
            )}
          </div>
        </header>

        <div className={`w-full h-48 sm:h-64 relative overflow-hidden ${!library.heroImageUrl ? 'bg-primary' : ''}`}>

          {library.heroImageUrl && (
            <img src={library.heroImageUrl} alt={library.name} className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-6 left-6 sm:left-10 text-white">
            <h1 className="text-3xl sm:text-5xl font-serif font-medium tracking-tight drop-shadow-lg mb-2 leading-tight">{toTitleCase(library.name)}</h1>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
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
            <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-md border border-outline-variant/40">
              <label className="text-xs font-label-caps text-outline uppercase tracking-wider hidden sm:block">Sort by:</label>
              <select 
                value={sortBy} 
                onChange={e => handleSort(e.target.value as SortOption)}
                className="bg-transparent border-none text-on-surface font-body-md text-sm focus:outline-none cursor-pointer max-w-[110px] appearance-none hover:text-primary transition-colors"
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
                  <span className="material-symbols-outlined text-sm">{sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
                </button>
              )}
            </div>
            
            <button
              onClick={() => setIsFiltersOpen(!isFiltersOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-body-md transition-all border ${isFiltersOpen || searchQuery || filterGenre || filterAuthor || filterYearMin || filterYearMax ? 'bg-primary text-on-primary border-primary shadow-sm' : 'bg-surface text-on-surface border-outline-variant/60 hover:border-outline-variant hover:shadow-sm'}`}
            >
              <span className="material-symbols-outlined text-sm">filter_list</span>
              <span className="hidden sm:inline">Filters</span>
              {(searchQuery || filterGenre || filterAuthor || filterYearMin || filterYearMax) && <span className="w-1.5 h-1.5 rounded-full bg-surface"></span>}
            </button>
          </div>

          {/* View Modes and AI Picks */}
          <div className="flex items-center gap-3 w-full lg:w-auto lg:ml-auto">
            <div className="flex items-center bg-surface-container-lowest rounded-md p-1 border border-outline-variant/40 flex-shrink-0">
              <button
                onClick={() => setViewMode('standard')}
                className={`p-1.5 sm:px-3 sm:py-1.5 rounded-md transition-all flex items-center gap-2 text-sm font-body-md ${viewMode === 'standard' ? 'bg-surface shadow-sm text-primary' : 'text-on-surface hover:text-primary'}`}
                title="Grid View"
              >
                <span className="material-symbols-outlined text-sm">grid_view</span>
                <span className="hidden sm:inline">Grid</span>
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 sm:px-3 sm:py-1.5 rounded-md transition-all flex items-center gap-2 text-sm font-body-md ${viewMode === 'table' ? 'bg-surface shadow-sm text-primary' : 'text-on-surface hover:text-primary'}`}
                title="Table View"
              >
                <span className="material-symbols-outlined text-sm">table_rows</span>
                <span className="hidden sm:inline">Table</span>
              </button>
            </div>
            
            <div className="w-[1px] h-6 bg-outline-variant/50 hidden sm:block mx-1"></div>

            <button
              onClick={() => setIsRecommendationsModalOpen(true)}
              className="flex items-center gap-2 bg-surface text-primary px-3 sm:px-4 py-1.5 sm:py-2 rounded-md hover:bg-surface-container architectural-shadow transition-all font-body-md text-sm border border-outline-variant/50 flex-shrink-0 group ml-auto lg:ml-0"
            >
              <span className="material-symbols-outlined text-sm group-hover:scale-110 transition-transform">auto_awesome</span>
              <span>AI Picks</span>
            </button>
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
            <div className="text-center py-32 bg-surface/40 backdrop-blur-sm rounded-3xl shadow-sm border border-border/40 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-accent/5 to-transparent pointer-events-none" />
              <div className="w-24 h-24 bg-paper/80 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner border border-border/30 relative z-10">
                <BookIcon size={36} className="text-accent/80" strokeWidth={1.5} />
              </div>
              <h3 className="text-3xl font-serif font-bold mb-3 text-ink relative z-10 tracking-tight">No books found</h3>
              <p className="text-muted text-lg max-w-md mx-auto relative z-10">
                {books.length === 0 ? "This library is empty. Let's add some great reads to your collection." : "No books match your current filters."}
              </p>
              {books.length === 0 && canEdit && (
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="mt-8 inline-flex items-center gap-2 bg-accent text-white px-6 py-3 rounded-full hover:bg-accent/90 hover:shadow-lg hover:shadow-accent/30 hover:-translate-y-0.5 transition-all font-sans text-sm font-bold relative z-10"
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

        {/* Settings Modal */}
        <AnimatePresence>
          {isSettingsOpen && isOwner && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sans" 
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
                  <button type="submit" className="bg-accent text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-opacity-90 transition-all shadow-sm">
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
              className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sans" 
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
      </main>

      <AddBookModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddBook={handleAddBook}
        existingBooks={books}
      />
      
      <RecommendationsModal
        isOpen={isRecommendationsModalOpen}
        onClose={() => setIsRecommendationsModalOpen(false)}
        libraryBooks={books.map(b => ({ title: b.title, author: b.author }))}
      />

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
  );
}
