import React, {useState, useRef, useEffect} from 'react';
import {
  Camera,
  FileText,
  Plus,
  ArrowLeft,
  ScanBarcode,
  ChevronDown,
  Search,
} from 'lucide-react';
import {BookDetails} from '../services/bookApi';
import {toast} from 'sonner';
import {motion, AnimatePresence} from 'motion/react';
import {useParams, Link, useLocation} from 'react-router-dom';
import {collection, onSnapshot} from 'firebase/firestore';
import {db} from '../firebase';
import {useAddBooks} from './add-book/useAddBooks';
import SidebarActions from '../components/SidebarActions';

import BookSearch from '../components/BookSearch';
import CSVImportTab from '../components/CSVImportTab';
import {ScanISBNTab} from './add-book/ScanISBNTab';
import {CaptureShelfTab} from './add-book/CaptureShelfTab';
import {ManualEntryTab} from './add-book/ManualEntryTab';

export default function AddBookView() {
  const {id: libraryId} = useParams<{id: string}>();
  const location = useLocation();

  const backUrl = location.state?.from || `/library/${libraryId}`;

  const [activeTab, setActiveTab] = useState<
    'scan' | 'search' | 'camera' | 'csv' | 'manual'
  >('scan');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [existingBooks, setExistingBooks] = useState<BookDetails[]>([]);

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

  const {addBooks, isAddingAll} = useAddBooks(libraryId);

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
    } catch {
      toast.error('Failed to add book');
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
                          setActiveTab(
                            tab.id as
                              | 'scan'
                              | 'search'
                              | 'camera'
                              | 'csv'
                              | 'manual',
                          );
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
              <ScanISBNTab addBooks={addBooks} isAddingAll={isAddingAll} />
            )}

            {activeTab === 'camera' && (
              <CaptureShelfTab addBooks={addBooks} isAddingAll={isAddingAll} />
            )}

            {activeTab === 'csv' && (
              <CSVImportTab
                allowDuplicates={allowDuplicates}
                existingBooks={existingBooks}
                addBooks={addBooks}
              />
            )}

            {activeTab === 'manual' && (
              <ManualEntryTab
                existingBooks={existingBooks}
                allowDuplicates={allowDuplicates}
                addBooks={addBooks}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
