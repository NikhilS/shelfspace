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
import BookDetailsModal from '../components/BookDetailsModal';
import RecommendationsModal from '../components/RecommendationsModal';
import Chatbot from '../components/Chatbot';
import { BookDetails, searchBookByTitleAndAuthor } from '../services/bookApi';
import { toSentenceCase, toTitleCase } from '../lib/utils';
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

interface Book extends BookDetails {
  id: string;
  addedBy: string;
  addedAt: any;
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
  const [groupBy, setGroupBy] = useState<GroupOption>('none');
  const [aiGroups, setAiGroups] = useState<{category: string, books: Book[]}[]>([]);
  const [isGrouping, setIsGrouping] = useState(false);
  const [viewMode, setViewMode] = useState<'standard' | 'table'>('table');
  const [booksPerShelf, setBooksPerShelf] = useState(6);
  const mainRef = useRef<HTMLElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterGenre, setFilterGenre] = useState('');
  const [filterAuthor, setFilterAuthor] = useState('');
  const [filterYearMin, setFilterYearMin] = useState('');
  const [filterYearMax, setFilterYearMax] = useState('');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

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
    if (!mainRef.current || viewMode === 'table') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const isMobile = window.innerWidth < 640;
        
        // Book widths based on BookCard.tsx
        const bookWidth = isMobile ? 128 : 160;
        // gap-3 is 12px, sm:gap-5 is 20px
        const gap = isMobile ? 12 : 20;
        
        // Deductions from main container width (which is already minus its own px-4/px-6 due to contentRect):
        // Shelf container has border-x-4 (8px)/border-x-8 (16px) and p-4 (32px)/p-6 (48px)
        // Shelf row has px-2 (16px)/px-4 (32px)
        const containerDeductions = isMobile ? (8 + 32 + 16) : (16 + 48 + 32);
        
        // If there's a sidebar on desktop, width is reduced
        const availableWidth = width - containerDeductions;
        const count = Math.max(1, Math.floor((availableWidth + gap) / (bookWidth + gap)));
        setBooksPerShelf(count);
      }
    });
    observer.observe(mainRef.current);
    return () => observer.disconnect();
  }, [viewMode]);

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
      const getTime = (dateObj: any) => {
        if (!dateObj) return 0;
        if (typeof dateObj.toMillis === 'function') return dateObj.toMillis();
        const d = new Date(dateObj);
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
      const updates: any = {};
      
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
      const getTime = (dateObj: any) => {
        if (!dateObj) return 0;
        if (typeof dateObj.toMillis === 'function') return dateObj.toMillis();
        const d = new Date(dateObj);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      sorted.sort((a, b) => {
        const timeA = getTime(a.addedAt);
        const timeB = getTime(b.addedAt);
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      });
    }
    return sorted;
  }, [filteredBooks, sortBy, sortOrder]);

  const displayGroups = useMemo(() => {
    if (groupBy === 'none') {
      return [{ category: 'All Books', books: sortedBooks }];
    }
    
    if (groupBy === 'author') {
      const groups: Record<string, Book[]> = {};
      sortedBooks.forEach(book => {
        const author = book.author || 'Unknown Author';
        if (!groups[author]) groups[author] = [];
        groups[author].push(book);
      });
      return Object.entries(groups)
        .map(([category, bks]) => ({ category, books: bks }))
        .sort((a, b) => a.category.localeCompare(b.category));
    }
    
    if (groupBy === 'genre' || groupBy === 'series') {
      const groups: Record<string, Book[]> = {};
      sortedBooks.forEach(book => {
        const value = (groupBy === 'genre' ? book.genre : book.series) || `Unknown ${groupBy === 'genre' ? 'Genre' : 'Series'}`;
        if (!groups[value]) groups[value] = [];
        groups[value].push(book);
      });
      return Object.entries(groups)
        .map(([category, bks]) => ({ category, books: bks }))
        .sort((a, b) => a.category.localeCompare(b.category));
    }
    
    return aiGroups.map(group => {
      const groupFilteredBooks = group.books.filter(book => filteredBooks.some(fb => fb.id === book.id));
      const sortedGroupBooks = [...groupFilteredBooks];
      if (sortBy === 'title') {
        sortedGroupBooks.sort((a, b) => a.title.localeCompare(b.title));
      } else if (sortBy === 'author') {
        sortedGroupBooks.sort((a, b) => a.author.localeCompare(b.author));
      } else {
        const getTime = (dateObj: any) => {
          if (!dateObj) return 0;
          if (typeof dateObj.toMillis === 'function') return dateObj.toMillis();
          const d = new Date(dateObj);
          return isNaN(d.getTime()) ? 0 : d.getTime();
        };
        sortedGroupBooks.sort((a, b) => getTime(b.addedAt) - getTime(a.addedAt));
      }
      return { category: group.category, books: sortedGroupBooks };
    }).filter(group => group.books.length > 0);
  }, [groupBy, sortedBooks, aiGroups, sortBy, filteredBooks]);

  const bookIdsString = books.map(b => b.id).sort().join(',');

  useEffect(() => {
    if (groupBy !== 'lucky') return;
    if (books.length === 0) {
      setAiGroups([]);
      return;
    }

    const runAIGrouping = async () => {
      setIsGrouping(true);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `You are an expert librarian. Group the following books into categories based on: ${groupBy}.
        If mode is 'lucky', create fun, creative, highly specific, and quirky categories (e.g., 'Brooding Detectives', 'Space Operas with Snarky Robots').
        
        Books:
        ${JSON.stringify(books.map(b => ({ id: b.id, title: b.title, author: b.author })))}
        `;

        const response = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  categoryName: { type: Type.STRING },
                  bookIds: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["categoryName", "bookIds"]
              }
            }
          }
        });

        const result = JSON.parse(response.text || '[]');
        
        const newGroups: { category: string, books: Book[] }[] = [];
        const groupedIds = new Set<string>();

        result.forEach((group: any) => {
          const groupBooks = group.bookIds
            .map((id: string) => books.find(b => b.id === id))
            .filter(Boolean);
          
          if (groupBooks.length > 0) {
            newGroups.push({ category: group.categoryName, books: groupBooks });
            groupBooks.forEach((b: Book) => groupedIds.add(b.id));
          }
        });

        const missingBooks = books.filter(b => !groupedIds.has(b.id));
        if (missingBooks.length > 0) {
          newGroups.push({ category: 'Other', books: missingBooks });
        }

        setAiGroups(newGroups);
      } catch (error: any) {
        console.error("AI Grouping failed:", error);
        const errorMessage = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED') || error?.message?.includes('quota')
          ? "The AI is currently at capacity (quota limit). Please try grouping again later."
          : "Failed to categorize books with AI.";
        toast.error(errorMessage);
        setGroupBy('none');
      } finally {
        setIsGrouping(false);
      }
    };

    runAIGrouping();
  }, [groupBy, bookIdsString]);

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
        if (typeof book.addedAt.toMillis === 'function') {
          addedDateStr = new Date(book.addedAt.toMillis()).toLocaleString();
        } else {
          addedDateStr = new Date(book.addedAt).toLocaleString();
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
          } catch (err: any) {
             currentErrors.push({ title: book.title, error: err.message || "Failed to fetch ISBN" });
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
             
             await Promise.all(enrichments.map(async (enriched) => {
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
           } catch (err: any) {
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
        <div className="bg-surface/60 backdrop-blur-sm rounded-3xl shadow-sm border border-border/40 overflow-hidden font-sans">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-black/5 border-b border-border/40 text-muted text-xs uppercase tracking-wider">
                  <th className="px-6 py-4 font-bold cursor-pointer hover:bg-black/5 transition-colors" onClick={() => handleSort('title')}>
                    <div className="flex items-center gap-2">Title <SortIcon column="title" /></div>
                  </th>
                  <th className="px-6 py-4 font-bold cursor-pointer hover:bg-black/5 transition-colors" onClick={() => handleSort('author')}>
                    <div className="flex items-center gap-2">Author <SortIcon column="author" /></div>
                  </th>
                  <th className="px-6 py-4 font-bold cursor-pointer hover:bg-black/5 transition-colors" onClick={() => handleSort('added')}>
                    <div className="flex items-center gap-2">Added <SortIcon column="added" /></div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                <AnimatePresence>
                  {shelfBooksList.map((book, idx) => {
                    const hash = book.title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                    const gradients = [
                      'from-teal-100 to-emerald-200',
                      'from-yellow-100 to-amber-200',
                      'from-rose-100 to-pink-200',
                      'from-indigo-100 to-blue-200',
                      'from-purple-100 to-fuchsia-200',
                      'from-orange-100 to-red-200',
                      'from-cyan-100 to-sky-200',
                      'from-lime-100 to-green-200'
                    ];
                    const gradientClass = gradients[hash % gradients.length];

                    return (
                      <motion.tr 
                        key={book.id} 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.2, delay: idx * 0.02 }}
                        onClick={() => setSelectedBook(book)}
                        className="hover:bg-paper/80 transition-colors cursor-pointer group"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-16 rounded-md shadow-sm overflow-hidden flex-shrink-0 ${!book.coverUrl ? `bg-gradient-to-br ${gradientClass}` : 'bg-surface'}`}>
                              {book.coverUrl ? (
                                <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <span className="text-[8px] font-serif font-bold text-ink/70 px-1 text-center line-clamp-3 leading-tight">{toTitleCase(book.title)}</span>
                                </div>
                              )}
                            </div>
                            <div className="font-serif font-medium text-ink text-sm sm:text-base line-clamp-2 max-w-sm tracking-tight">{toTitleCase(book.title)}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-muted font-medium text-sm">{toTitleCase(book.author)}</td>
                        <td className="px-6 py-4 text-muted text-xs font-medium">
                          {book.addedAt 
                            ? (typeof book.addedAt.toMillis === 'function' 
                                ? new Date(book.addedAt.toMillis()).toLocaleDateString() 
                                : new Date(book.addedAt).toLocaleDateString())
                            : 'Unknown'}
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
                {shelfBooksList.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-muted italic text-sm">
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

    const shelves = [];
    for (let i = 0; i < Math.max(shelfBooksList.length, 1); i += booksPerShelf) {
      shelves.push(shelfBooksList.slice(i, i + booksPerShelf));
    }
    while (shelves.length < (groupBy === 'none' ? 3 : 1)) {
      shelves.push([]);
    }

    return (
      <div className="bg-surface/50 border border-border/40 p-4 sm:p-8 rounded-3xl backdrop-blur-sm relative overflow-hidden">
        {shelves.map((shelfBooks, shelfIdx) => (
          <div key={shelfIdx} className="mb-14 last:mb-2 relative">
            <div className="flex items-end gap-4 sm:gap-6 px-2 sm:px-6 pt-4 h-64 sm:h-72 z-10 relative">
              <AnimatePresence>
                {shelfBooks.map((book, idx) => (
                  <motion.div
                    key={book.id}
                    initial={{ opacity: 0, y: 15, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.35, delay: idx * 0.05, ease: [0.25, 0.1, 0.25, 1.0] }}
                  >
                    <BookCard book={book} onDelete={handleDeleteBook} onClick={() => setSelectedBook(book)} canEdit={canEdit} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {shelfBooks.length === 0 && (
                <div className="w-full h-full flex flex-col items-center justify-center opacity-40 font-sans text-sm pb-8 text-ink/70">
                  <div className="w-12 h-12 mb-3 border-2 border-dashed border-ink/40 rounded-full flex items-center justify-center">
                    <BookIcon size={20} className="text-ink/60" />
                  </div>
                  {emptyMessage}
                </div>
              )}
            </div>
            {/* Minimalist shelf line */}
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-border to-transparent z-0 rounded-full opacity-70" />
            <div className="absolute bottom-[-14px] left-8 right-8 h-8 bg-black/5 blur-md -z-10 rounded-full" />
          </div>
        ))}
      </div>
    );
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="min-h-screen bg-paper font-sans text-ink"
    >
      {library.heroImageUrl && (
        <div className="w-full h-48 sm:h-64 relative overflow-hidden">
          <img src={library.heroImageUrl} alt={library.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/30 to-transparent" />
          <div className="absolute bottom-6 left-6 sm:left-10 text-white">
            <h1 className="text-3xl sm:text-5xl font-serif font-medium tracking-tight drop-shadow-lg mb-2 leading-tight">{toTitleCase(library.name)}</h1>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              <p className="text-xs sm:text-sm font-sans font-medium uppercase tracking-wider text-white/90">
                {books.length} {books.length === 1 ? 'book' : 'books'} • {isOwner ? 'Owned by you' : `Shared by ${toTitleCase(library.ownerName)}`}
              </p>
            </div>
          </div>
        </div>
      )}
      
      <div className="sticky top-0 z-40 flex flex-col shadow-sm border-b border-border/40">
        <header className="bg-surface/90 backdrop-blur-xl px-4 sm:px-8 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-0 transition-all">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <div className="flex items-center gap-4 sm:gap-6">
              <Link to="/" className="p-2 text-muted hover:text-ink bg-surface border border-border/40 shadow-sm hover:shadow hover:bg-paper hover:border-border/60 rounded-full transition-all flex-shrink-0 group">
                <ArrowLeft size={18} strokeWidth={2} className="group-hover:-translate-x-0.5 transition-transform" />
              </Link>
              <div className="min-w-0 flex flex-col">
                <h1 className="text-2xl sm:text-3xl font-serif font-bold truncate tracking-tight text-ink">{toTitleCase(library.name)}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] sm:text-xs font-sans text-muted font-bold uppercase tracking-wider bg-black/5 px-2 py-0.5 rounded-full">
                    {books.length} {books.length === 1 ? 'book' : 'books'}
                  </span>
                  <span className="text-[10px] sm:text-xs font-sans text-muted font-medium tracking-wide">
                    {isOwner ? 'Owned by you' : `Shared by ${toTitleCase(library.ownerName)}`}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 overflow-x-auto hide-scrollbar pb-1 sm:pb-0 w-full sm:w-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="flex items-center bg-black/5 rounded-full p-1 border border-border/40 flex-shrink-0">
              <button
                onClick={() => setViewMode('standard')}
                className={`p-1.5 sm:px-3 sm:py-1.5 rounded-full transition-all flex items-center gap-2 text-sm font-medium ${viewMode === 'standard' ? 'bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-ink' : 'text-muted hover:text-ink'}`}
                title="Standard View"
              >
                <LayoutGrid size={16} strokeWidth={2} />
                <span className="hidden lg:inline">Grid</span>
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 sm:px-3 sm:py-1.5 rounded-full transition-all flex items-center gap-2 text-sm font-medium ${viewMode === 'table' ? 'bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-ink' : 'text-muted hover:text-ink'}`}
                title="Table View"
              >
                <TableIcon size={16} strokeWidth={2} />
                <span className="hidden lg:inline">Table</span>
              </button>
            </div>
            
            <div className="w-[1px] h-6 bg-border/60 hidden sm:block mx-1"></div>

            <button
              onClick={() => setIsRecommendationsModalOpen(true)}
              className="flex items-center gap-2 bg-gradient-to-br from-paper to-surface text-accent px-4 py-2 rounded-full hover:shadow-md transition-all font-sans text-xs sm:text-sm border border-accent/20 flex-shrink-0 font-bold shadow-sm group"
            >
              <Sparkles size={16} strokeWidth={2.5} className="group-hover:scale-110 transition-transform" />
              <span className="hidden sm:inline">AI Picks</span>
            </button>
            
            {canEdit && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-2 bg-ink text-surface px-4 sm:px-5 py-2 rounded-full hover:bg-ink/90 hover:shadow-md hover:-translate-y-0.5 transition-all font-sans text-xs sm:text-sm flex-shrink-0 font-medium"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span className="hidden sm:inline">Add Book</span>
              </button>
            )}
            
            {canEdit && (
              <button
                onClick={() => setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen)}
                className={`flex items-center gap-2 px-3 py-2 rounded-full transition-all border ${isAdvancedSettingsOpen ? 'bg-surface text-ink border-border/80 shadow-sm' : 'bg-transparent text-muted hover:bg-surface border-transparent hover:border-border/50'} flex-shrink-0 font-sans text-xs sm:text-sm font-medium`}
              >
                <Settings size={16} strokeWidth={2} />
                <span className="hidden xl:inline">Advanced</span>
              </button>
            )}
            
            {isOwner && (
              <button
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`flex items-center gap-2 px-3 py-2 rounded-full transition-all border ${isSettingsOpen ? 'bg-surface text-ink border-border/80 shadow-sm' : 'bg-transparent text-muted hover:bg-surface border-transparent hover:border-border/50'} flex-shrink-0 font-sans text-xs sm:text-sm font-medium`}
              >
                <Share2 size={16} strokeWidth={2} />
                <span className="hidden xl:inline">Share</span>
              </button>
            )}
            
            <div className="hidden sm:flex items-center gap-3 ml-2 pl-4 border-l border-border/60">
              <div className="flex items-center gap-2 group cursor-pointer relative">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full object-cover border border-border/50 group-hover:border-ink transition-colors" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-border text-ink flex items-center justify-center font-sans text-xs font-bold group-hover:bg-ink group-hover:text-surface transition-colors">
                    {user?.email?.[0].toUpperCase() || 'U'}
                  </div>
                )}
              </div>
              <button onClick={logOut} className="p-2 text-muted hover:text-ink transition-colors rounded-full hover:bg-surface border border-transparent hover:border-border/50" title="Log out">
                <LogOut size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        </header>

        {/* Toolbar */}
        <div className="bg-surface/60 border-t border-border/30 flex flex-col backdrop-blur-md">
          <div className="px-4 sm:px-8 py-2.5 sm:py-3 flex flex-wrap gap-4 sm:gap-6 items-center justify-between">
            <div className="flex flex-wrap items-center gap-4 sm:gap-6 w-full sm:w-auto">
              <div className="flex items-center gap-2.5 bg-paper/50 px-3 py-1.5 rounded-full border border-border/40">
                <label className="text-[10px] sm:text-xs font-sans font-bold text-muted uppercase tracking-wider">Sort by:</label>
                <select 
                  value={sortBy} 
                  onChange={e => handleSort(e.target.value as SortOption)}
                  className="bg-transparent border-none text-ink font-sans text-sm font-medium focus:outline-none cursor-pointer max-w-[110px] appearance-none hover:text-accent transition-colors"
                >
                  <option value="added">Recently Added</option>
                  <option value="title">Title (A-Z)</option>
                  <option value="author">Author (A-Z)</option>
                </select>
                {sortBy !== 'added' && (
                  <button 
                    onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                    className="p-1 hover:text-accent transition-colors rounded-full hover:bg-black/5"
                  >
                    {sortOrder === 'asc' ? <ArrowUp size={14} strokeWidth={2} /> : <ArrowDown size={14} strokeWidth={2} />}
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-2.5 bg-paper/50 px-3 py-1.5 rounded-full border border-border/40">
                <label className="text-[10px] sm:text-xs font-sans font-bold text-muted uppercase tracking-wider">Group by:</label>
                <select 
                  value={groupBy} 
                  onChange={e => setGroupBy(e.target.value as GroupOption)}
                  className="bg-transparent border-none text-ink font-sans text-sm font-medium focus:outline-none cursor-pointer max-w-[110px] appearance-none hover:text-accent transition-colors"
                >
                  <option value="none">None</option>
                  <option value="author">Author</option>
                  <option value="genre">Genre</option>
                  <option value="series">Series</option>
                  <option value="lucky">Magic (AI)</option>
                </select>
              </div>
              
              <button
                onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all shadow-sm border ${isFiltersOpen || searchQuery || filterGenre || filterAuthor || filterYearMin || filterYearMax ? 'bg-accent text-surface border-accent' : 'bg-surface text-ink border-border/60 hover:border-border hover:shadow'}`}
              >
                <Filter size={14} strokeWidth={2} />
                Filters {(searchQuery || filterGenre || filterAuthor || filterYearMin || filterYearMax) && <span className="w-1.5 h-1.5 rounded-full bg-surface"></span>}
              </button>
            </div>
            {isGrouping && (
              <div className="text-xs font-sans text-accent flex items-center gap-2 animate-pulse font-bold bg-accent/10 px-3 py-1.5 rounded-full">
                <Sparkles size={14} strokeWidth={2.5} /> Categorizing...
              </div>
            )}
          </div>
          
          {/* Filters Bar */}
          {isFiltersOpen && (
            <div className="px-4 sm:px-8 py-4 bg-surface border-t border-border/40 flex flex-wrap gap-4 items-center animate-in slide-in-from-top-2 fade-in duration-200">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" strokeWidth={2} />
                <input
                  type="text"
                  placeholder="Search title or author..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-paper/50 border border-border/60 rounded-full text-sm focus:outline-none focus:border-ink/50 focus:bg-surface transition-all font-sans placeholder-muted"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
                    <X size={14} strokeWidth={2} />
                  </button>
                )}
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={filterGenre}
                  onChange={(e) => setFilterGenre(e.target.value)}
                  className="px-4 py-2 bg-paper/50 border border-border/60 rounded-full text-sm focus:outline-none focus:border-ink/50 font-sans text-ink appearance-none min-w-[120px]"
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
      </div>

      <main ref={mainRef} className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col lg:flex-row gap-6 sm:gap-8">
        <div className="flex-1 min-w-0">
          {displayGroups.length === 0 ? (
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
            displayGroups.map((group, idx) => (
              <div key={idx} className="mb-10 sm:mb-12 last:mb-0">
                {groupBy !== 'none' && (
                  <div className="flex items-center gap-4 mb-6 sm:mb-8 ml-2">
                    <h2 className="text-2xl sm:text-4xl font-serif font-medium text-ink tracking-tight">
                      {toTitleCase(group.category)} 
                    </h2>
                    <span className="text-xs sm:text-sm font-sans text-muted font-bold bg-surface px-3 py-1 rounded-full border border-border/80 shadow-sm">
                      {group.books.length} {group.books.length === 1 ? 'book' : 'books'}
                    </span>
                    <div className="flex-1 h-[1px] bg-gradient-to-r from-border/80 to-transparent ml-2" />
                  </div>
                )}
                {renderShelves(group.books)}
              </div>
            ))
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
      
      <BookDetailsModal
        book={selectedBook}
        libraryId={id || ''}
        isOpen={!!selectedBook}
        onClose={() => setSelectedBook(null)}
        canEdit={canEdit}
        onUpdate={handleUpdateBook}
        onDelete={handleDeleteBook}
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
    </motion.div>
  );
}
