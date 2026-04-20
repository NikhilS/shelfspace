import React, { useState, useRef, useEffect } from 'react';
import { Search, Camera, X, BookPlus, Loader2, UploadCloud, FileText, Plus } from 'lucide-react';
import { searchBookByTitle, searchBookByIsbn, BookDetails } from '../services/bookApi';
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
  const [isAddingAll, setIsAddingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [manualBook, setManualBook] = useState<BookDetails>({
    title: '',
    author: '',
    isbn: '',
    genre: '',
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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      toast.error("Could not access camera");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      setIsCameraActive(false);
      setIsCoverCameraActive(false);
    }
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

  const handleAddExtracted = async (extracted: {title: string, author: string, isbn?: string, genre?: string}) => {
    setIsAdding(extracted.title);
    
    // Check for duplicate before processing
    if (existingBooks.some(b => 
      (b.isbn && extracted.isbn && b.isbn === extracted.isbn && extracted.isbn !== 'null') ||
      (b.title.toLowerCase() === extracted.title.toLowerCase())
    )) {
      toast.info(`Skipped duplicate: ${extracted.title}`);
      setExtractedBooks(prev => prev.filter(b => b.title !== extracted.title));
      setIsAdding(null);
      return;
    }
    
    try {
      let bookToAdd: BookDetails | null = null;

      // 1. Try ISBN first if available
      if (extracted.isbn && extracted.isbn !== 'null') {
        bookToAdd = await searchBookByIsbn(extracted.isbn);
      }

      // 2. Fallback to title search if ISBN failed or wasn't provided
      if (!bookToAdd) {
        const results = await searchBookByTitle(extracted.title);
        bookToAdd = results.find(r => r.author.toLowerCase().includes(extracted.author.toLowerCase())) || results[0] || null;
      }
      
      const finalBook: BookDetails = bookToAdd || {
        title: extracted.title,
        author: extracted.author,
        isbn: extracted.isbn && extracted.isbn !== 'null' ? extracted.isbn : '',
        coverUrl: '',
        publishedDate: '',
        genre: extracted.genre
      };
      
      // Ensure genre is set if we extracted it
      if (extracted.genre && !finalBook.genre) {
        finalBook.genre = extracted.genre;
      }
      
      await onAddBook(finalBook);
      toast.success(`Added ${finalBook.title}`);
      setExtractedBooks(prev => prev.filter(b => b.title !== extracted.title));
    } catch (error) {
      toast.error("Failed to add book");
    } finally {
      setIsAdding(null);
    }
  };

  const handleAddAllExtracted = async () => {
    setIsAddingAll(true);
    let addedCount = 0;
    let duplicateCount = 0;
    const booksToAdd = [...extractedBooks];
    
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

          // 2. Fallback to title search if ISBN failed or wasn't provided
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
          return true; // Success
        } catch (error) {
          console.error(`Failed to add ${book.title}`, error);
          return false; // Failure
        }
      });
      
      const results = await Promise.all(batchPromises);
      addedCount += results.filter(r => r === true).length;
      duplicateCount += results.filter(r => r === 'duplicate').length;
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
            className="bg-surface rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-[0px_10px_40px_rgba(0,0,0,0.1)] border border-border/50"
          >
            <div className="flex items-center justify-between p-6 border-b border-border/50">
              <h2 className="text-2xl font-serif font-medium text-ink tracking-tight">Add Books</h2>
              <button onClick={handleClose} className="p-2 text-muted hover:bg-paper rounded-full transition-colors">
                <X size={20} strokeWidth={1.5} />
              </button>
            </div>

        <div className="flex border-b border-border/50 overflow-x-auto custom-scrollbar">
          <button
            className={`flex-1 py-4 px-4 flex items-center justify-center gap-2 font-medium transition-colors whitespace-nowrap ${activeTab === 'camera' ? 'text-accent border-b-2 border-accent' : 'text-muted hover:bg-paper/50'}`}
            onClick={() => { setActiveTab('camera'); startCamera(); }}
          >
            <Camera size={18} strokeWidth={1.5} /> Scan / Upload
          </button>
          <button
            className={`flex-1 py-4 px-4 flex items-center justify-center gap-2 font-medium transition-colors whitespace-nowrap ${activeTab === 'csv' ? 'text-accent border-b-2 border-accent' : 'text-muted hover:bg-paper/50'}`}
            onClick={() => { setActiveTab('csv'); stopCamera(); }}
          >
            <FileText size={18} strokeWidth={1.5} /> Import CSV
          </button>
          <button
            className={`flex-1 py-4 px-4 flex items-center justify-center gap-2 font-medium transition-colors whitespace-nowrap ${activeTab === 'search' ? 'text-accent border-b-2 border-accent' : 'text-muted hover:bg-paper/50'}`}
            onClick={() => { setActiveTab('search'); stopCamera(); }}
          >
            <Search size={18} strokeWidth={1.5} /> Search
          </button>
          <button
            className={`flex-1 py-4 px-4 flex items-center justify-center gap-2 font-medium transition-colors whitespace-nowrap ${activeTab === 'manual' ? 'text-accent border-b-2 border-accent' : 'text-muted hover:bg-paper/50'}`}
            onClick={() => { setActiveTab('manual'); stopCamera(); }}
          >
            <Plus size={18} strokeWidth={1.5} /> Manual
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-paper custom-scrollbar">
          {activeTab === 'search' && (
            <div className="space-y-6">
              <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by title, author, or ISBN..."
                  className="flex-1 bg-surface border border-border/80 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-ink placeholder:text-muted/70"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="bg-accent text-white px-6 py-3 rounded-xl hover:bg-opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center sm:w-auto w-full font-medium shadow-sm"
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
                  <div key={idx} className="bg-surface p-4 rounded-2xl shadow-sm border border-border/30 flex gap-4 items-center hover:shadow-md transition-shadow">
                    {book.coverUrl ? (
                      <img src={book.coverUrl} alt={book.title} className="w-16 h-24 object-cover rounded-md shadow-[2px_4px_10px_rgba(0,0,0,0.1)]" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-16 h-24 bg-paper rounded-md flex items-center justify-center text-muted border border-border/50">
                        <BookPlus size={24} strokeWidth={1.5} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-serif font-medium text-base sm:text-lg text-ink truncate tracking-tight">{toTitleCase(book.title)}</h4>
                      <p className="text-muted text-xs sm:text-sm truncate mt-0.5">{toTitleCase(book.author)}</p>
                      {book.publishedDate && <p className="text-muted/60 text-xs mt-1.5 truncate font-mono">{book.publishedDate}</p>}
                    </div>
                    <button
                      onClick={() => handleAdd(book)}
                      disabled={isAdding === (book.isbn || book.title)}
                      className="bg-paper text-accent px-4 py-2 rounded-full hover:bg-accent/10 transition-colors disabled:opacity-50 text-sm font-medium whitespace-nowrap flex-shrink-0 border border-border/50"
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
                <div className="w-full max-w-md aspect-[3/4] bg-ink rounded-2xl overflow-hidden relative shadow-inner">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                  
                  {isCameraActive ? (
                    <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3">
                      <button
                        onClick={captureAndExtract}
                        className="bg-surface text-ink px-6 py-3 rounded-full font-medium shadow-lg flex items-center gap-2 hover:bg-paper transition-colors"
                      >
                        <Camera size={20} strokeWidth={1.5} /> Capture Shelf
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
                        className="bg-surface text-ink px-6 py-3 rounded-full font-medium shadow-lg flex items-center gap-2 hover:bg-paper transition-colors"
                      >
                        <UploadCloud size={20} strokeWidth={1.5} /> Upload Photo
                      </button>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50 font-medium">
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
                        className="mt-4 bg-surface text-ink px-6 py-3 rounded-full font-medium shadow-lg flex items-center gap-2 hover:bg-paper transition-colors"
                      >
                        <UploadCloud size={20} strokeWidth={1.5} /> Upload Photo instead
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isExtracting && (
                <div className="py-20 flex flex-col items-center text-muted">
                  <Loader2 className="animate-spin mb-4 text-accent" size={40} strokeWidth={1.5} />
                  <p className="font-medium text-lg text-ink">Analyzing bookshelf...</p>
                  <p className="text-sm mt-1">Gemini is extracting book titles and authors.</p>
                </div>
              )}

              {extractedBooks.length > 0 && (
                <div className="w-full space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-serif text-xl font-medium text-ink tracking-tight">Found {extractedBooks.length} Books</h3>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => { setExtractedBooks([]); startCamera(); }}
                        className="text-sm text-muted hover:text-ink transition-colors font-medium"
                      >
                        Scan Again
                      </button>
                      <button
                        onClick={handleAddAllExtracted}
                        disabled={isAddingAll || extractedBooks.length === 0}
                        className="bg-accent text-white px-4 py-2 rounded-full text-sm font-bold hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
                      >
                        {isAddingAll ? <Loader2 className="animate-spin" size={16} /> : <BookPlus size={16} strokeWidth={2} />}
                        Add All
                      </button>
                    </div>
                  </div>
                  
                  <div className="bg-surface rounded-2xl shadow-sm overflow-hidden border border-border/50">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-paper border-b border-border/50">
                        <tr>
                          <th className="py-2 px-3 font-medium text-muted text-[10px] uppercase tracking-wider w-[45%]">Title</th>
                          <th className="py-2 px-3 font-medium text-muted text-[10px] uppercase tracking-wider w-[25%]">Author</th>
                          <th className="py-2 px-3 font-medium text-muted text-[10px] uppercase tracking-wider w-[20%]">ISBN</th>
                          <th className="py-2 px-3 font-medium text-muted text-[10px] uppercase tracking-wider text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {extractedBooks.map((book, idx) => (
                          <tr key={idx} className="hover:bg-paper/50 transition-colors">
                            <td className="py-1.5 px-3 font-serif font-medium text-ink text-sm leading-tight">{toTitleCase(book.title)}</td>
                            <td className="py-1.5 px-3 text-muted text-xs leading-tight">{toTitleCase(book.author)}</td>
                            <td className="py-1.5 px-3 text-muted/70 text-[11px] font-mono leading-tight">{book.isbn && book.isbn !== 'null' ? book.isbn : '-'}</td>
                            <td className="py-1.5 px-3 text-right">
                              <button
                                onClick={() => handleAddExtracted(book)}
                                disabled={isAdding === book.title || isAddingAll}
                                className="text-accent hover:text-opacity-80 font-medium text-xs disabled:opacity-50 inline-flex items-center justify-end gap-1 transition-colors"
                              >
                                {isAdding === book.title ? <Loader2 className="animate-spin" size={14} /> : 'Add'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-paper border-t border-border/50">
                        <tr>
                          <td colSpan={4} className="py-2 px-3 font-medium text-ink text-xs">
                            Total Books Found: {extractedBooks.length}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab === 'csv' && (
            <div className="space-y-6">
              {extractedBooks.length === 0 ? (
                <div className="bg-surface p-8 rounded-2xl border border-dashed border-border flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center text-accent mb-4">
                    <UploadCloud size={32} strokeWidth={1.5} />
                  </div>
                  <h3 className="text-xl font-serif font-medium text-ink mb-2">Upload Library CSV</h3>
                  <p className="text-muted text-sm mb-6 max-w-md">
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
                    className="bg-accent text-white px-6 py-3 rounded-xl hover:bg-opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 font-medium shadow-sm"
                  >
                    {isExtracting ? (
                      <><Loader2 className="animate-spin" size={20} /> Processing CSV...</>
                    ) : (
                      <><FileText size={20} /> Select CSV File</>
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between sticky top-0 bg-paper/90 backdrop-blur-md py-2 z-10 border-b border-border/50">
                    <h3 className="font-serif font-medium text-lg text-ink">Found {extractedBooks.length} Books</h3>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setExtractedBooks([])}
                        className="px-4 py-2 text-sm font-medium text-muted hover:text-ink hover:bg-surface rounded-full transition-colors"
                      >
                        Clear
                      </button>
                      <button 
                        onClick={handleAddAllExtracted}
                        disabled={isAddingAll}
                        className="bg-accent text-white px-4 py-2 rounded-full hover:bg-opacity-90 transition-colors disabled:opacity-50 text-sm font-medium flex items-center gap-2 shadow-sm"
                      >
                        {isAddingAll ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                        Add All
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {extractedBooks.map((book, idx) => (
                      <div key={idx} className="bg-surface p-4 rounded-2xl shadow-sm border border-border/30 flex flex-col gap-3 hover:shadow-md transition-shadow">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-serif font-medium text-base text-ink truncate tracking-tight" title={book.title}>{toTitleCase(book.title)}</h4>
                          <p className="text-muted text-sm truncate mt-0.5" title={book.author}>{toTitleCase(book.author)}</p>
                          {book.isbn && <p className="text-muted/60 text-xs mt-1.5 font-mono">ISBN: {book.isbn}</p>}
                          {book.genre && <p className="text-accent/80 text-xs mt-1 font-medium bg-accent/5 inline-block px-2 py-0.5 rounded-full border border-accent/10">{book.genre}</p>}
                        </div>
                        <button
                          onClick={() => handleAddExtracted(book)}
                          disabled={isAdding === book.title || isAddingAll}
                          className="bg-paper text-accent w-full py-2 rounded-xl hover:bg-accent/10 transition-colors disabled:opacity-50 text-sm font-medium border border-border/50 flex items-center justify-center gap-2"
                        >
                          {isAdding === book.title ? <Loader2 className="animate-spin" size={16} /> : 'Add to Library'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'manual' && (
            <div className="space-y-6">
              <div className="flex flex-col items-center mb-2">
                {isCoverCameraActive ? (
                  <div className="w-full max-w-sm mx-auto aspect-[3/4] bg-ink rounded-2xl overflow-hidden relative shadow-inner mb-4">
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                    <canvas ref={canvasRef} className="hidden" />
                    <button
                      onClick={captureCover}
                      className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-surface text-ink px-6 py-3 rounded-full font-medium shadow-lg flex items-center gap-2 hover:bg-paper transition-colors whitespace-nowrap"
                    >
                      <Camera size={20} strokeWidth={1.5} /> Capture Cover
                    </button>
                    <button
                      onClick={() => { stopCamera(); setIsCoverCameraActive(false); }}
                      className="absolute top-4 right-4 p-2 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    {manualBook.coverUrl ? (
                      <div className="relative group">
                        <img src={manualBook.coverUrl} alt="Cover" className="w-32 h-48 object-cover rounded-md shadow-md" />
                        <button 
                          onClick={() => setManualBook(prev => ({ ...prev, coverUrl: '' }))}
                          className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => { setIsCoverCameraActive(true); startCamera(); }}
                        className="w-32 h-48 bg-paper border-2 border-dashed border-border rounded-md flex flex-col items-center justify-center text-muted hover:text-accent hover:border-accent transition-colors"
                      >
                        <Camera size={32} className="mb-2 opacity-50" />
                        <span className="text-sm font-medium text-center px-2">Take Photo<br/>of Cover</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1.5">Title *</label>
                    <input 
                      type="text" 
                      value={manualBook.title}
                      onChange={e => setManualBook(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full bg-surface border border-border/80 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-ink"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1.5">Author *</label>
                    <input 
                      type="text" 
                      value={manualBook.author}
                      onChange={e => setManualBook(prev => ({ ...prev, author: e.target.value }))}
                      className="w-full bg-surface border border-border/80 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-ink"
                      required
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1.5">Genre</label>
                    <input 
                      type="text" 
                      value={manualBook.genre || ''}
                      onChange={e => setManualBook(prev => ({ ...prev, genre: e.target.value }))}
                      className="w-full bg-surface border border-border/80 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1.5">ISBN</label>
                    <input 
                      type="text" 
                      value={manualBook.isbn || ''}
                      onChange={e => setManualBook(prev => ({ ...prev, isbn: e.target.value }))}
                      className="w-full bg-surface border border-border/80 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-ink"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5">Published Date</label>
                  <input 
                    type="text" 
                    placeholder="e.g., 2023 or YYYY-MM-DD"
                    value={manualBook.publishedDate || ''}
                    onChange={e => setManualBook(prev => ({ ...prev, publishedDate: e.target.value }))}
                    className="w-full bg-surface border border-border/80 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-ink"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-1.5">Description</label>
                  <textarea 
                    value={manualBook.description || ''}
                    onChange={e => setManualBook(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full bg-surface border border-border/80 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all text-ink min-h-[100px] resize-y"
                  />
                </div>

                <button
                  onClick={handleManualAdd}
                  disabled={!manualBook.title.trim() || !manualBook.author.trim() || isAdding === 'manual'}
                  className="w-full bg-accent text-white px-6 py-3 rounded-xl hover:bg-opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center font-medium shadow-sm mt-4"
                >
                  {isAdding === 'manual' ? <Loader2 className="animate-spin" size={20} /> : 'Add Book'}
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
