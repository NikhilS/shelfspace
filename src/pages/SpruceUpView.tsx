/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {useMemo, useState, useEffect} from 'react';
import {useParams, Link} from 'react-router-dom';
import SidebarActions from '../components/SidebarActions';
import {
  collection,
  doc,
  deleteDoc,
  updateDoc,
  addDoc,
  onSnapshot,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {
  BookDetails,
  searchBookByIsbn,
  searchBookByTitleAndAuthor,
} from '../services/bookApi';
import {searchWikipediaForBook} from '../services/wikipediaApi';
import {Loader2, Trash2, Wand2, EyeOff, ArrowLeft} from 'lucide-react';
import {motion} from 'motion/react';
import {toast} from 'sonner';

export default function SpruceUpView() {
  const {id: libraryId} = useParams<{id: string}>();
  const [books, setBooks] = useState<(BookDetails & {id: string})[]>([]);
  const [allowedDuplicateGroups, setAllowedDuplicateGroups] = useState<
    string[][]
  >([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>(
    {},
  );
  const [fixingAll, setFixingAll] = useState(false);

  useEffect(() => {
    if (!libraryId) return;

    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const unsubscribeBooks = onSnapshot(
      booksRef,
      booksSnap => {
        const loaded = booksSnap.docs.map(
          doc => ({...doc.data(), id: doc.id}) as BookDetails & {id: string},
        );
        setBooks(loaded);
        setLoading(false); // Can be false if books loads first, but that's fine
      },
      error => {
        console.error('Failed to load books in SpruceUpView: ', error);
        toast.error('Failed to load data');
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/books`,
        );
        setLoading(false);
      },
    );

    const allowedRef = collection(
      db,
      'libraries',
      libraryId,
      'allowedDuplicates',
    );
    const unsubscribeAllowed = onSnapshot(
      allowedRef,
      allowedSnap => {
        const allowed = allowedSnap.docs.map(
          doc => (doc.data().bookIds || []) as string[],
        );
        setAllowedDuplicateGroups(allowed);
      },
      error => {
        console.error(
          'Failed to load allowed duplicates in SpruceUpView: ',
          error,
        );
        toast.error('Failed to load data');
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/allowedDuplicates`,
        );
      },
    );

    return () => {
      unsubscribeBooks();
      unsubscribeAllowed();
    };
  }, [libraryId]);

  const duplicates = useMemo(() => {
    const dupes: Record<string, (BookDetails & {id: string})[]> = {};
    const seen: Record<string, BookDetails & {id: string}> = {};

    for (const b of books) {
      const cleanIsbn = (b.isbn || '').trim().replace(/[^0-9X]/gi, '');
      const cleanTitle = (b.title || '').trim().toLowerCase();
      const cleanAuthor = (b.author || '').trim().toLowerCase();
      const format = b.format;

      // Find if it matches any existing seen book
      let matchedKey = null;
      for (const [key, seenBook] of Object.entries(seen)) {
        const seenCleanIsbn = (seenBook.isbn || '')
          .trim()
          .replace(/[^0-9X]/gi, '');
        const seenCleanTitle = (seenBook.title || '').trim().toLowerCase();
        const seenCleanAuthor = (seenBook.author || '').trim().toLowerCase();
        const seenFormat = seenBook.format;

        const hasSameIsbn =
          cleanIsbn && seenCleanIsbn && cleanIsbn === seenCleanIsbn;
        const hasSameTitleAndAuthor =
          cleanTitle &&
          cleanAuthor &&
          cleanTitle === seenCleanTitle &&
          cleanAuthor === seenCleanAuthor;

        const formatConflict = format && seenFormat && format !== seenFormat;

        if ((hasSameIsbn || hasSameTitleAndAuthor) && !formatConflict) {
          matchedKey = key;
          break;
        }
      }

      if (matchedKey) {
        if (!dupes[matchedKey]) {
          dupes[matchedKey] = [seen[matchedKey]];
        }
        dupes[matchedKey].push(b);
      } else {
        const newKey = b.id;
        seen[newKey] = b;
      }
    }

    // Filter out groups where all book IDs are fully contained in one of the allowed groups
    return Object.values(dupes).filter(group => {
      const groupIds = group.map(b => b.id);
      const isAllowed = allowedDuplicateGroups.some(allowedGroup =>
        groupIds.every(id => allowedGroup.includes(id)),
      );
      return !isAllowed;
    });
  }, [books, allowedDuplicateGroups]);

  const missingMetadata = useMemo(() => {
    return books.filter(b => {
      // Check if critical metadata is missing
      return (
        !b.coverUrl ||
        !b.description ||
        !b.publishedDate ||
        !b.genres ||
        b.genres.length === 0
      );
    });
  }, [books]);

  const handleDelete = async (id: string) => {
    if (!libraryId) return;
    try {
      setProcessingIds(prev => ({...prev, [id]: true}));
      await deleteDoc(doc(db, 'libraries', libraryId, 'books', id));
      setBooks(prev => prev.filter(b => b.id !== id));
      toast.success('Book deleted');
    } catch (error) {
      toast.error('Failed to delete book');
      handleFirestoreError(
        error,
        OperationType.DELETE,
        `libraries/${libraryId}/books/${id}`,
      );
    } finally {
      setProcessingIds(prev => ({...prev, [id]: false}));
    }
  };

  const handleFixMetadata = async (b: BookDetails & {id: string}) => {
    if (!libraryId) return;
    try {
      setProcessingIds(prev => ({...prev, [b.id]: true}));

      let enriched: BookDetails | null = null;

      if (b.isbn) {
        enriched = await searchBookByIsbn(b.isbn);
      }
      if (!enriched && b.title && b.author) {
        const results = await searchBookByTitleAndAuthor(b.title, b.author);
        enriched = results[0] || null;
      }

      // Merge properties
      const newData: any = {};
      if (enriched) {
        if (!b.coverUrl && enriched.coverUrl)
          newData.coverUrl = enriched.coverUrl;
        if (!b.description && enriched.description)
          newData.description = enriched.description;
        if (!b.publishedDate && enriched.publishedDate)
          newData.publishedDate = enriched.publishedDate;
        if (
          (!b.genres || b.genres.length === 0) &&
          enriched.genres &&
          enriched.genres.length > 0
        )
          newData.genres = enriched.genres;
      }

      // Fallback to Wikipedia if description is still missing
      if (!newData.description && !b.description && b.title) {
        const wpDesc = await searchWikipediaForBook(b.title, b.author);
        if (wpDesc) {
          newData.description = wpDesc;
        }
      }

      if (Object.keys(newData).length > 0) {
        await updateDoc(
          doc(db, 'libraries', libraryId!, 'books', b.id),
          newData,
        );
        setBooks(prev =>
          prev.map(bookItem =>
            bookItem.id === b.id ? {...bookItem, ...newData} : bookItem,
          ),
        );
        toast.success(`Updated metadata for ${b.title}`);
      } else {
        toast.info(`No missing metadata could be found for ${b.title}`);
      }
    } catch (error) {
      toast.error('Failed to fix metadata');
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `libraries/${libraryId}/books/${b.id}`,
      );
    } finally {
      setProcessingIds(prev => ({...prev, [b.id]: false}));
    }
  };

  const handleAllowDuplicateGroup = async (
    group: (BookDetails & {id: string})[],
  ) => {
    if (!libraryId) return;
    try {
      const bookIds = group.map(b => b.id);
      await addDoc(
        collection(db, 'libraries', libraryId, 'allowedDuplicates'),
        {
          bookIds,
          createdAt: Date.now(),
        },
      );
      setAllowedDuplicateGroups(prev => [...prev, bookIds]);
      toast.success('Duplicate suggestion dismissed');
    } catch (error) {
      toast.error('Failed to dismiss suggestion');
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `libraries/${libraryId}/allowedDuplicates`,
      );
    }
  };

  const handleFixAllMetadata = async () => {
    if (fixingAll) return;
    setFixingAll(true);
    let successCount = 0;

    try {
      const concurrencyLimit = 5;
      for (let i = 0; i < missingMetadata.length; i += concurrencyLimit) {
        const chunk = missingMetadata.slice(i, i + concurrencyLimit);

        // Update processingIds to show spinners for all chunk items
        const newProcessingIds: Record<string, boolean> = {};
        chunk.forEach(b => (newProcessingIds[b.id] = true));
        setProcessingIds(prev => ({...prev, ...newProcessingIds}));

        await Promise.all(
          chunk.map(async b => {
            try {
              let enriched: BookDetails | null = null;
              if (b.isbn) enriched = await searchBookByIsbn(b.isbn);
              if (!enriched && b.title && b.author) {
                const results = await searchBookByTitleAndAuthor(
                  b.title,
                  b.author,
                );
                enriched = results[0] || null;
              }

              const newData: any = {};
              if (enriched) {
                if (!b.coverUrl && enriched.coverUrl)
                  newData.coverUrl = enriched.coverUrl;
                if (!b.description && enriched.description)
                  newData.description = enriched.description;
                if (!b.publishedDate && enriched.publishedDate)
                  newData.publishedDate = enriched.publishedDate;
                if (
                  (!b.genres || b.genres.length === 0) &&
                  enriched.genres &&
                  enriched.genres.length > 0
                )
                  newData.genres = enriched.genres;
              }

              if (!newData.description && !b.description && b.title) {
                const wpDesc = await searchWikipediaForBook(b.title, b.author);
                if (wpDesc) newData.description = wpDesc;
              }

              if (Object.keys(newData).length > 0) {
                await updateDoc(
                  doc(db, 'libraries', libraryId!, 'books', b.id),
                  newData,
                );
                setBooks(prev =>
                  prev.map(bookItem =>
                    bookItem.id === b.id ? {...bookItem, ...newData} : bookItem,
                  ),
                );
                successCount++;
              }
            } catch (error) {
              console.error('Error fixing metadata for', b.title, error);
              handleFirestoreError(
                error,
                OperationType.UPDATE,
                `libraries/${libraryId}/books/${b.id}`,
              );
            } finally {
              setProcessingIds(prev => ({...prev, [b.id]: false}));
            }
          }),
        );
      }
    } finally {
      setFixingAll(false);
      if (successCount > 0) {
        toast.success(`Fixed metadata for ${successCount} books`);
      }
    }
  };

  return (
    <>
      <SidebarActions>
        <Link
          to={`/library/${libraryId}`}
          className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
          <span>Back to Library</span>
        </Link>
      </SidebarActions>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-display text-on-surface mb-2">
          Spruce Up Library
        </h1>
        <p className="text-on-surface-variant max-w-2xl mb-8">
          Find and fix issues with your library, such as duplicate entries and
          missing metadata.
        </p>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 bg-surface-container-low rounded-2xl border border-surface-variant relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03] mix-blend-overlay"></div>
            <Loader2 className="w-10 h-10 animate-[spin_3s_linear_infinite] text-primary relative z-10" />
            <p className="text-on-surface-variant font-mono text-sm uppercase tracking-widest relative z-10 text-center px-4">
              Scanning volumes for anomalies...
              <br />
              <span className="text-xs opacity-60 normal-case tracking-normal font-sans">
                Dusting off the shelves
              </span>
            </p>
          </div>
        ) : (
          <motion.div
            initial={{opacity: 0, y: 10}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.4}}
            className="flex flex-col gap-12"
          >
            <section>
              <h2 className="text-xl font-bold text-on-surface mb-4">
                Potentially Duplicate Books
              </h2>
              {duplicates.length === 0 ? (
                <p className="text-on-surface-variant">
                  No duplicates found. Looking good!
                </p>
              ) : (
                <div className="flex flex-col gap-6">
                  {duplicates.map((group, idx) => (
                    <div
                      key={idx}
                      className="bg-surface-container border border-outline-variant rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-medium text-lg">
                          Group {idx + 1}: {group[0].title}
                        </h3>
                        <button
                          onClick={() => handleAllowDuplicateGroup(group)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-on-surface-variant hover:text-on-surface bg-transparent hover:bg-surface-variant/50 rounded-md transition-colors"
                        >
                          <EyeOff className="w-4 h-4" />
                          Ignore
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {group.map(b => (
                          <div
                            key={b.id}
                            className="bg-surface border border-outline-variant/50 p-4 rounded-lg flex flex-col justify-between"
                          >
                            <div>
                              <p className="font-bold">{b.title}</p>
                              <p className="text-sm text-on-surface-variant">
                                {b.author}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-semibold bg-primary-container text-on-primary-container uppercase tracking-wider">
                                  {b.format || 'Physical'}
                                </span>
                              </div>
                              {b.isbn && (
                                <p className="text-xs text-on-surface-variant mt-2">
                                  ISBN: {b.isbn}
                                </p>
                              )}
                              <p className="text-xs text-on-surface-variant mt-1 text-opacity-80 truncate">
                                Cover: {b.coverUrl ? 'Yes' : 'No'} | Desc:{' '}
                                {b.description ? 'Yes' : 'No'}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDelete(b.id)}
                              disabled={processingIds[b.id]}
                              className="mt-4 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
                            >
                              {processingIds[b.id] ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                              Delete this duplicate
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-on-surface">
                  Books with Missing Metadata
                </h2>
                {missingMetadata.length > 0 && (
                  <button
                    onClick={handleFixAllMetadata}
                    disabled={fixingAll}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {fixingAll ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    Fix All Missing Metadata
                  </button>
                )}
              </div>
              {missingMetadata.length === 0 ? (
                <p className="text-on-surface-variant">
                  All books have complete metadata. Wow!
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {missingMetadata.map(b => (
                    <div
                      key={b.id}
                      className="bg-surface-container border border-outline-variant rounded-xl p-4 flex flex-col justify-between"
                    >
                      <div>
                        <p className="font-bold">{b.title}</p>
                        <p className="text-sm text-on-surface-variant">
                          {b.author}
                        </p>
                        <ul className="text-xs text-error mt-2 list-disc list-inside">
                          {!b.coverUrl && <li>Missing Cover</li>}
                          {!b.description && <li>Missing Description</li>}
                          {!b.publishedDate && <li>Missing Published Date</li>}
                          {(!b.genres || b.genres.length === 0) && (
                            <li>Missing Genres</li>
                          )}
                        </ul>
                      </div>
                      <button
                        onClick={() => handleFixMetadata(b)}
                        disabled={processingIds[b.id]}
                        className="mt-4 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
                      >
                        {processingIds[b.id] ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Wand2 className="w-4 h-4" />
                        )}
                        Fix Metadata
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </motion.div>
        )}
      </div>
    </>
  );
}
