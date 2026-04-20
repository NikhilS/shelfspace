import React, { useState, useRef, useEffect } from 'react';
import { Search, Camera, X, BookPlus, Loader2, UploadCloud, FileText, Plus, Sparkles } from 'lucide-react';
import { searchBookByTitle, searchBookByIsbn, searchBookByTitleAndAuthor, BookDetails } from '../services/bookApi';
import { extractBooksFromImage, extractBooksFromCsv } from '../services/gemini';
import { toast } from 'sonner';
import { toTitleCase } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface AddBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddBook: (book: BookDetails) => Promise<void>;
  existingBooks?: BookDetails[];
}

export default function AddBookModal({ isOpen, onClose, onAddBook, existingBooks = [] }: AddBookModalProps) {
  const [activeTab, setActiveTab] = useState<'search' | 'camera' | 'csv' | 'manual'>('camera');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BookDetails[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [extractedBooks, setExtractedBooks] = useState<{title: string, author: string, isbn?: string, genre?: string}[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [selectedExtracted, setSelectedExtracted] = useState<Set<string>>(new Set());
  const [isAddingAll, setIsAddingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [manualBook, setManualBook] = useState<BookDetails>({
    title: '',
    author: '',
    isbn: '',
    genre: '',
    series: '',
    description: '',
    publishedDate: '',
    coverUrl: ''
  });
  const [isCoverCameraActive, setIsCoverCameraActive] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setHasSearched(false);
    try {
      // Check if it's an ISBN (mostly numbers, 10 or 13 chars)
      const isIsbn = /^\d{10,13}$/.test(searchQuery.replace(/[- ]/g, ''));
      
      let books: BookDetails[] = [];
      
      if (isIsbn) {
        const book = await searchBookByIsbn(searchQuery.replace(/[- ]/g, ''));
        if (book) {
          books = [book];
        }
      }
      
      // Fallback to title search if not an ISBN, or if ISBN search returned no results
      if (books.length === 0) {
        books = await searchBookByTitle(searchQuery);
      }
      
      setSearchResults(books);
    } catch (error) {
      toast.error("Failed to search books. Please try again.");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
      setHasSearched(true);
    }
  };

  const handleAdd = async (book: BookDetails) => {
    // Check for duplicate before processing
    if (existingBooks.some(b => 
      (b.isbn && book.isbn && b.isbn === book.isbn && book.isbn !== 'null') ||
      (b.title.toLowerCase() === book.title.toLowerCase() && 
       b.author.toLowerCase() === book.author.toLowerCase())
    )) {
      toast.info(`Skipped duplicate: ${book.title}`);
      onClose();
      return;
    }

    setIsAdding(book.isbn || book.title);
    try {
      await onAddBook(book);
      toast.success(`Added ${book.title}`);
      onClose();
    } catch (error) {
      toast.error("Failed to add book");
    } finally {
      setIsAdding(null);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const attachStream = () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setIsCameraActive(true);
        } else {
          // Retry if React hasn't mounted the video element yet
          setTimeout(attachStream, 50);
        }
      };
      attachStream();
    } catch (err) {
      console.error(err);
      toast.error("Could not access camera");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setIsCoverCameraActive(false);
  };

  const captureCover = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg');
    
    setManualBook(prev => ({ ...prev, coverUrl: base64Image }));
    stopCamera();
  };

  const handleManualAdd = async () => {
    if (!manualBook.title.trim() || !manualBook.author.trim()) return;
    
    // Check for duplicate before processing
    if (existingBooks.some(b => 
      (b.isbn && manualBook.isbn && b.isbn === manualBook.isbn && manualBook.isbn !== 'null') ||
      (b.title.toLowerCase() === manualBook.title.trim().toLowerCase() && 
       b.author.toLowerCase() === manualBook.author.trim().toLowerCase())
    )) {
      toast.info(`Skipped duplicate: ${manualBook.title}`);
      return;
    }
    
    setIsAdding('manual');
    try {
      await onAddBook(manualBook);
      toast.success(`Added ${manualBook.title}`);
      setManualBook({
        title: '',
        author: '',
        isbn: '',
        genre: '',
        series: '',
        description: '',
        publishedDate: '',
        coverUrl: ''
      });
      onClose();
    } catch (error) {
      toast.error("Failed to add book");
    } finally {
      setIsAdding(null);
    }
  };

  const captureAndExtract = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg');
    
    stopCamera();
    setIsExtracting(true);
    
    try {
      const books = await extractBooksFromImage(base64Image, 'image/jpeg');
      setExtractedBooks(books);
      setSelectedExtracted(new Set(books.map(b => `${b.title}::${b.author}`)));
      if (books.length === 0) {
        toast.error("No books found in image");
      }
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Failed to extract books from image");
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      toast.error("Please upload a valid CSV file.");
      return;
    }

    setIsExtracting(true);
    try {
      const text = await file.text();
      const books = await extractBooksFromCsv(text);
      setExtractedBooks(books);
      setSelectedExtracted(new Set(books.map(b => `${b.title}::${b.author}`)));
      if (books.length === 0) {
        toast.error("No books could be extracted from this file.");
      } else {
        toast.success(`Found ${books.length} books in CSV.`);
      }
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Failed to process CSV file.");
      }
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error("Please upload a valid image file.");
      return;
    }

    setIsExtracting(true);
    stopCamera();

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Image = reader.result as string;
        try {
          const books = await extractBooksFromImage(base64Image, file.type);
          setExtractedBooks(books);
          setSelectedExtracted(new Set(books.map(b => `${b.title}::${b.author}`)));
          if (books.length === 0) {
            toast.error("No books found in image");
          } else {
             toast.success(`Found ${books.length} books.`);
          }
        } catch (err) {
          if (err instanceof Error) {
            toast.error(err.message);
          } else {
            toast.error("Failed to extract books from image");
          }
        } finally {
          setIsExtracting(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast.error("Failed to process image file.");
      setIsExtracting(false);
    } finally {
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }
    }
  };

  const toggleSelectAll = () => {
    if (selectedExtracted.size === extractedBooks.length && extractedBooks.length > 0) {
      setSelectedExtracted(new Set());
    } else {
      setSelectedExtracted(new Set(extractedBooks.map(b => `${b.title}::${b.author}`)));
    }
  };

  const toggleSelect = (book: {title: string, author: string}) => {
    const id = `${book.title}::${book.author}`;
    const newSelected = new Set(selectedExtracted);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedExtracted(newSelected);
  };

  const handleAddSelectedExtracted = async () => {
    setIsAddingAll(true);
    let addedCount = 0;
    let duplicateCount = 0;
    const booksToAdd = extractedBooks.filter(book => selectedExtracted.has(`${book.title}::${book.author}`));
    
    // Process in batches of 5 to avoid rate-limiting while still parallelizing
    const batchSize = 5;
    for (let i = 0; i < booksToAdd.length; i += batchSize) {
      const batch = booksToAdd.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (book) => {
        try {
          setIsAdding(book.title); // Note: This might flicker with parallel updates, but gives some feedback
          
          if (existingBooks.some(b => 
            (b.isbn && book.isbn && b.isbn === book.isbn && book.isbn !== 'null') ||
            (b.title.toLowerCase() === book.title.toLowerCase())
          )) {
            // It's a duplicate, skip adding it
            setExtractedBooks(prev => prev.filter(b => b.title !== book.title));
            return 'duplicate';
          }
          
          let bookToAdd: BookDetails | null = null;

          // 1. Try ISBN first if available
          if (book.isbn && book.isbn !== 'null') {
            bookToAdd = await searchBookByIsbn(book.isbn);
          }

          // 2. Fallback to title + author search if ISBN failed or wasn't provided
          if (!bookToAdd && book.author) {
             const results = await searchBookByTitleAndAuthor(book.title, book.author);
             bookToAdd = results[0] || null;
          }

          // 3. Fallback to just title search
          if (!bookToAdd) {
            const results = await searchBookByTitle(book.title);
            bookToAdd = results.find(r => r.author.toLowerCase().includes(book.author.toLowerCase())) || results[0] || null;
          }
          
          const finalBook: BookDetails = bookToAdd || {
            title: book.title,
            author: book.author,
            isbn: book.isbn && book.isbn !== 'null' ? book.isbn : '',
            coverUrl: '',
            publishedDate: '',
            genre: book.genre
          };
          
          // Ensure genre is set if we extracted it
          if (book.genre && !finalBook.genre) {
            finalBook.genre = book.genre;
          }
          
          await onAddBook(finalBook);
          
          // Using functional state update to safely remove from the list
          setExtractedBooks(prev => prev.filter(b => b.title !== book.title));
          setSelectedExtracted(prev => {
            const next = new Set(prev);
            next.delete(`${book.title}::${book.author}`);
            return next;
          });
          return true; // Success
        } catch (error) {
          console.error(`Failed to add ${book.title}`, error);
          return false; // Failure
        }
      });
      
      const results = await Promise.all(batchPromises);
      addedCount += results.filter(r => r === true).length;
      duplicateCount += results.filter(r => r === 'duplicate').length;

      // Add a small delay between batches to avoid rate limits
      if (i + batchSize < booksToAdd.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    setIsAdding(null);
    setIsAddingAll(false);
    
    if (addedCount > 0) {
      toast.success(`Successfully added ${addedCount} books`);
    }
    if (duplicateCount > 0) {
      toast.info(`Skipped ${duplicateCount} duplicate book${duplicateCount === 1 ? '' : 's'}`);
    }
    if (addedCount + duplicateCount !== booksToAdd.length && booksToAdd.length > 0) {
      toast.error(`Failed to add ${booksToAdd.length - addedCount - duplicateCount} books`);
    }
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab('camera');
      startCamera();
    } else {
      stopCamera();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && activeTab === 'camera' && extractedBooks.length === 0 && !isExtracting && !isCameraActive) {
      startCamera();
    }
  }, [isOpen, activeTab, extractedBooks.length, isExtracting, isCameraActive]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sans"
        >
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="bg-surface/90 backdrop-blur-xl rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-border/40"
          >
            <div className="flex items-center justify-between p-6 sm:p-8 border-b border-border/40 bg-surface/50">
              <h2 className="text-2xl sm:text-3xl font-serif font-bold text-ink tracking-tight">Add Books</h2>
              <button onClick={handleClose} className="p-2 text-muted hover:bg-surface rounded-full transition-colors border border-transparent hover:border-border/60 hover:shadow-sm">
                <X size={20} strokeWidth={2} />
              </button>
            </div>

        <div className="px-6 py-4 bg-surface/30 border-b border-border/40 overflow-x-auto custom-scrollbar">
          <div className="flex bg-black/5 p-1 rounded-full w-max mx-auto sm:w-full border border-border/40">
            <button
              className={`flex-1 py-2 px-4 sm:px-6 rounded-full flex items-center justify-center gap-2 text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'camera' ? 'bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-ink' : 'text-muted hover:text-ink'}`}
              onClick={() => { setActiveTab('camera'); startCamera(); }}
            >
              <Camera size={16} strokeWidth={2} /> <span className="hidden sm:inline">Scan / Upload</span>
              <span className="sm:hidden">Scan</span>
            </button>
            <button
              className={`flex-1 py-2 px-4 sm:px-6 rounded-full flex items-center justify-center gap-2 text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'csv' ? 'bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-ink' : 'text-muted hover:text-ink'}`}
              onClick={() => { setActiveTab('csv'); stopCamera(); }}
            >
              <FileText size={16} strokeWidth={2} /> <span className="hidden sm:inline">Import CSV</span>
              <span className="sm:hidden">CSV</span>
            </button>
            <button
              className={`flex-1 py-2 px-4 sm:px-6 rounded-full flex items-center justify-center gap-2 text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'search' ? 'bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-ink' : 'text-muted hover:text-ink'}`}
              onClick={() => { setActiveTab('search'); stopCamera(); }}
            >
              <Search size={16} strokeWidth={2} /> Search
            </button>
            <button
              className={`flex-1 py-2 px-4 sm:px-6 rounded-full flex items-center justify-center gap-2 text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'manual' ? 'bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-ink' : 'text-muted hover:text-ink'}`}
              onClick={() => { setActiveTab('manual'); stopCamera(); }}
            >
              <Plus size={16} strokeWidth={2} /> Manual
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface/30 custom-scrollbar">
          {activeTab === 'search' && (
            <div className="space-y-6">
              <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by title, author, or ISBN..."
                  className="flex-1 bg-surface/50 border border-border/60 rounded-full px-6 py-4 focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition-all text-ink font-medium placeholder:text-muted/60"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="bg-ink text-surface px-8 py-4 rounded-full hover:bg-ink/90 shadow-sm hover:shadow-md transition-all disabled:opacity-50 flex items-center justify-center sm:w-auto w-full font-bold flex-shrink-0"
                >
                  {isSearching ? <Loader2 className="animate-spin" size={20} /> : 'Search'}
                </button>
              </form>

              <div className="space-y-4">
                {hasSearched && searchResults.length === 0 && !isSearching && (
                  <div className="text-center py-12 bg-surface rounded-2xl shadow-sm border border-border/50">
                    <p className="text-muted font-medium">No books found.</p>
                    <p className="text-sm text-muted/70 mt-1">Try adjusting your search terms.</p>
                  </div>
                )}
                {searchResults.map((book, idx) => (
                  <div key={idx} className="bg-surface/60 p-4 rounded-3xl shadow-sm border border-border/40 flex gap-4 items-center hover:shadow-md hover:border-border/60 transition-all">
                    {book.coverUrl ? (
                      <img src={book.coverUrl} alt={book.title} className="w-16 h-24 object-cover rounded-xl shadow-[2px_4px_10px_rgba(0,0,0,0.1)]" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-16 h-24 bg-paper rounded-xl flex items-center justify-center text-muted border border-border/50">
                        <BookPlus size={24} strokeWidth={1.5} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-serif font-bold text-base sm:text-lg text-ink truncate tracking-tight">{toTitleCase(book.title)}</h4>
                      <p className="text-muted text-xs sm:text-sm truncate mt-0.5 font-medium">{toTitleCase(book.author)}</p>
                      {book.publishedDate && <p className="text-muted/60 text-xs mt-1.5 truncate font-mono">{book.publishedDate}</p>}
                    </div>
                    <button
                      onClick={() => handleAdd(book)}
                      disabled={isAdding === (book.isbn || book.title)}
                      className="bg-ink/5 text-ink px-5 py-2.5 rounded-full hover:bg-ink hover:text-surface transition-colors disabled:opacity-50 text-sm font-bold whitespace-nowrap flex-shrink-0"
                    >
                      {isAdding === (book.isbn || book.title) ? <Loader2 className="animate-spin" size={18} /> : 'Add'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'camera' && (
            <div className="space-y-6 flex flex-col items-center">
              {!isExtracting && extractedBooks.length === 0 && (
                <div className="w-full max-w-md aspect-[3/4] bg-ink/90 rounded-3xl overflow-hidden relative shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-border/20">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                  
                  {isCameraActive ? (
                    <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3 px-4">
                      <button
                        onClick={captureAndExtract}
                        className="bg-surface/95 backdrop-blur-md text-ink px-6 py-3 rounded-full font-bold shadow-[0_4px_16px_rgba(0,0,0,0.15)] flex items-center gap-2 hover:bg-surface hover:scale-105 transition-all text-sm border border-border/40"
                      >
                        <Camera size={18} strokeWidth={2} /> Capture Shelf
                      </button>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        ref={imageInputRef}
                        onChange={handleImageUpload}
                      />
                      <button
                        onClick={() => imageInputRef.current?.click()}
                        className="bg-ink text-surface px-6 py-3 rounded-full font-bold shadow-[0_4px_16px_rgba(0,0,0,0.15)] flex items-center gap-2 hover:bg-ink/90 hover:scale-105 transition-all text-sm border border-transparent"
                      >
                        <UploadCloud size={18} strokeWidth={2} /> Upload Photo
                      </button>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-surface/60 font-medium">
                      <Camera size={48} strokeWidth={1.5} className="mb-4 opacity-40" />
                      Camera inactive
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        ref={imageInputRef}
                        onChange={handleImageUpload}
                      />
                      <button
                        onClick={() => imageInputRef.current?.click()}
                        className="mt-6 bg-surface text-ink px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 hover:bg-surface/90 hover:scale-105 transition-all text-sm border border-border/40"
                      >
                        <UploadCloud size={18} strokeWidth={2} /> Upload Photo instead
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isExtracting && (
                <div className="py-24 flex flex-col items-center justify-center w-full bg-surface/30 rounded-3xl border border-border/40">
                  <div className="relative mb-6 text-accent">
                    <Loader2 className="animate-spin absolute inset-0" size={56} strokeWidth={1.5} />
                    <Sparkles className="animate-pulse" size={56} strokeWidth={1.5} />
                  </div>
                  <h3 className="font-serif font-bold text-2xl text-ink tracking-tight mb-2">Analyzing bookshelf...</h3>
                  <p className="text-muted font-medium text-center max-w-xs">The AI Librarian is extracting book titles, authors, and metadata from your image.</p>
                </div>
              )}

              {extractedBooks.length > 0 && (
                <div className="w-full space-y-4">
                  <div className="flex items-center justify-between sticky top-0 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-border/40 mb-2 rounded-t-xl -mx-2">
                    <h3 className="font-serif text-xl sm:text-2xl font-bold text-ink tracking-tight">Found {extractedBooks.length} Books</h3>
                    <div className="flex gap-2 sm:gap-3 items-center">
                      <label className="hidden sm:flex items-center gap-2 text-sm font-bold text-ink cursor-pointer mr-2 hover:bg-surface/80 px-3 py-1.5 rounded-full transition-colors">
                        <input 
                          type="checkbox" 
                          checked={selectedExtracted.size === extractedBooks.length && extractedBooks.length > 0} 
                          onChange={toggleSelectAll}
                          className="rounded border-border/60 text-ink focus:ring-ink/20 w-4 h-4 cursor-pointer"
                        />
                        Select All
                      </label>
                      <button 
                        onClick={() => { setExtractedBooks([]); setSelectedExtracted(new Set()); }}
                        className="p-2 sm:px-4 sm:py-2 text-sm font-bold text-muted hover:text-ink hover:bg-surface border border-transparent hover:border-border/60 rounded-full transition-colors"
                        title="Clear & Scan Again"
                      >
                        <span className="hidden sm:inline">Clear</span>
                        <X size={18} strokeWidth={2} className="sm:hidden" />
                      </button>
                      <button
                        onClick={handleAddSelectedExtracted}
                        disabled={isAddingAll || selectedExtracted.size === 0}
                        className="bg-ink text-surface px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-bold hover:bg-ink/90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                      >
                        {isAddingAll ? <Loader2 className="animate-spin" size={16} /> : <BookPlus size={16} strokeWidth={2.5} />}
                        <span className="hidden sm:inline">Add Selected </span>({selectedExtracted.size})
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {extractedBooks.map((book, idx) => (
                      <label key={idx} className={`bg-surface/60 p-5 rounded-3xl border transition-all cursor-pointer flex gap-4 ${selectedExtracted.has(`${book.title}::${book.author}`) ? 'border-ink shadow-md bg-surface ring-1 ring-ink/5' : 'border-border/40 shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-border/80'}`}>
                        <div className="pt-1">
                          <input 
                            type="checkbox"
                            checked={selectedExtracted.has(`${book.title}::${book.author}`)}
                            onChange={() => toggleSelect(book)}
                            className="rounded border-border/60 text-ink focus:ring-ink/20 w-5 h-5 cursor-pointer mt-0.5"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {isAdding === book.title && <Loader2 className="animate-spin text-accent flex-shrink-0" size={14} />}
                            <h4 className="font-serif font-bold text-base sm:text-lg text-ink truncate tracking-tight" title={book.title}>{toTitleCase(book.title)}</h4>
                          </div>
                          <p className="text-muted text-xs sm:text-sm truncate mt-0.5 font-medium" title={book.author}>{toTitleCase(book.author)}</p>
                          {book.isbn && book.isbn !== 'null' && <p className="text-muted/60 text-xs mt-1.5 font-mono font-medium">ISBN: {book.isbn}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab === 'csv' && (
            <div className="space-y-6">
              {extractedBooks.length === 0 ? (
                <div className="bg-surface/40 p-12 rounded-3xl border-2 border-dashed border-border/60 flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center text-accent mb-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-border/40">
                    <UploadCloud size={36} strokeWidth={2} />
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-serif font-bold text-ink mb-3 tracking-tight">Upload Library CSV</h3>
                  <p className="text-muted text-sm sm:text-base mb-8 max-w-md font-medium leading-relaxed">
                    Upload a CSV export from Goodreads, Amazon, or your own spreadsheet. Our AI will automatically extract the titles, authors, and ISBNs.
                  </p>
                  
                  <input 
                    type="file" 
                    accept=".csv" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isExtracting}
                    className="bg-ink text-surface px-8 py-4 rounded-full hover:bg-ink/90 transition-all disabled:opacity-50 flex items-center justify-center gap-3 font-bold shadow-[0_4px_16px_rgba(0,0,0,0.15)] hover:shadow-lg hover:-translate-y-0.5"
                  >
                    {isExtracting ? (
                      <><Loader2 className="animate-spin" size={20} strokeWidth={2.5} /> Processing CSV...</>
                    ) : (
                      <><FileText size={20} strokeWidth={2.5} /> Select CSV File</>
                    )}
                  </button>
                </div>
              ) : (
                <div className="w-full space-y-4">
                  <div className="flex items-center justify-between sticky top-0 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-border/40 mb-2 rounded-t-xl -mx-2">
                    <h3 className="font-serif text-xl sm:text-2xl font-bold text-ink tracking-tight">Found {extractedBooks.length} Books</h3>
                    <div className="flex gap-2 sm:gap-3 items-center">
                      <label className="hidden sm:flex items-center gap-2 text-sm font-bold text-ink cursor-pointer mr-2 hover:bg-surface/80 px-3 py-1.5 rounded-full transition-colors">
                        <input 
                          type="checkbox" 
                          checked={selectedExtracted.size === extractedBooks.length && extractedBooks.length > 0} 
                          onChange={toggleSelectAll}
                          className="rounded border-border/60 text-ink focus:ring-ink/20 w-4 h-4 cursor-pointer"
                        />
                        Select All
                      </label>
                      <button 
                        onClick={() => { setExtractedBooks([]); setSelectedExtracted(new Set()); }}
                        className="p-2 sm:px-4 sm:py-2 text-sm font-bold text-muted hover:text-ink hover:bg-surface border border-transparent hover:border-border/60 rounded-full transition-colors"
                        title="Clear & Upload Again"
                      >
                        <span className="hidden sm:inline">Clear</span>
                        <X size={18} strokeWidth={2} className="sm:hidden" />
                      </button>
                      <button 
                        onClick={handleAddSelectedExtracted}
                        disabled={isAddingAll || selectedExtracted.size === 0}
                        className="bg-ink text-surface px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-bold hover:bg-ink/90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                      >
                        {isAddingAll ? <Loader2 className="animate-spin" size={16} /> : <BookPlus size={16} strokeWidth={2.5} />}
                        <span className="hidden sm:inline">Add Selected </span>({selectedExtracted.size})
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {extractedBooks.map((book, idx) => (
                      <label key={idx} className={`bg-surface/60 p-5 rounded-3xl border transition-all cursor-pointer flex gap-4 ${selectedExtracted.has(`${book.title}::${book.author}`) ? 'border-ink shadow-md bg-surface ring-1 ring-ink/5' : 'border-border/40 shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-border/80'}`}>
                        <div className="pt-1">
                          <input 
                            type="checkbox"
                            checked={selectedExtracted.has(`${book.title}::${book.author}`)}
                            onChange={() => toggleSelect(book)}
                            className="rounded border-border/60 text-ink focus:ring-ink/20 w-5 h-5 cursor-pointer mt-0.5"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {isAdding === book.title && <Loader2 className="animate-spin text-accent flex-shrink-0" size={14} />}
                            <h4 className="font-serif font-bold text-base sm:text-lg text-ink truncate tracking-tight" title={book.title}>{toTitleCase(book.title)}</h4>
                          </div>
                          <p className="text-muted text-xs sm:text-sm truncate mt-0.5 font-medium" title={book.author}>{toTitleCase(book.author)}</p>
                          {book.isbn && book.isbn !== 'null' && <p className="text-muted/60 text-xs mt-1.5 font-mono font-medium">ISBN: {book.isbn}</p>}
                          {book.genre && <p className="text-ink/80 text-xs mt-2 font-bold bg-ink/5 inline-block px-2.5 py-1 rounded-full border border-ink/10">{book.genre}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'manual' && (
            <div className="space-y-8 bg-surface/30 p-2 sm:p-4 rounded-3xl">
              <div className="flex flex-col items-center mb-6">
                {isCoverCameraActive ? (
                  <div className="w-full max-w-sm mx-auto aspect-[3/4] bg-ink/90 rounded-3xl overflow-hidden relative shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-border/20 mb-4">
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                    <canvas ref={canvasRef} className="hidden" />
                    <button
                      onClick={captureCover}
                      className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-md text-ink px-6 py-3 rounded-full font-bold shadow-[0_4px_16px_rgba(0,0,0,0.15)] flex items-center gap-2 hover:bg-surface hover:scale-105 transition-all text-sm whitespace-nowrap border border-border/40"
                    >
                      <Camera size={18} strokeWidth={2} /> Capture Cover
                    </button>
                    <button
                      onClick={() => { stopCamera(); setIsCoverCameraActive(false); }}
                      className="absolute top-4 right-4 p-2 bg-ink text-surface rounded-full hover:bg-ink/90 transition-colors shadow-md"
                    >
                      <X size={20} strokeWidth={2.5} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    {manualBook.coverUrl ? (
                      <div className="relative group">
                        <img src={manualBook.coverUrl} alt="Cover" className="w-32 h-48 object-cover rounded-xl shadow-[2px_4px_12px_rgba(0,0,0,0.1)] border border-border/40" />
                        <button 
                          onClick={() => setManualBook(prev => ({ ...prev, coverUrl: '' }))}
                          className="absolute -top-3 -right-3 p-2 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all hover:scale-110 shadow-md"
                        >
                          <X size={14} strokeWidth={2.5} />
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => { setIsCoverCameraActive(true); startCamera(); }}
                        className="w-32 h-48 bg-surface/50 border-2 border-dashed border-border/60 rounded-2xl flex flex-col items-center justify-center text-muted hover:text-ink hover:border-ink/40 transition-all shadow-sm hover:shadow-md"
                      >
                        <Camera size={32} className="mb-3 opacity-60" strokeWidth={1.5} />
                        <span className="text-sm font-bold text-center px-4 leading-tight">Take Cover<br/>Photo</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-bold text-ink mb-1.5 ml-1">Title *</label>
                    <input 
                      type="text" 
                      value={manualBook.title}
                      onChange={e => setManualBook(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full bg-surface/60 border border-border/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition-all text-ink font-medium"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-ink mb-1.5 ml-1">Author *</label>
                    <input 
                      type="text" 
                      value={manualBook.author}
                      onChange={e => setManualBook(prev => ({ ...prev, author: e.target.value }))}
                      className="w-full bg-surface/60 border border-border/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition-all text-ink font-medium"
                      required
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  <div>
                    <label className="block text-sm font-bold text-ink mb-1.5 ml-1">Genre</label>
                    <input 
                      type="text" 
                      value={manualBook.genre || ''}
                      onChange={e => setManualBook(prev => ({ ...prev, genre: e.target.value }))}
                      className="w-full bg-surface/60 border border-border/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition-all text-ink font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-ink mb-1.5 ml-1">Series</label>
                    <input 
                      type="text" 
                      value={manualBook.series || ''}
                      onChange={e => setManualBook(prev => ({ ...prev, series: e.target.value }))}
                      className="w-full bg-surface/60 border border-border/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition-all text-ink font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-ink mb-1.5 ml-1">ISBN</label>
                    <input 
                      type="text" 
                      value={manualBook.isbn || ''}
                      onChange={e => setManualBook(prev => ({ ...prev, isbn: e.target.value }))}
                      className="w-full bg-surface/60 border border-border/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition-all text-ink font-medium font-mono text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-ink mb-1.5 ml-1">Published Date</label>
                  <input 
                    type="text" 
                    placeholder="e.g., 2023 or YYYY-MM-DD"
                    value={manualBook.publishedDate || ''}
                    onChange={e => setManualBook(prev => ({ ...prev, publishedDate: e.target.value }))}
                    className="w-full bg-surface/60 border border-border/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition-all text-ink font-medium"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-ink mb-1.5 ml-1">Description</label>
                  <textarea 
                    value={manualBook.description || ''}
                    onChange={e => setManualBook(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full bg-surface/60 border border-border/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition-all text-ink font-medium min-h-[120px] resize-y"
                  />
                </div>

                <button
                  onClick={handleManualAdd}
                  disabled={!manualBook.title.trim() || !manualBook.author.trim() || isAdding === 'manual'}
                  className="w-full bg-ink text-surface px-8 py-4 rounded-full hover:bg-ink/90 transition-all disabled:opacity-50 flex items-center justify-center font-bold shadow-[0_4px_16px_rgba(0,0,0,0.15)] hover:shadow-lg hover:-translate-y-0.5 mt-8"
                >
                  {isAdding === 'manual' ? <Loader2 className="animate-spin" size={24} strokeWidth={2.5} /> : 'Add Book to Library'}
                </button>
              </div>
            </div>
          )}

        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
