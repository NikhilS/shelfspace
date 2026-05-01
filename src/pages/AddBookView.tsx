/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
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
import {enrichBooksMetadata} from '../services/gemini';
import {toast} from 'sonner';
import {toTitleCase} from '../lib/utils';
import {motion, AnimatePresence} from 'motion/react';
import {useParams, Link, useLocation} from 'react-router-dom';
import {
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
  doc,
  onSnapshot,
  increment,
  updateDoc,
} from 'firebase/firestore';
import {db} from '../firebase';
import {useAuth} from '../contexts/AuthContext';
import SidebarActions from '../components/SidebarActions';
import BarcodeScanner from '../components/BarcodeScanner';
import CameraScanner from '../components/CameraScanner';
import BulkImport from '../components/BulkImport';
import CoverCamera from '../components/CoverCamera';
import pLimit from 'p-limit';

import BookSearch from '../components/BookSearch';
import CSVImportTab from '../components/CSVImportTab';

export default function AddBookView() {
  const {id: libraryId} = useParams<{id: string}>();
  const location = useLocation();
  const {user} = useAuth();

  const backUrl = location.state?.from || `/library/${libraryId}`;

  const [activeTab, setActiveTab] = useState<
    'scan' | 'search' | 'camera' | 'csv' | 'manual'
  >('scan');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [isAddingAll, setIsAddingAll] = useState(false);

  const [existingBooks, setExistingBooks] = useState<BookDetails[]>([]);
  const [processingIsbns, setProcessingIsbns] = useState<Set<string>>(
    new Set(),
  );
  const [scannedBooks, setScannedBooks] = useState<BookDetails[]>([]);
  const [selectedScanned, setSelectedScanned] = useState<Set<string>>(
    new Set(),
  );
  const [extractedBooks, setExtractedBooks] = useState<BookDetails[]>([]);
  const [selectedExtracted, setSelectedExtracted] = useState<Set<string>>(
    new Set(),
  );
  const [isExtracting, setIsExtracting] = useState(false);

  const [allowDuplicates, setAllowDuplicates] = useState(true);

  useEffect(() => {
    if (!libraryId) return;
    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const unsubscribe = onSnapshot(
      booksRef,
      snap => {
        const books = snap.docs.map(doc => doc.data() as BookDetails);
        setExistingBooks(books);
      },
      err => {
        console.error('Failed to load existing books:', err);
      },
    );
    return () => unsubscribe();
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

  const addBooks = async (booksToAddFast: BookDetails[]) => {
    if (!libraryId || !user) throw new Error('Library or user not found');
    if (booksToAddFast.length === 0) return;

    // 1. Enrich missing series in batched format via gemini API
    const enrichedBooks = booksToAddFast.map(book => ({
      ...book,
      format: book.format || 'physical',
    }));
    const booksMissingSeriesArr = enrichedBooks
      .map((b, i) => ({
        id: i.toString(),
        title: b.title || '',
        author: b.author || '',
        description: b.description || '',
      }))
      .filter(
        b => b.title && enrichedBooks[parseInt(b.id)].series === undefined,
      );

    if (booksMissingSeriesArr.length > 0) {
      try {
        const enrichments = await enrichBooksMetadata(booksMissingSeriesArr);
        if (enrichments.length > 0) {
          const enrichMap = new Map(enrichments.map(e => [e.id, e.series]));
          for (const b of booksMissingSeriesArr) {
            const series = enrichMap.get(b.id);
            if (series) {
              const idx = parseInt(b.id);
              if (idx >= 0 && idx < enrichedBooks.length) {
                enrichedBooks[idx].series = series;
              }
            }
          }
        }
      } catch (error) {
        console.warn('Failed to enrich metadata on batch add');
      }
    }

    // 2. Prepare cleanly sized payloads and use writeBatch
    const finalCleanBooks: BookDetails[] = [];
    for (let i = 0; i < enrichedBooks.length; i += 500) {
      const batchList = enrichedBooks.slice(i, i + 500);
      const batchRef = writeBatch(db);

      for (const enrichedDetails of batchList) {
        const cleanDetails = Object.fromEntries(
          Object.entries(enrichedDetails).filter(
            ([, v]) => v !== undefined && v !== null && v !== '',
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

        const newDocRef = doc(collection(db, 'libraries', libraryId, 'books'));

        // Split heavy data from lightweight data
        const {
          synopsis,
          description,
          authorBio,
          embedding,
          clusterCoordinates,
          genres,
          ...lightweightData
        } = cleanDetails;

        batchRef.set(newDocRef, {
          ...lightweightData,
          addedBy: user.uid,
          addedAt: serverTimestamp(),
        });

        // Write heavy payload to bookDetails subcollection
        const heavyData = {
          synopsis,
          description,
          authorBio,
          embedding,
          clusterCoordinates,
          genres,
        };
        // Clean out undefined values to avoid Firebase errors
        const cleanHeavyData = Object.fromEntries(
          Object.entries(heavyData).filter(([_, v]) => v !== undefined),
        );

        if (Object.keys(cleanHeavyData).length > 0) {
          const detailRef = doc(
            db,
            'libraries',
            libraryId,
            'bookDetails',
            newDocRef.id,
          );
          batchRef.set(detailRef, cleanHeavyData);
        }

        finalCleanBooks.push(enrichedDetails);
      }
      await batchRef.commit();
    }

    if (finalCleanBooks.length > 0 && libraryId) {
      await updateDoc(doc(db, 'libraries', libraryId), {
        bookCount: increment(finalCleanBooks.length),
      });
    }

    setExistingBooks(prev => [...prev, ...finalCleanBooks]);
  };

  const handleAdd = async (book: BookDetails) => {
    const cleanNewIsbn = (book.isbn || '').trim().replace(/[^0-9X]/gi, '');
    const cleanNewTitle = (book.title || '').trim().toLowerCase();
    const cleanNewAuthor = (book.author || '').trim().toLowerCase();

    if (
      !allowDuplicates &&
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
      await addBooks([bookToAdd]);
      toast.success(`Added ${bookToAdd.title}`);
    } catch (error) {
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
    } catch (error) {
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
        await addBooks([b]);
        successCount++;
      } catch (error) {
        console.error('Error in AddBookView');
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

  const toggleSelectExtracted = (book: BookDetails) => {
    const next = new Set(selectedExtracted);
    const key = book.isbn || book.title;
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedExtracted(next);
  };

  const toggleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked)
      setSelectedExtracted(new Set(extractedBooks.map(b => b.isbn || b.title)));
    else setSelectedExtracted(new Set());
  };

  const handleAddSelectedExtracted = async () => {
    setIsAddingAll(true);
    let successCount = 0;
    const booksToAdd = extractedBooks.filter(b =>
      selectedExtracted.has(b.isbn || b.title),
    );

    for (const b of booksToAdd) {
      try {
        await addBooks([b]);
        successCount++;
      } catch (error) {
        console.error('Failed to add extracted book', error);
      }
    }

    toast.success(
      `Successfully added ${successCount} out of ${booksToAdd.length} books`,
    );
    setExtractedBooks(prev =>
      prev.filter(b => !selectedExtracted.has(b.isbn || b.title)),
    );
    setSelectedExtracted(new Set());
    setIsAddingAll(false);
  };

  const handleManualAdd = async () => {
    if (!manualBook.title.trim() || !manualBook.author.trim()) return;
    const cleanNewIsbn = (manualBook.isbn || '')
      .trim()
      .replace(/[^0-9X]/gi, '');
    const cleanNewTitle = manualBook.title.trim().toLowerCase();
    const cleanNewAuthor = manualBook.author.trim().toLowerCase();

    if (
      !allowDuplicates &&
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
      await addBooks([manualBook]);
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
    } catch (error) {
      toast.error('Failed to add book');
    } finally {
      setIsAdding(null);
    }
  };

  return (
    <>
      <SidebarActions>
        <Link
          to={backUrl}
          className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
          <span>Back to Library</span>
        </Link>
      </SidebarActions>
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

            <label className="flex items-center gap-2 cursor-pointer ml-auto text-sm text-on-surface-variant mt-2 sm:mt-0">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary/50"
                checked={allowDuplicates}
                onChange={e => setAllowDuplicates(e.target.checked)}
              />
              Allow duplicates
            </label>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-surface-container-lowest custom-scrollbar min-h-[500px]">
            {activeTab === 'search' && (
              <BookSearch
                existingBooks={existingBooks}
                allowDuplicates={allowDuplicates}
                onAdd={handleAdd}
              />
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
                {extractedBooks.length === 0 && (
                  <CameraScanner
                    onBooksExtracted={books => {
                      setExtractedBooks(books);
                      setSelectedExtracted(
                        new Set(books.map((b: any) => b.isbn || b.title)),
                      );
                    }}
                    isExtracting={isExtracting}
                    setIsExtracting={setIsExtracting}
                  />
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
              <CSVImportTab
                allowDuplicates={allowDuplicates}
                existingBooks={existingBooks}
                addBooks={addBooks}
              />
            )}

            {activeTab === 'manual' && (
              <div className="space-y-6 sm:space-y-8 bg-surface-container-low/30 p-3 sm:p-6 rounded-xl sm:rounded-3xl border border-outline-variant/30 mt-2 sm:mt-4">
                <div className="flex flex-col items-center mb-6">
                  {isCoverCameraActive ? (
                    <CoverCamera
                      onCapture={base64Image => {
                        setManualBook(prev => ({
                          ...prev,
                          coverUrl: base64Image,
                        }));
                        setIsCoverCameraActive(false);
                      }}
                      onCancel={() => setIsCoverCameraActive(false)}
                    />
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
                          onClick={() => setIsCoverCameraActive(true)}
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
    </>
  );
}
