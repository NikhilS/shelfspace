/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import React, {useState, useRef, useEffect} from 'react';
import {
  Search,
  Camera,
  X,
  BookPlus,
  Loader2,
  UploadCloud,
  FileText,
  Plus,
  Sparkles,
  ArrowLeft,
  ScanBarcode,
  ChevronDown,
} from 'lucide-react';
import {
  searchBookByTitle,
  searchBookByIsbn,
  searchBookByTitleAndAuthor,
  BookDetails,
} from '../services/bookApi';
import {
  extractBooksFromImage,
  extractBooksFromCsv,
  enrichBooksMetadata,
} from '../services/gemini';
import {toast} from 'sonner';
import {toTitleCase} from '../lib/utils';
import {motion, AnimatePresence} from 'motion/react';
import {useParams, useNavigate, Link, useLocation} from 'react-router-dom';
import {
  collection,
  doc,
  addDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {db} from '../firebase';
import {useAuth} from '../contexts/AuthContext';
import AppLayout from '../components/AppLayout';
import BarcodeScanner from '../components/BarcodeScanner';

export default function AddBookView() {
  const {id: libraryId} = useParams<{id: string}>();
  const navigate = useNavigate();
  const location = useLocation();
  const {user} = useAuth();

  const backUrl = location.state?.from || `/library/${libraryId}`;

  const [activeTab, setActiveTab] = useState<
    'scan' | 'search' | 'camera' | 'csv' | 'manual'
  >('scan');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BookDetails[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [extractedBooks, setExtractedBooks] = useState<
    {
      title: string;
      author: string;
      isbn?: string;
      genres?: string[];
      format?: 'physical' | 'digital';
    }[]
  >([]);
  const [csvFormat, setCsvFormat] = useState<'physical' | 'digital'>(
    'physical',
  );
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null);
  const [selectedExtracted, setSelectedExtracted] = useState<Set<string>>(
    new Set(),
  );
  const [isAddingAll, setIsAddingAll] = useState(false);
  const [addProgress, setAddProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [existingBooks, setExistingBooks] = useState<BookDetails[]>([]);
  const [processingIsbns, setProcessingIsbns] = useState<Set<string>>(
    new Set(),
  );
  const [scannedBooks, setScannedBooks] = useState<BookDetails[]>([]);
  const [selectedScanned, setSelectedScanned] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    if (!libraryId) return;
    const fetchExisting = async () => {
      try {
        const booksRef = collection(db, 'libraries', libraryId, 'books');
        const snap = await getDocs(booksRef);
        const books = snap.docs.map(doc => doc.data() as BookDetails);
        setExistingBooks(books);
      } catch (err) {
        console.error('Failed to load existing books:', err);
      }
    };
    fetchExisting();
  }, [libraryId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [manualBook, setManualBook] = useState<BookDetails>({
    title: '',
    author: '',
    isbn: '',
    genres: [],
    series: '',
    description: '',
    publishedDate: '',
    coverUrl: '',
    format: 'physical',
  });
  const [isCoverCameraActive, setIsCoverCameraActive] = useState(false);

  const onAddBook = async (book: BookDetails) => {
    if (!libraryId || !user) throw new Error('Library or user not found');

    const enrichedDetails = {...book, format: book.format || 'physical'};

    // Attempt to quickly enrich series if missing
    if (!enrichedDetails.series) {
      try {
        const enrichments = await enrichBooksMetadata([
          {
            id: 'temp',
            title: enrichedDetails.title,
            author: enrichedDetails.author,
            description: enrichedDetails.description,
          },
        ]);
        if (enrichments.length > 0) {
          enrichedDetails.series =
            enrichedDetails.series || enrichments[0].series;
        }
      } catch (_e) {
        console.warn('Failed to enrich metadata on add', e);
      }
    }

    const cleanDetails = Object.fromEntries(
      Object.entries(enrichedDetails).filter(
        ([_, v]) => v !== undefined && v !== null && v !== '',
      ),
    );
    if (cleanDetails.genres && Array.isArray(cleanDetails.genres))
      cleanDetails.genres = cleanDetails.genres
        .map((g: string) => g.substring(0, 100))
        .slice(0, 20);
    if (cleanDetails.author && typeof cleanDetails.author === 'string')
      cleanDetails.author = cleanDetails.author.substring(0, 500);
    if (cleanDetails.series && typeof cleanDetails.series === 'string')
      cleanDetails.series = cleanDetails.series.substring(0, 100);
    if (cleanDetails.title && typeof cleanDetails.title === 'string')
      cleanDetails.title = cleanDetails.title.substring(0, 500);

    const docRef = await addDoc(
      collection(db, 'libraries', libraryId, 'books'),
      {
        ...cleanDetails,
        addedBy: user.uid,
        addedAt: serverTimestamp(),
      },
    );

    // Add to existingBooks so we don't add duplicate in same session
    setExistingBooks(prev => [...prev, enrichedDetails]);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setHasSearched(false);
    try {
      const isIsbn = /^\d{10,13}$/.test(searchQuery.replace(/[- ]/g, ''));
      let books: BookDetails[] = [];
      if (isIsbn) {
        const book = await searchBookByIsbn(searchQuery.replace(/[- ]/g, ''));
        if (book) books = [book];
      }
      if (books.length === 0) {
        books = await searchBookByTitle(searchQuery);
      }
      setSearchResults(books);
    } catch (_error) {
      toast.error('Failed to search books. Please try again.');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
      setHasSearched(true);
    }
  };

  const handleAdd = async (book: BookDetails) => {
    const cleanNewIsbn = (book.isbn || '').trim().replace(/[^0-9X]/gi, '');
    const cleanNewTitle = (book.title || '').trim().toLowerCase();
    const cleanNewAuthor = (book.author || '').trim().toLowerCase();

    if (
      existingBooks.some(b => {
        const cleanExistingIsbn = (b.isbn || '')
          .trim()
          .replace(/[^0-9X]/gi, '');
        const hasSameIsbn =
          cleanExistingIsbn.length >= 10 &&
          cleanNewIsbn.length >= 10 &&
          cleanExistingIsbn === cleanNewIsbn;
        const hasSameTitleAndAuthor =
          (b.title || '').trim().toLowerCase() === cleanNewTitle &&
          (b.author || '').trim().toLowerCase() === cleanNewAuthor;
        return hasSameIsbn || (cleanNewTitle && hasSameTitleAndAuthor);
      })
    ) {
      toast.info(`Skipped duplicate: ${book.title}`);
      return;
    }

    setIsAdding(book.isbn || book.title);
    try {
      const bookToAdd = {
        ...book,
        format: book.format || 'physical',
      } as BookDetails;
      await onAddBook(bookToAdd);
      toast.success(`Added ${bookToAdd.title}`);
    } catch (_error) {
      toast.error('Failed to add book');
    } finally {
      setIsAdding(null);
    }
  };

  const handleScanIsbn = async (isbn: string) => {
    if (processingIsbns.has(isbn) || scannedBooks.some(b => b.isbn === isbn))
      return;

    setProcessingIsbns(prev => new Set(prev).add(isbn));

    try {
      const book = await searchBookByIsbn(isbn);
      if (book) {
        setScannedBooks(prev => {
          if (prev.some(b => b.isbn === isbn)) return prev;
          return [book, ...prev];
        });
        setSelectedScanned(prev => new Set(prev).add(isbn));
      } else {
        toast.error(`Could not find book for ISBN ${isbn}`);
      }
    } catch (_e) {
      toast.error(`Failed to fetch book for ISBN ${isbn}`);
    } finally {
      setProcessingIsbns(prev => {
        const next = new Set(prev);
        next.delete(isbn);
        return next;
      });
    }
  };

  const toggleSelectScanned = (book: BookDetails) => {
    const next = new Set(selectedScanned);
    const key = book.isbn || book.title;
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedScanned(next);
  };

  const handleAddSelectedScanned = async () => {
    setIsAddingAll(true);
    let successCount = 0;
    const booksToAdd = scannedBooks.filter(b =>
      selectedScanned.has(b.isbn || b.title),
    );

    for (const b of booksToAdd) {
      try {
        await onAddBook(b);
        successCount++;
      } catch (_e) {
        console.error(e);
      }
    }

    toast.success(
      `Successfully added ${successCount} out of ${booksToAdd.length} books`,
    );
    setScannedBooks(prev =>
      prev.filter(b => !selectedScanned.has(b.isbn || b.title)),
    );
    setSelectedScanned(new Set());
    setIsAddingAll(false);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'environment'},
      });
      const attachStream = () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            setIsCameraActive(true);
          };
        } else {
          setTimeout(attachStream, 50);
        }
      };
      attachStream();
    } catch (err) {
      console.error(err);
      toast.error('Could not access camera');
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
    if (!video.videoWidth || !video.videoHeight) {
      toast.error('Camera stream not ready yet.');
      return;
    }
    const MAX_DIMENSION = 800; // ensures the output base64 is safely under 1MB (max 800x800)
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > height) {
      if (width > MAX_DIMENSION) {
        height *= MAX_DIMENSION / width;
        width = MAX_DIMENSION;
      }
    } else {
      if (height > MAX_DIMENSION) {
        width *= MAX_DIMENSION / height;
        height = MAX_DIMENSION;
      }
    }
    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg', 0.8);
    setManualBook(prev => ({...prev, coverUrl: base64Image}));
    stopCamera();
  };

  const handleManualAdd = async () => {
    if (!manualBook.title.trim() || !manualBook.author.trim()) return;
    const cleanNewIsbn = (manualBook.isbn || '')
      .trim()
      .replace(/[^0-9X]/gi, '');
    const cleanNewTitle = manualBook.title.trim().toLowerCase();
    const cleanNewAuthor = manualBook.author.trim().toLowerCase();

    if (
      existingBooks.some(b => {
        const cleanExistingIsbn = (b.isbn || '')
          .trim()
          .replace(/[^0-9X]/gi, '');
        const hasSameIsbn =
          cleanExistingIsbn.length >= 10 &&
          cleanNewIsbn.length >= 10 &&
          cleanExistingIsbn === cleanNewIsbn;
        const hasSameTitleAndAuthor =
          (b.title || '').trim().toLowerCase() === cleanNewTitle &&
          (b.author || '').trim().toLowerCase() === cleanNewAuthor;
        return hasSameIsbn || (cleanNewTitle && hasSameTitleAndAuthor);
      })
    ) {
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
        genres: [],
        series: '',
        description: '',
        publishedDate: '',
        coverUrl: '',
        format: 'physical',
      });
    } catch (_error) {
      toast.error('Failed to add book');
    } finally {
      setIsAdding(null);
    }
  };

  const captureAndExtract = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      toast.error('Camera stream not ready yet.');
      return;
    }
    const MAX_DIMENSION = 1200; // Gemini accepts large images but 1200x1200 keeps API calls fast
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > height) {
      if (width > MAX_DIMENSION) {
        height *= MAX_DIMENSION / width;
        width = MAX_DIMENSION;
      }
    } else {
      if (height > MAX_DIMENSION) {
        width *= MAX_DIMENSION / height;
        height = MAX_DIMENSION;
      }
    }
    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Image = canvas.toDataURL('image/jpeg', 0.8);
    stopCamera();
    setIsExtracting(true);

    try {
      const books = await extractBooksFromImage(base64Image, 'image/jpeg');
      setExtractedBooks(books);
      setSelectedExtracted(new Set(books.map(b => `${b.title}::${b.author}`)));
      if (books.length === 0) toast.error('No books found in image');
    } catch (_error) {
      if (error instanceof Error) toast.error(error.message);
      else toast.error('Failed to extract books from image');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      toast.error('Please upload a valid CSV file.');
      return;
    }
    setIsExtracting(true);
    setExtractionStatus('Reading CSV file...');
    try {
      const text = await file.text();
      setExtractionStatus('Extracting books using AI...');
      const books = await extractBooksFromCsv(text);
      setExtractedBooks(books);
      setSelectedExtracted(new Set(books.map(b => `${b.title}::${b.author}`)));
      if (books.length === 0)
        toast.error('No books could be extracted from this file.');
      else toast.success(`Found ${books.length} books in CSV.`);
    } catch (_error) {
      if (error instanceof Error) toast.error(error.message);
      else toast.error('Failed to process CSV file.');
    } finally {
      setIsExtracting(false);
      setExtractionStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload a valid image file.');
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
          setSelectedExtracted(
            new Set(books.map(b => `${b.title}::${b.author}`)),
          );
          if (books.length === 0) toast.error('No books found in image');
          else toast.success(`Found ${books.length} books.`);
        } catch (err) {
          if (err instanceof Error) toast.error(err.message);
          else toast.error('Failed to extract books from image');
        } finally {
          setIsExtracting(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (_error) {
      toast.error('Failed to process image file.');
      setIsExtracting(false);
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const toggleSelectAll = () => {
    if (
      selectedExtracted.size === extractedBooks.length &&
      extractedBooks.length > 0
    )
      setSelectedExtracted(new Set());
    else
      setSelectedExtracted(
        new Set(extractedBooks.map(b => `${b.title}::${b.author}`)),
      );
  };

  const toggleSelect = (book: {title: string; author: string}) => {
    const id = `${book.title}::${book.author}`;
    const newSelected = new Set(selectedExtracted);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedExtracted(newSelected);
  };

  const handleAddSelectedExtracted = async () => {
    setIsAddingAll(true);
    let addedCount = 0;
    let duplicateCount = 0;
    const booksToAdd = extractedBooks.filter(book =>
      selectedExtracted.has(`${book.title}::${book.author}`),
    );
    setAddProgress({current: 0, total: booksToAdd.length});

    const newlyAdded: {title: string; author: string; isbn: string}[] = [];
    const batchSize = 5;
    for (let i = 0; i < booksToAdd.length; i += batchSize) {
      const batch = booksToAdd.slice(i, i + batchSize);
      const batchPromises = batch.map(async book => {
        try {
          setIsAdding(book.title);
          const cleanNewIsbn = (book.isbn || '')
            .trim()
            .replace(/[^0-9X]/gi, '');
          const cleanNewTitle = (book.title || '').trim().toLowerCase();
          const cleanNewAuthor = (book.author || '').trim().toLowerCase();

          const isDuplicate =
            existingBooks.some(b => {
              const cleanExistingIsbn = (b.isbn || '')
                .trim()
                .replace(/[^0-9X]/gi, '');
              const hasSameIsbn =
                cleanExistingIsbn.length >= 10 &&
                cleanNewIsbn.length >= 10 &&
                cleanExistingIsbn === cleanNewIsbn;
              const hasSameTitleAndAuthor =
                (b.title || '').trim().toLowerCase() === cleanNewTitle &&
                (b.author || '').trim().toLowerCase() === cleanNewAuthor;
              return hasSameIsbn || (cleanNewTitle && hasSameTitleAndAuthor);
            }) ||
            newlyAdded.some(b => {
              const hasSameIsbn =
                b.isbn.length >= 10 &&
                cleanNewIsbn.length >= 10 &&
                b.isbn === cleanNewIsbn;
              const hasSameTitleAndAuthor =
                b.title === cleanNewTitle && b.author === cleanNewAuthor;
              return hasSameIsbn || (cleanNewTitle && hasSameTitleAndAuthor);
            });

          if (isDuplicate) {
            setExtractedBooks(prev =>
              prev.filter(
                b => !(b.title === book.title && b.author === book.author),
              ),
            );
            return 'duplicate';
          }

          let bookToAdd: BookDetails | null = null;
          if (book.isbn && book.isbn !== 'null')
            bookToAdd = await searchBookByIsbn(book.isbn);
          if (!bookToAdd && book.author) {
            const results = await searchBookByTitleAndAuthor(
              book.title,
              book.author,
            );
            bookToAdd = results[0] || null;
          }
          if (!bookToAdd) {
            const results = await searchBookByTitle(book.title);
            bookToAdd = book.author
              ? results.find(r =>
                  (r.author || '')
                    .toLowerCase()
                    .includes(book.author.toLowerCase()),
                ) ||
                results[0] ||
                null
              : results[0] || null;
          }

          const finalBook: BookDetails = bookToAdd || {
            title: book.title,
            author: book.author,
            isbn: book.isbn && book.isbn !== 'null' ? book.isbn : '',
            coverUrl: '',
            publishedDate: '',
            genres: book.genres,
          };
          if (
            book.genres &&
            (!finalBook.genres || finalBook.genres.length === 0)
          )
            finalBook.genres = book.genres;
          finalBook.format = book.format || csvFormat;

          await onAddBook(finalBook);
          newlyAdded.push({
            title: cleanNewTitle,
            author: cleanNewAuthor,
            isbn: cleanNewIsbn,
          });

          setExtractedBooks(prev =>
            prev.filter(
              b => !(b.title === book.title && b.author === book.author),
            ),
          );
          setSelectedExtracted(prev => {
            const next = new Set(prev);
            next.delete(`${book.title}::${book.author}`);
            return next;
          });
          return true;
        } catch (_error) {
          console.error(`Failed to add ${book.title}`, error);
          return false;
        } finally {
          setAddProgress(prev =>
            prev ? {...prev, current: prev.current + 1} : null,
          );
        }
      });

      const results = await Promise.all(batchPromises);
      addedCount += results.filter(r => r === true).length;
      duplicateCount += results.filter(r => r === 'duplicate').length;

      if (i + batchSize < booksToAdd.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setIsAdding(null);
    setIsAddingAll(false);
    setAddProgress(null);

    if (addedCount > 0) toast.success(`Successfully added ${addedCount} books`);
    if (duplicateCount > 0)
      toast.info(
        `Skipped ${duplicateCount} duplicate book${duplicateCount === 1 ? '' : 's'}`,
      );
    if (
      addedCount + duplicateCount !== booksToAdd.length &&
      booksToAdd.length > 0
    ) {
      toast.error(
        `Failed to add ${booksToAdd.length - addedCount - duplicateCount} books`,
      );
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (
      activeTab === 'camera' &&
      extractedBooks.length === 0 &&
      !isExtracting &&
      !isCameraActive
    ) {
      startCamera();
    }
  }, [activeTab, extractedBooks.length, isExtracting, isCameraActive]);

  return (
    <AppLayout
      sidebarActions={
        <Link
          to={backUrl}
          className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 font-serif text-lg tracking-tight"
        >
          <ArrowLeft className="w-5 h-5 text-outline flex-shrink-0" />
          <span>Back to Library</span>
        </Link>
      }
    >
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-8 min-w-0 max-w-[1200px] mx-auto w-full">
        <div className="mb-6 sm:mb-8 flex flex-col gap-4 border-b border-surface-variant pb-6 sm:pb-8">
          <div>
            <h2 className="font-headline-lg sm:font-headline-xl text-headline-lg sm:text-headline-xl text-primary-container mb-2 sm:mb-4">
              Add Books
            </h2>
            <p className="font-body-md sm:font-body-lg text-body-md sm:text-body-lg text-on-surface-variant max-w-2xl">
              Grow your library by searching, scanning, or importing your
              collections.
            </p>
          </div>
        </div>

        <div className="bg-surface rounded-2xl sm:rounded-[32px] w-full flex flex-col overflow-hidden shadow-sm border border-outline-variant/30 relative">
          <div className="px-4 sm:px-6 py-4 sm:py-5 bg-surface-container-lowest border-b border-outline-variant/30 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <span className="font-bold text-sm text-on-surface mb-1 sm:mb-0">
              Selected Method:
            </span>
            <div className="relative w-full sm:w-64" ref={dropdownRef}>
              <button
                data-testid="method-selector-trigger"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex w-full items-center justify-between gap-3 bg-surface border border-outline-variant/40 px-4 py-2.5 rounded-xl hover:border-primary/50 transition-colors shadow-sm focus:ring-2 focus:ring-primary/20 outline-none"
              >
                <div className="flex items-center gap-2 font-bold text-sm text-on-surface">
                  {activeTab === 'scan' && (
                    <>
                      <ScanBarcode size={18} className="text-primary" /> Scan
                      ISBN
                    </>
                  )}
                  {activeTab === 'camera' && (
                    <>
                      <Camera size={18} className="text-primary" /> Capture
                      Shelf
                    </>
                  )}
                  {activeTab === 'csv' && (
                    <>
                      <FileText size={18} className="text-primary" /> Import CSV
                    </>
                  )}
                  {activeTab === 'search' && (
                    <>
                      <Search size={18} className="text-primary" /> Search
                      Database
                    </>
                  )}
                  {activeTab === 'manual' && (
                    <>
                      <Plus size={18} className="text-primary" /> Manual Entry
                    </>
                  )}
                </div>
                <ChevronDown
                  size={16}
                  className={`text-outline transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {isDropdownOpen && (
                  <motion.div
                    initial={{opacity: 0, y: -5, scale: 0.98}}
                    animate={{opacity: 1, y: 0, scale: 1}}
                    exit={{opacity: 0, y: -5, scale: 0.98}}
                    transition={{duration: 0.15}}
                    className="absolute top-full left-0 right-0 mt-2 bg-surface border border-outline-variant/30 rounded-xl shadow-[0_8px_30px_rgb(26,47,75,0.12)] overflow-hidden z-20 py-1"
                  >
                    {[
                      {id: 'scan', label: 'Scan ISBN', icon: ScanBarcode},
                      {id: 'camera', label: 'Capture Shelf', icon: Camera},
                      {id: 'csv', label: 'Import CSV', icon: FileText},
                      {id: 'search', label: 'Search Database', icon: Search},
                      {id: 'manual', label: 'Manual Entry', icon: Plus},
                    ].map(tab => (
                      <button
                        key={tab.id}
                        data-testid={`method-option-${tab.id}`}
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 text-sm font-bold transition-colors ${activeTab === tab.id ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-variant/50 hover:text-on-surface'}`}
                        onClick={() => {
                          setActiveTab(tab.id as any);
                          if (tab.id === 'camera' || tab.id === 'scan')
                            stopCamera(); // Will be started appropriately by other effects if needed
                          else stopCamera();
                          // Specifically for camera
                          if (tab.id === 'camera') startCamera();
                          setIsDropdownOpen(false);
                        }}
                      >
                        <tab.icon
                          size={18}
                          className={
                            activeTab === tab.id
                              ? 'text-primary'
                              : 'text-outline'
                          }
                        />
                        {tab.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-surface-container-lowest custom-scrollbar min-h-[500px]">
            {activeTab === 'search' && (
              <div className="space-y-6">
                <form
                  onSubmit={handleSearch}
                  className="flex flex-col sm:flex-row gap-3"
                >
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search by title, author, or ISBN..."
                    className="flex-1 bg-surface-container/50 border border-outline-variant/60 rounded-full px-6 py-4 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium placeholder:text-on-surface-variant/60"
                  />
                  <button
                    type="submit"
                    disabled={isSearching}
                    className="bg-primary text-on-primary px-8 py-4 rounded-full hover:bg-primary/90 shadow-sm hover:shadow-md transition-all disabled:opacity-50 flex items-center justify-center sm:w-auto w-full font-bold flex-shrink-0"
                  >
                    {isSearching ? (
                      <Loader2 className="animate-spin" size={20} />
                    ) : (
                      'Search'
                    )}
                  </button>
                </form>

                <div className="space-y-4">
                  {hasSearched &&
                    searchResults.length === 0 &&
                    !isSearching && (
                      <div className="text-center py-12 bg-surface-container-low rounded-2xl shadow-sm border border-outline-variant/30">
                        <p className="text-on-surface font-medium">
                          No books found.
                        </p>
                        <p className="text-sm text-on-surface-variant mt-1">
                          Try adjusting your search terms.
                        </p>
                      </div>
                    )}
                  {searchResults.map((book, idx) => (
                    <div
                      key={idx}
                      className="bg-surface-container-low p-3 sm:p-4 rounded-2xl sm:rounded-3xl shadow-sm border border-outline-variant/30 flex gap-3 sm:gap-4 items-center hover:shadow-md hover:border-outline-variant/60 transition-all"
                    >
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="w-12 h-18 sm:w-16 sm:h-24 object-cover rounded-lg sm:rounded-xl shadow-[2px_4px_10px_rgb(26,47,75,0.1)]"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-12 h-18 sm:w-16 sm:h-24 bg-surface-container rounded-lg sm:rounded-xl flex items-center justify-center text-on-surface-variant border border-outline-variant/50">
                          <BookPlus
                            className="w-5 h-5 sm:w-6 sm:h-6"
                            strokeWidth={1.5}
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-serif font-bold text-sm sm:text-lg text-on-surface truncate tracking-tight">
                          {toTitleCase(book.title)}
                        </h4>
                        <p className="text-on-surface-variant text-xs sm:text-sm truncate mt-0.5 font-medium">
                          {toTitleCase(book.author)}
                        </p>
                        {book.publishedDate && (
                          <p className="text-outline text-[10px] sm:text-xs mt-1 sm:mt-1.5 truncate font-mono">
                            {book.publishedDate}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleAdd(book)}
                        disabled={isAdding === (book.isbn || book.title)}
                        className="bg-primary/10 text-primary px-4 py-2 sm:px-5 sm:py-2.5 rounded-full hover:bg-primary hover:text-on-primary transition-colors disabled:opacity-50 text-xs sm:text-sm font-bold whitespace-nowrap flex-shrink-0"
                      >
                        {isAdding === (book.isbn || book.title) ? (
                          <Loader2 className="animate-spin" size={18} />
                        ) : (
                          'Add'
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'scan' && (
              <div className="space-y-6 flex flex-col items-center">
                <div className="w-full max-w-md">
                  <BarcodeScanner
                    onScan={handleScanIsbn}
                    paused={isAddingAll}
                  />
                </div>

                {processingIsbns.size > 0 && (
                  <div className="flex items-center gap-2 text-primary bg-primary/10 px-4 py-2 rounded-full">
                    <Loader2 className="animate-spin" size={16} />
                    <span className="font-medium text-sm">
                      Searching for {processingIsbns.size} ISBN
                      {processingIsbns.size > 1 ? 's' : ''}...
                    </span>
                  </div>
                )}

                {scannedBooks.length > 0 && (
                  <div className="w-full space-y-4">
                    <div className="flex items-center justify-between sticky top-0 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-outline-variant/40 mb-2 rounded-t-xl -mx-2">
                      <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
                        Scanned {scannedBooks.length} Books
                      </h3>
                      <div className="flex gap-2 sm:gap-3 items-center">
                        <label className="hidden sm:flex items-center gap-2 text-sm font-bold text-on-surface cursor-pointer mr-2 hover:bg-surface-container-low/80 px-3 py-1.5 rounded-full transition-colors">
                          <input
                            type="checkbox"
                            checked={
                              selectedScanned.size === scannedBooks.length &&
                              scannedBooks.length > 0
                            }
                            onChange={e => {
                              if (e.target.checked)
                                setSelectedScanned(
                                  new Set(
                                    scannedBooks.map(b => b.isbn || b.title),
                                  ),
                                );
                              else setSelectedScanned(new Set());
                            }}
                            className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 cursor-pointer"
                          />
                          Select All
                        </label>
                        <button
                          onClick={() => {
                            setScannedBooks([]);
                            setSelectedScanned(new Set());
                          }}
                          className="p-2 sm:px-4 sm:py-2 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border border-transparent hover:border-outline-variant/60 rounded-full transition-colors"
                          title="Clear & Scan Again"
                        >
                          <span className="hidden sm:inline">Clear</span>
                          <X size={18} strokeWidth={2} className="sm:hidden" />
                        </button>
                        <button
                          onClick={handleAddSelectedScanned}
                          disabled={isAddingAll || selectedScanned.size === 0}
                          className="bg-primary text-on-primary px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                        >
                          {isAddingAll ? (
                            <Loader2 className="animate-spin" size={16} />
                          ) : (
                            <BookPlus size={16} strokeWidth={2.5} />
                          )}
                          <span className="hidden sm:inline">
                            Add Selected{' '}
                          </span>
                          ({selectedScanned.size})
                        </button>
                      </div>
                    </div>

                    <div className="w-full overflow-x-auto rounded-xl border border-outline-variant/40 bg-surface shadow-sm">
                      <table className="w-full text-left text-sm text-on-surface">
                        <thead className="bg-surface-container-low text-xs uppercase text-on-surface-variant">
                          <tr>
                            <th className="px-4 py-3 w-12 text-center">#</th>
                            <th className="px-4 py-3">Title</th>
                            <th className="px-4 py-3">Author</th>
                            <th className="px-4 py-3">ISBN</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/30">
                          {scannedBooks.map((book, idx) => (
                            <tr
                              key={idx}
                              className={`hover:bg-primary/5 transition-colors cursor-pointer ${selectedScanned.has(book.isbn || book.title) ? 'bg-primary/5' : ''}`}
                              onClick={() => toggleSelectScanned(book)}
                            >
                              <td className="px-4 py-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={selectedScanned.has(
                                    book.isbn || book.title,
                                  )}
                                  onChange={() => toggleSelectScanned(book)}
                                  onClick={e => e.stopPropagation()}
                                  className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 cursor-pointer"
                                />
                              </td>
                              <td className="px-4 py-3 font-medium text-on-surface flex items-center gap-2">
                                {isAdding === book.title && (
                                  <Loader2
                                    className="animate-spin text-primary flex-shrink-0"
                                    size={14}
                                  />
                                )}
                                {toTitleCase(book.title)}
                              </td>
                              <td className="px-4 py-3">
                                {toTitleCase(book.author)}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">
                                {book.isbn}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'camera' && (
              <div className="space-y-6 flex flex-col items-center">
                {!isExtracting && extractedBooks.length === 0 && (
                  <div className="w-full max-w-md aspect-[3/4] bg-on-surface rounded-3xl overflow-hidden relative shadow-[0_8px_30px_rgb(26,47,75,0.12)] border border-outline-variant/30">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {isCameraActive ? (
                      <div className="absolute bottom-4 sm:bottom-6 left-0 right-0 flex flex-col sm:flex-row justify-center items-center gap-2 sm:gap-3 px-4">
                        <button
                          onClick={captureAndExtract}
                          data-testid="capture-shelf-action"
                          className="bg-surface/95 backdrop-blur-md text-on-surface px-5 sm:px-6 py-2.5 sm:py-3 rounded-full font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] flex items-center gap-2 hover:bg-surface-container-low hover:scale-105 transition-all text-sm border border-outline-variant/40 w-full sm:w-auto justify-center"
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
                          className="bg-primary text-on-primary px-5 sm:px-6 py-2.5 sm:py-3 rounded-full font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] flex items-center gap-2 hover:bg-primary/90 hover:scale-105 transition-all text-sm border border-transparent w-full sm:w-auto justify-center"
                        >
                          <UploadCloud size={18} strokeWidth={2} /> Upload Photo
                        </button>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-surface/60 font-medium">
                        <Camera
                          size={48}
                          strokeWidth={1.5}
                          className="mb-4 opacity-40"
                        />
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
                          className="mt-6 bg-surface text-on-surface px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2 hover:bg-surface-container-low hover:scale-105 transition-all text-sm border border-outline-variant/40"
                        >
                          <UploadCloud size={18} strokeWidth={2} /> Upload Photo
                          instead
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isExtracting && (
                  <div className="py-24 flex flex-col items-center justify-center w-full bg-surface-container-low/30 rounded-3xl border border-outline-variant/40">
                    <div className="relative mb-6 text-primary">
                      <Loader2
                        className="animate-spin absolute inset-0"
                        size={56}
                        strokeWidth={1.5}
                      />
                      <Sparkles
                        className="animate-pulse"
                        size={56}
                        strokeWidth={1.5}
                      />
                    </div>
                    <h3 className="font-serif font-bold text-2xl text-on-surface tracking-tight mb-2">
                      Analyzing bookshelf...
                    </h3>
                    <p className="text-on-surface-variant font-medium text-center max-w-xs">
                      The AI Librarian is extracting book titles, authors, and
                      metadata from your image.
                    </p>
                  </div>
                )}

                {extractedBooks.length > 0 && (
                  <div className="w-full space-y-4">
                    <div className="flex items-center justify-between sticky top-0 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-outline-variant/40 mb-2 rounded-t-xl -mx-2">
                      <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
                        Found {extractedBooks.length} Books
                      </h3>
                      <div className="flex gap-2 sm:gap-3 items-center">
                        <label className="hidden sm:flex items-center gap-2 text-sm font-bold text-on-surface cursor-pointer mr-2 hover:bg-surface-container-low/80 px-3 py-1.5 rounded-full transition-colors">
                          <input
                            type="checkbox"
                            checked={
                              selectedExtracted.size ===
                                extractedBooks.length &&
                              extractedBooks.length > 0
                            }
                            onChange={toggleSelectAll}
                            className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 cursor-pointer"
                          />
                          Select All
                        </label>
                        <button
                          onClick={() => {
                            setExtractedBooks([]);
                            setSelectedExtracted(new Set());
                          }}
                          className="p-2 sm:px-4 sm:py-2 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border border-transparent hover:border-outline-variant/60 rounded-full transition-colors"
                          title="Clear & Scan Again"
                        >
                          <span className="hidden sm:inline">Clear</span>
                          <X size={18} strokeWidth={2} className="sm:hidden" />
                        </button>
                        <button
                          onClick={handleAddSelectedExtracted}
                          disabled={isAddingAll || selectedExtracted.size === 0}
                          className="bg-primary text-on-primary px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                        >
                          {isAddingAll ? (
                            <Loader2 className="animate-spin" size={16} />
                          ) : (
                            <BookPlus size={16} strokeWidth={2.5} />
                          )}
                          <span className="hidden sm:inline">
                            Add Selected{' '}
                          </span>
                          ({selectedExtracted.size})
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      {extractedBooks.map((book, idx) => (
                        <label
                          key={idx}
                          className={`bg-surface-container-low/60 p-3 sm:p-5 rounded-2xl sm:rounded-3xl border transition-all cursor-pointer flex gap-3 sm:gap-4 ${selectedExtracted.has(`${book.title}::${book.author}`) ? 'border-primary shadow-md bg-surface ring-1 ring-primary/20' : 'border-outline-variant/40 shadow-[0_2px_8px_rgb(26,47,75,0.02)] hover:shadow-md hover:border-outline-variant/80'}`}
                        >
                          <div className="pt-0.5 sm:pt-1">
                            <input
                              type="checkbox"
                              checked={selectedExtracted.has(
                                `${book.title}::${book.author}`,
                              )}
                              onChange={() => toggleSelect(book)}
                              className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 sm:w-5 sm:h-5 cursor-pointer mt-0.5"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {isAdding === book.title && (
                                <Loader2
                                  className="animate-spin text-primary flex-shrink-0"
                                  size={14}
                                />
                              )}
                              <h4
                                className="font-serif font-bold text-sm sm:text-lg text-on-surface truncate tracking-tight"
                                title={book.title}
                              >
                                {toTitleCase(book.title)}
                              </h4>
                            </div>
                            <p
                              className="text-on-surface-variant text-xs sm:text-sm truncate mt-0.5 font-medium"
                              title={book.author}
                            >
                              {toTitleCase(book.author)}
                            </p>
                            {book.isbn && book.isbn !== 'null' && (
                              <p className="text-outline text-xs mt-1.5 font-mono font-medium">
                                ISBN: {book.isbn}
                              </p>
                            )}
                            {book.genres && book.genres.length > 0 && (
                              <p className="text-on-surface-variant text-xs mt-2 font-bold bg-surface-variant inline-block px-2.5 py-1 rounded-full border border-outline-variant/30">
                                {book.genres[0]}
                              </p>
                            )}
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
                  <div className="bg-surface-container-lowest p-6 sm:p-12 rounded-3xl border-2 border-dashed border-outline-variant/60 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-surface-container-low rounded-full flex items-center justify-center text-primary mb-6 shadow-[0_2px_10px_rgb(26,47,75,0.04)] border border-outline-variant/40">
                      <UploadCloud
                        className="w-8 h-8 sm:w-10 sm:h-10"
                        strokeWidth={2}
                      />
                    </div>
                    <h3 className="text-2xl sm:text-3xl font-serif font-bold text-on-surface mb-3 tracking-tight">
                      Upload Library CSV
                    </h3>
                    <p className="text-on-surface-variant text-sm sm:text-base mb-6 max-w-md font-medium leading-relaxed">
                      Upload a CSV export from Goodreads, Amazon, or your own
                      spreadsheet. Our AI will automatically extract the titles,
                      authors, and ISBNs.
                    </p>

                    <div className="mb-8 w-full max-w-xs text-left">
                      <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1 text-center">
                        Default Format
                      </label>
                      <select
                        value={csvFormat}
                        onChange={e =>
                          setCsvFormat(e.target.value as 'physical' | 'digital')
                        }
                        className="w-full bg-surface-container border border-outline-variant/80 rounded-2xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium"
                      >
                        <option value="physical">Physical Books</option>
                        <option value="digital">Digital / E-Books</option>
                      </select>
                    </div>

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
                      className="bg-primary text-on-primary px-8 py-4 rounded-full hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-3 font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] hover:shadow-lg hover:-translate-y-0.5"
                    >
                      {isExtracting ? (
                        <>
                          <Loader2
                            className="animate-spin"
                            size={20}
                            strokeWidth={2.5}
                          />{' '}
                          {extractionStatus || 'Processing CSV...'}
                        </>
                      ) : (
                        <>
                          <FileText size={20} strokeWidth={2.5} /> Select CSV
                          File
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="w-full space-y-4">
                    <div className="flex flex-col gap-2 sticky top-0 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-outline-variant/40 mb-2 rounded-t-xl -mx-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
                          Found {extractedBooks.length} Books
                        </h3>
                        <div className="flex gap-2 sm:gap-3 items-center">
                          <label className="hidden sm:flex items-center gap-2 text-sm font-bold text-on-surface cursor-pointer mr-2 hover:bg-surface-container-low/80 px-3 py-1.5 rounded-full transition-colors">
                            <input
                              type="checkbox"
                              checked={
                                selectedExtracted.size ===
                                  extractedBooks.length &&
                                extractedBooks.length > 0
                              }
                              onChange={toggleSelectAll}
                              className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 cursor-pointer"
                            />
                            Select All
                          </label>
                          <button
                            onClick={() => {
                              setExtractedBooks([]);
                              setSelectedExtracted(new Set());
                            }}
                            className="p-2 sm:px-4 sm:py-2 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border border-transparent hover:border-outline-variant/60 rounded-full transition-colors"
                            title="Clear & Upload Again"
                          >
                            <span className="hidden sm:inline">Clear</span>
                            <X
                              size={18}
                              strokeWidth={2}
                              className="sm:hidden"
                            />
                          </button>
                          <button
                            onClick={handleAddSelectedExtracted}
                            disabled={
                              isAddingAll || selectedExtracted.size === 0
                            }
                            className="bg-primary text-on-primary px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                          >
                            {isAddingAll ? (
                              <Loader2 className="animate-spin" size={16} />
                            ) : (
                              <BookPlus size={16} strokeWidth={2.5} />
                            )}
                            <span className="hidden sm:inline">
                              Add Selected{' '}
                            </span>
                            ({selectedExtracted.size})
                          </button>
                        </div>
                      </div>
                      {addProgress !== null && (
                        <div className="w-full mt-2">
                          <div className="w-full bg-surface-container border border-outline-variant/40 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-primary h-full transition-all duration-300"
                              style={{
                                width: `${(addProgress.current / addProgress.total) * 100}%`,
                              }}
                            />
                          </div>
                          <p className="text-xs text-on-surface-variant text-center mt-1.5 font-medium">
                            Processing {addProgress.current} of{' '}
                            {addProgress.total} books...
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      {extractedBooks.map((book, idx) => (
                        <label
                          key={idx}
                          className={`bg-surface-container-low/60 p-3 sm:p-5 rounded-2xl sm:rounded-3xl border transition-all cursor-pointer flex gap-3 sm:gap-4 ${selectedExtracted.has(`${book.title}::${book.author}`) ? 'border-primary shadow-md bg-surface ring-1 ring-primary/20' : 'border-outline-variant/40 shadow-[0_2px_8px_rgb(26,47,75,0.02)] hover:shadow-md hover:border-outline-variant/80'}`}
                        >
                          <div className="pt-0.5 sm:pt-1">
                            <input
                              type="checkbox"
                              checked={selectedExtracted.has(
                                `${book.title}::${book.author}`,
                              )}
                              onChange={() => toggleSelect(book)}
                              className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 sm:w-5 sm:h-5 cursor-pointer mt-0.5"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {isAdding === book.title && (
                                <Loader2
                                  className="animate-spin text-primary flex-shrink-0"
                                  size={14}
                                />
                              )}
                              <h4
                                className="font-serif font-bold text-sm sm:text-lg text-on-surface truncate tracking-tight"
                                title={book.title}
                              >
                                {toTitleCase(book.title)}
                              </h4>
                            </div>
                            <p
                              className="text-on-surface-variant text-xs sm:text-sm truncate mt-0.5 font-medium"
                              title={book.author}
                            >
                              {toTitleCase(book.author)}
                            </p>
                            {book.isbn && book.isbn !== 'null' && (
                              <p className="text-outline text-xs mt-1.5 font-mono font-medium">
                                ISBN: {book.isbn}
                              </p>
                            )}
                            {book.genres && book.genres.length > 0 && (
                              <p className="text-on-surface-variant text-xs mt-2 font-bold bg-surface-variant inline-block px-2.5 py-1 rounded-full border border-outline-variant/30">
                                {book.genres[0]}
                              </p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'manual' && (
              <div className="space-y-6 sm:space-y-8 bg-surface-container-low/30 p-3 sm:p-6 rounded-xl sm:rounded-3xl border border-outline-variant/30 mt-2 sm:mt-4">
                <div className="flex flex-col items-center mb-6">
                  {isCoverCameraActive ? (
                    <div className="w-full max-w-sm mx-auto aspect-[3/4] bg-on-surface rounded-3xl overflow-hidden relative shadow-[0_8px_30px_rgb(26,47,75,0.12)] border border-outline-variant/20 mb-4">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                      />
                      <canvas ref={canvasRef} className="hidden" />
                      <button
                        onClick={captureCover}
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-surface/95 backdrop-blur-md text-on-surface px-6 py-3 rounded-full font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] flex items-center gap-2 hover:bg-surface-container-low hover:scale-105 transition-all text-sm whitespace-nowrap border border-outline-variant/40"
                      >
                        <Camera size={18} strokeWidth={2} /> Capture Cover
                      </button>
                      <button
                        onClick={() => {
                          stopCamera();
                          setIsCoverCameraActive(false);
                        }}
                        className="absolute top-4 right-4 p-2 bg-on-surface text-surface rounded-full hover:bg-on-surface/90 transition-colors shadow-md border outline-none"
                      >
                        <X size={20} strokeWidth={2.5} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      {manualBook.coverUrl ? (
                        <div className="relative group">
                          <img
                            src={manualBook.coverUrl}
                            alt="Cover"
                            className="w-32 h-48 object-cover rounded-xl shadow-[2px_4px_12px_rgb(26,47,75,0.1)] border border-outline-variant/40"
                          />
                          <button
                            onClick={() =>
                              setManualBook(prev => ({...prev, coverUrl: ''}))
                            }
                            className="absolute -top-3 -right-3 p-2 bg-error text-on-error rounded-full opacity-0 group-hover:opacity-100 transition-all hover:scale-110 shadow-md"
                          >
                            <X size={14} strokeWidth={2.5} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setIsCoverCameraActive(true);
                            startCamera();
                          }}
                          className="w-32 h-48 bg-surface-container/50 border-2 border-dashed border-outline-variant/60 rounded-2xl flex flex-col items-center justify-center text-on-surface-variant hover:text-on-surface hover:border-primary/40 transition-all shadow-sm hover:shadow-md"
                        >
                          <Camera
                            size={32}
                            className="mb-3 opacity-60"
                            strokeWidth={1.5}
                          />
                          <span className="text-sm font-bold text-center px-4 leading-tight">
                            Take Cover
                            <br />
                            Photo
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1">
                        Title *
                      </label>
                      <input
                        type="text"
                        value={manualBook.title}
                        onChange={e =>
                          setManualBook(prev => ({
                            ...prev,
                            title: e.target.value,
                          }))
                        }
                        className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1">
                        Author *
                      </label>
                      <input
                        type="text"
                        value={manualBook.author}
                        onChange={e =>
                          setManualBook(prev => ({
                            ...prev,
                            author: e.target.value,
                          }))
                        }
                        className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1">
                        Genres
                      </label>
                      <input
                        type="text"
                        value={manualBook.genres?.join(', ') || ''}
                        onChange={e =>
                          setManualBook(prev => ({
                            ...prev,
                            genres: e.target.value
                              .split(',')
                              .map((g: string) => g.trim())
                              .filter(Boolean),
                          }))
                        }
                        className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1">
                        Series
                      </label>
                      <input
                        type="text"
                        value={manualBook.series || ''}
                        onChange={e =>
                          setManualBook(prev => ({
                            ...prev,
                            series: e.target.value,
                          }))
                        }
                        className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1">
                        ISBN
                      </label>
                      <input
                        type="text"
                        value={manualBook.isbn || ''}
                        onChange={e =>
                          setManualBook(prev => ({
                            ...prev,
                            isbn: e.target.value,
                          }))
                        }
                        className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1">
                        Published Date
                      </label>
                      <input
                        type="text"
                        placeholder="e.g., 2023 or YYYY-MM-DD"
                        value={manualBook.publishedDate || ''}
                        onChange={e =>
                          setManualBook(prev => ({
                            ...prev,
                            publishedDate: e.target.value,
                          }))
                        }
                        className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1">
                        Format *
                      </label>
                      <select
                        value={manualBook.format || 'physical'}
                        onChange={e =>
                          setManualBook(prev => ({
                            ...prev,
                            format: e.target.value as 'physical' | 'digital',
                          }))
                        }
                        className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium"
                      >
                        <option value="physical">Physical Book</option>
                        <option value="digital">Digital / E-Book</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1">
                      Description
                    </label>
                    <textarea
                      value={manualBook.description || ''}
                      onChange={e =>
                        setManualBook(prev => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium min-h-[120px] resize-y"
                    />
                  </div>

                  <button
                    onClick={handleManualAdd}
                    disabled={
                      !manualBook.title.trim() ||
                      !manualBook.author.trim() ||
                      isAdding === 'manual'
                    }
                    className="w-full bg-primary text-on-primary px-8 py-4 rounded-full hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] hover:shadow-lg hover:-translate-y-0.5 mt-8"
                  >
                    {isAdding === 'manual' ? (
                      <Loader2
                        className="animate-spin"
                        size={24}
                        strokeWidth={2.5}
                      />
                    ) : (
                      'Add Book to Library'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
