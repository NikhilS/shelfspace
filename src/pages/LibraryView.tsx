import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, collection, query, onSnapshot, addDoc, deleteDoc, serverTimestamp, getDoc, updateDoc } from 'firebase/firestore';
import { ArrowLeft, Plus, Share2, Settings, Trash2, X, Sparkles, LayoutGrid, List, Table as TableIcon, ArrowUpDown, ArrowUp, ArrowDown, LogOut, Search, Filter, Download } from 'lucide-react';
import { toast } from 'sonner';
import { GoogleGenAI, Type } from '@google/genai';
import AddBookModal from '../components/AddBookModal';
import BookCard from '../components/BookCard';
import BookDetailsModal from '../components/BookDetailsModal';
import RecommendationsModal from '../components/RecommendationsModal';
import Chatbot from '../components/Chatbot';
import { BookDetails } from '../services/bookApi';
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
  const [shareEmail, setShareEmail] = useState('');
  const [bookToDelete, setBookToDelete] = useState<string | null>(null);
  const [libraryToDelete, setLibraryToDelete] = useState<boolean>(false);

  const [sortBy, setSortBy] = useState<SortOption>('added');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [groupBy, setGroupBy] = useState<GroupOption>('none');
  const [aiGroups, setAiGroups] = useState<{category: string, books: Book[]}[]>([]);
  const [isGrouping, setIsGrouping] = useState(false);
  const [viewMode, setViewMode] = useState<'standard' | 'compact' | 'table'>('standard');
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
        const bookWidth = viewMode === 'compact' ? (isMobile ? 80 : 96) : (isMobile ? 128 : 160);
        const gap = isMobile ? 12 : 16;
        
        // Deductions from main container width:
        // Main has px-6 (48px) - but contentRect already excludes this if we observe main
        // Shelf container has border-x-4 (8px) and p-4 (32px) on mobile
        // Shelf row has px-2 (16px) on mobile
        const containerDeductions = isMobile ? (8 + 32 + 16) : (16 + 64 + 32);
        
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
      // Sort by addedAt descending
      bks.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
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
        const timeA = a.addedAt?.toMillis() || 0;
        const timeB = b.addedAt?.toMillis() || 0;
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
    
    return aiGroups.map(group => {
      const groupFilteredBooks = group.books.filter(book => filteredBooks.some(fb => fb.id === book.id));
      const sortedGroupBooks = [...groupFilteredBooks];
      if (sortBy === 'title') {
        sortedGroupBooks.sort((a, b) => a.title.localeCompare(b.title));
      } else if (sortBy === 'author') {
        sortedGroupBooks.sort((a, b) => a.author.localeCompare(b.author));
      } else {
        sortedGroupBooks.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
      }
      return { category: group.category, books: sortedGroupBooks };
    }).filter(group => group.books.length > 0);
  }, [groupBy, sortedBooks, aiGroups, sortBy, filteredBooks]);

  const bookIdsString = books.map(b => b.id).sort().join(',');

  useEffect(() => {
    if (groupBy === 'none' || groupBy === 'author') return;
    if (books.length === 0) {
      setAiGroups([]);
      return;
    }

    const runAIGrouping = async () => {
      setIsGrouping(true);
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const prompt = `You are an expert librarian. Group the following books into categories based on: ${groupBy}.
        If mode is 'genre', group by literary genre.
        If mode is 'series', group by book series (use 'Standalone' for books not in a series).
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
      } catch (error) {
        console.error("AI Grouping failed:", error);
        toast.error("Failed to categorize books with AI.");
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
      await addDoc(collection(db, 'libraries', id, 'books'), {
        ...bookDetails,
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

  const handleUpdateBook = async (bookId: string, updatedData: Partial<BookDetails>) => {
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
      const addedDate = book.addedAt ? new Date(book.addedAt.toMillis()).toLocaleDateString() : '';
      return [
        escapeCSV(book.title),
        escapeCSV(book.author),
        escapeCSV(book.isbn),
        escapeCSV(book.genre),
        escapeCSV(book.publishedDate),
        escapeCSV(addedDate)
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
        <div className="bg-surface rounded-2xl shadow-sm border border-border/60 overflow-hidden font-sans">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-paper border-b border-border/60 text-muted text-xs uppercase tracking-wider">
                  <th className="px-5 py-3 font-bold cursor-pointer hover:bg-black/5 transition-colors" onClick={() => handleSort('title')}>
                    <div className="flex items-center gap-2">Title <SortIcon column="title" /></div>
                  </th>
                  <th className="px-5 py-3 font-bold cursor-pointer hover:bg-black/5 transition-colors" onClick={() => handleSort('author')}>
                    <div className="flex items-center gap-2">Author <SortIcon column="author" /></div>
                  </th>
                  <th className="px-5 py-3 font-bold cursor-pointer hover:bg-black/5 transition-colors" onClick={() => handleSort('added')}>
                    <div className="flex items-center gap-2">Added <SortIcon column="added" /></div>
                  </th>
                  {canEdit && <th className="px-5 py-3 font-bold text-right">Actions</th>}
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
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-14 rounded-md shadow-sm overflow-hidden flex-shrink-0 ${!book.coverUrl ? `bg-gradient-to-br ${gradientClass}` : 'bg-surface'}`}>
                              {book.coverUrl ? (
                                <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <span className="text-[8px] font-serif font-bold text-ink/50 px-1 text-center line-clamp-3 leading-tight">{toTitleCase(book.title)}</span>
                                </div>
                              )}
                            </div>
                            <div className="font-serif font-bold text-ink text-sm sm:text-base line-clamp-2">{toTitleCase(book.title)}</div>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-muted font-medium text-sm">{toTitleCase(book.author)}</td>
                        <td className="px-5 py-3 text-muted text-xs font-medium">
                          {book.addedAt ? new Date(book.addedAt.toMillis()).toLocaleDateString() : 'Unknown'}
                        </td>
                        {canEdit && (
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteBook(book.id);
                              }}
                              className="text-red-400 hover:text-red-600 p-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-full hover:bg-red-50"
                            >
                              <Trash2 size={16} strokeWidth={2} />
                            </button>
                          </td>
                        )}
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
                {shelfBooksList.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 4 : 3} className="px-5 py-8 text-center text-muted italic text-sm">
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
      <div className="bg-paper p-4 sm:p-6 rounded-t-[32px] shadow-inner border-x-4 sm:border-x-8 border-t-4 sm:border-t-8 border-accent relative overflow-hidden">
        {shelves.map((shelfBooks, shelfIdx) => (
          <div key={shelfIdx} className="mb-10 relative">
            <div className={`flex items-end gap-3 sm:gap-5 px-2 sm:px-4 pt-6 ${viewMode === 'compact' ? 'h-32 sm:h-40' : 'h-60 sm:h-64'} z-10 relative`}>
              <AnimatePresence>
                {shelfBooks.map((book, idx) => (
                  <motion.div
                    key={book.id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.3, delay: idx * 0.05, ease: 'easeOut' }}
                  >
                    <BookCard book={book} onDelete={handleDeleteBook} onClick={() => setSelectedBook(book)} canEdit={canEdit} compact={viewMode === 'compact'} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {shelfBooks.length === 0 && (
                <div className="w-full h-full flex items-center justify-center opacity-40 font-sans text-sm pb-6 text-accent">
                  {emptyMessage}
                </div>
              )}
            </div>
            <div className="absolute bottom-0 left-[-20px] sm:left-[-32px] right-[-20px] sm:right-[-32px] h-6 bg-accent shadow-[0_6px_10px_rgba(0,0,0,0.2)] z-0 rounded-sm border-b-2 border-ink/20" />
            <div className="absolute bottom-[-10px] left-[-18px] sm:left-[-30px] right-[-18px] sm:right-[-30px] h-3 bg-ink/20 z-0 rounded-b-sm" />
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
      
      <div className="sticky top-0 z-40 flex flex-col shadow-sm">
        <header className="bg-surface/80 backdrop-blur-xl px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 border-b border-border/60">
          <div className="flex items-center justify-between w-full sm:w-auto">
            <div className="flex items-center gap-3 sm:gap-4">
              <Link to="/" className="p-2 text-muted hover:text-ink hover:bg-paper rounded-full transition-colors flex-shrink-0 border border-transparent hover:border-border/50">
                <ArrowLeft size={20} strokeWidth={2} />
              </Link>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-3xl font-serif font-bold truncate tracking-tight text-ink">{toTitleCase(library.name)}</h1>
                <p className="text-[10px] sm:text-xs font-sans text-muted truncate font-bold mt-0.5 uppercase tracking-wider">
                  {books.length} {books.length === 1 ? 'book' : 'books'} • {isOwner ? 'Owned by you' : `Shared by ${toTitleCase(library.ownerName)}`}
                </p>
              </div>
            </div>
            {isOwner && (
              <button
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`sm:hidden p-2 rounded-full transition-colors flex-shrink-0 ml-2 border ${isSettingsOpen ? 'bg-paper text-ink border-border' : 'text-muted hover:bg-paper border-transparent hover:border-border/50'}`}
                title="Share & Settings"
              >
                <Share2 size={18} strokeWidth={2} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar pb-1 sm:pb-0 w-full sm:w-auto">
            <div className="flex items-center bg-paper rounded-xl p-1 mr-1 sm:mr-2 border border-border flex-shrink-0">
              <button
                onClick={() => setViewMode('standard')}
                className={`p-1.5 rounded-lg transition-all ${viewMode === 'standard' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'}`}
                title="Standard View"
              >
                <LayoutGrid size={16} strokeWidth={2} />
              </button>
              <button
                onClick={() => setViewMode('compact')}
                className={`p-1.5 rounded-lg transition-all ${viewMode === 'compact' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'}`}
                title="Compact View"
              >
                <List size={16} strokeWidth={2} />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-lg transition-all ${viewMode === 'table' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink'}`}
                title="Table View"
              >
                <TableIcon size={16} strokeWidth={2} />
              </button>
            </div>
            <button
              onClick={() => setIsRecommendationsModalOpen(true)}
              className="flex items-center gap-1.5 bg-paper text-accent px-3 sm:px-4 py-2 rounded-full hover:bg-surface transition-all font-sans text-xs border border-accent/20 flex-shrink-0 font-bold shadow-sm"
            >
              <Sparkles size={14} strokeWidth={2.5} />
              <span className="hidden sm:inline">Recommendations</span>
            </button>
            {canEdit && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1.5 bg-accent text-white px-4 sm:px-5 py-2 rounded-full hover:bg-accent/90 hover:shadow-lg hover:shadow-accent/30 hover:-translate-y-0.5 transition-all font-sans text-xs flex-shrink-0 font-bold"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span className="hidden sm:inline">Add Book</span>
              </button>
            )}
            {isOwner && (
              <button
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-full transition-all border ${isSettingsOpen ? 'bg-paper text-ink border-border shadow-sm' : 'text-muted hover:bg-paper border-transparent hover:border-border/50'} flex-shrink-0 font-sans text-xs font-bold`}
              >
                <Share2 size={16} strokeWidth={2} />
                <span>Share</span>
              </button>
            )}
            <div className="hidden sm:flex items-center gap-3 ml-2 pl-4 border-l border-border">
              <div className="flex items-center gap-2">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full object-cover border border-border" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-white font-sans text-xs font-medium">
                    {user?.email?.[0].toUpperCase() || 'U'}
                  </div>
                )}
              </div>
              <button onClick={logOut} className="p-2 text-muted hover:text-ink transition-colors rounded-full hover:bg-paper border border-transparent hover:border-border/50" title="Log out">
                <LogOut size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        </header>

        {/* Toolbar */}
        <div className="bg-surface/80 border-b border-border/50 flex flex-col backdrop-blur-xl">
          <div className="px-4 sm:px-8 py-3 sm:py-4 flex flex-wrap gap-4 sm:gap-5 items-center justify-between">
            <div className="flex flex-wrap items-center gap-4 sm:gap-8 w-full sm:w-auto">
              <div className="flex items-center gap-3">
                <label className="text-xs sm:text-sm font-sans font-medium text-muted uppercase tracking-wider">Sort by:</label>
                <select 
                  value={sortBy} 
                  onChange={e => handleSort(e.target.value as SortOption)}
                  className="bg-transparent border-none text-ink font-sans text-sm font-medium focus:outline-none cursor-pointer max-w-[120px] sm:max-w-none hover:text-accent transition-colors"
                >
                  <option value="added">Recently Added</option>
                  <option value="title">Title (A-Z)</option>
                  <option value="author">Author (A-Z)</option>
                </select>
                {sortBy !== 'added' && (
                  <button 
                    onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                    className="p-1.5 text-muted hover:text-ink transition-colors rounded-full hover:bg-paper"
                  >
                    {sortOrder === 'asc' ? <ArrowUp size={16} strokeWidth={1.5} /> : <ArrowDown size={16} strokeWidth={1.5} />}
                  </button>
                )}
              </div>
              <div className="hidden sm:block w-[1px] h-5 bg-border"></div>
              <div className="flex items-center gap-3">
                <label className="text-xs sm:text-sm font-sans font-medium text-muted uppercase tracking-wider">Group by:</label>
                <select 
                  value={groupBy} 
                  onChange={e => setGroupBy(e.target.value as GroupOption)}
                  className="bg-transparent border-none text-ink font-sans text-sm font-medium focus:outline-none cursor-pointer max-w-[120px] sm:max-w-none hover:text-accent transition-colors"
                >
                  <option value="none">None</option>
                  <option value="author">Author</option>
                  <option value="genre">Genre (AI)</option>
                  <option value="series">Series (AI)</option>
                  <option value="lucky">I'm Feeling Lucky (AI)</option>
                </select>
              </div>
              <div className="hidden sm:block w-[1px] h-5 bg-border"></div>
              <button
                onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${isFiltersOpen || searchQuery || filterGenre || filterAuthor || filterYearMin || filterYearMax ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-paper hover:text-ink'}`}
              >
                <Filter size={16} strokeWidth={1.5} />
                Filters {(searchQuery || filterGenre || filterAuthor || filterYearMin || filterYearMax) && <span className="w-2 h-2 rounded-full bg-accent"></span>}
              </button>
            </div>
            {isGrouping && (
              <div className="text-sm font-sans text-accent flex items-center gap-2 animate-pulse font-medium bg-accent/10 px-3 py-1.5 rounded-full">
                <Sparkles size={16} strokeWidth={2} /> Categorizing with AI...
              </div>
            )}
          </div>
          
          {/* Filters Bar */}
          {isFiltersOpen && (
            <div className="px-4 sm:px-8 py-3 bg-paper/50 border-t border-border/50 flex flex-wrap gap-4 items-center animate-in slide-in-from-top-2 fade-in duration-200">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" strokeWidth={1.5} />
                <input
                  type="text"
                  placeholder="Search title or author..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-surface border border-border rounded-full text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all font-sans"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
                    <X size={14} />
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <select
                  value={filterGenre}
                  onChange={(e) => setFilterGenre(e.target.value)}
                  className="px-3 py-2 bg-surface border border-border rounded-full text-sm focus:outline-none focus:border-accent/50 font-sans text-ink"
                >
                  <option value="">All Genres</option>
                  {availableGenres.map(genre => (
                    <option key={genre} value={genre}>{genre}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={filterAuthor}
                  onChange={(e) => setFilterAuthor(e.target.value)}
                  className="px-3 py-2 bg-surface border border-border rounded-full text-sm focus:outline-none focus:border-accent/50 font-sans text-ink max-w-[150px] truncate"
                >
                  <option value="">All Authors</option>
                  {availableAuthors.map(author => (
                    <option key={author} value={author}>{author}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 text-sm font-sans text-muted">
                <input
                  type="number"
                  placeholder="Min Year"
                  value={filterYearMin}
                  onChange={(e) => setFilterYearMin(e.target.value)}
                  className="w-24 px-3 py-2 bg-surface border border-border rounded-full focus:outline-none focus:border-accent/50 text-ink"
                />
                <span>-</span>
                <input
                  type="number"
                  placeholder="Max Year"
                  value={filterYearMax}
                  onChange={(e) => setFilterYearMax(e.target.value)}
                  className="w-24 px-3 py-2 bg-surface border border-border rounded-full focus:outline-none focus:border-accent/50 text-ink"
                />
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
                  className="text-sm text-muted hover:text-ink font-medium transition-colors px-2"
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
            <div className="text-center py-20 bg-surface rounded-2xl shadow-sm border border-border/60 relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-accent/5 to-transparent pointer-events-none" />
              <div className="w-20 h-20 bg-paper rounded-full flex items-center justify-center mx-auto mb-5 shadow-inner border border-border/50 relative z-10">
                <Book size={32} className="text-accent" strokeWidth={1.5} />
              </div>
              <h3 className="text-2xl font-serif font-bold mb-2 text-ink relative z-10">No books found</h3>
              <p className="text-muted text-base max-w-md mx-auto font-medium relative z-10">
                {books.length === 0 ? "This library is empty. Add some books to get started!" : "No books match your current filters."}
              </p>
              {books.length === 0 && canEdit && (
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="mt-6 inline-flex items-center gap-2 bg-accent text-white px-5 py-2.5 rounded-full hover:bg-accent/90 hover:shadow-lg hover:shadow-accent/30 hover:-translate-y-0.5 transition-all font-sans text-sm font-bold relative z-10"
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
                  <h2 className="text-xl sm:text-3xl font-serif font-bold mb-4 sm:mb-6 text-ink border-b border-border/50 pb-3 flex items-baseline gap-3 tracking-tight">
                    {toTitleCase(group.category)} 
                    <span className="text-xs sm:text-sm font-sans text-muted font-bold bg-paper px-2.5 py-0.5 rounded-full border border-border">
                      {group.books.length} {group.books.length === 1 ? 'book' : 'books'}
                    </span>
                  </h2>
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

                <div className="pt-8 border-t border-border/50">
                  <h4 className="text-sm font-medium text-red-500 mb-4 uppercase tracking-wider">Danger Zone</h4>
                  <button
                    onClick={handleDeleteLibrary}
                    className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-600 border border-red-100 px-5 py-4 rounded-xl hover:bg-red-100 hover:border-red-200 transition-colors text-sm font-medium"
                  >
                    <Trash2 size={18} strokeWidth={1.5} /> Delete Library
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AddBookModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddBook={handleAddBook}
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
