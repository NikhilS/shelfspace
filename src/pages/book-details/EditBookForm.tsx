import React, {useState} from 'react';
import {motion} from 'motion/react';
import {X, Save, Loader2} from 'lucide-react';
import {doc, updateDoc, setDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {toast} from 'sonner';
import {BookDetails} from '../../services/bookApi';
import {Book, BookDetailsPayload} from '../../types';

interface EditBookFormProps {
  libraryId: string;
  book: Book;
  bookBase: Book | null;
  bookDetails: BookDetailsPayload | null;
  setBookBase: React.Dispatch<React.SetStateAction<Book | null>>;
  setBookDetails: React.Dispatch<
    React.SetStateAction<BookDetailsPayload | null>
  >;
  onClose: () => void;
}

export function EditBookForm({
  libraryId,
  book,
  bookBase,
  bookDetails,
  setBookBase,
  setBookDetails,
  onClose,
}: EditBookFormProps) {
  const [editForm, setEditForm] = useState<
    Partial<BookDetails> & {genresInput?: string}
  >({
    title: book?.title || '',
    author: book?.author || '',
    isbn: book?.isbn || '',
    format: book?.format || 'physical',
    publishedDate: book?.publishedDate || '',
    coverUrl: book?.coverUrl || '',
    genresInput:
      book?.genres && book?.genres.length > 0 ? book.genres.join(', ') : '',
    series: book?.series || '',
  });
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  const handleSaveDetails = async () => {
    if (!book || !libraryId) return;

    const originalBookBase = bookBase ? {...bookBase} : null;
    const originalBookDetails = bookDetails ? {...bookDetails} : null;

    setIsSavingDetails(true);
    try {
      const cleanForm: Record<string, string | string[] | undefined> =
        Object.fromEntries(
          Object.entries(editForm).filter(
            ([, v]) => v !== undefined && v !== null && v !== '',
          ),
        );
      if (cleanForm.genresInput && typeof cleanForm.genresInput === 'string') {
        cleanForm.genres = cleanForm.genresInput
          .split(',')
          .map((g: string) => g.trim())
          .filter(Boolean)
          .slice(0, 20);
        delete cleanForm.genresInput;
      }
      if (typeof cleanForm.author === 'string')
        cleanForm.author = Array.from(cleanForm.author).slice(0, 500).join('');
      if (typeof cleanForm.series === 'string')
        cleanForm.series = Array.from(cleanForm.series).slice(0, 100).join('');
      if (typeof cleanForm.title === 'string')
        cleanForm.title = Array.from(cleanForm.title).slice(0, 500).join('');

      const {
        synopsis,
        authorBio,
        embedding,
        clusterCoordinates,
        ...lightweightData
      } = cleanForm;

      // Optimistic update
      setBookBase(prev =>
        prev ? ({...prev, ...lightweightData} as Book) : null,
      );
      setBookDetails(prev => ({
        ...prev,
        synopsis: synopsis as string | undefined,
        authorBio: authorBio as string | undefined,
        embedding: embedding as number[] | undefined,
        clusterCoordinates: clusterCoordinates as
          | {x: number; y: number}
          | undefined,
      }));
      onClose();

      if (Object.keys(lightweightData).length > 0) {
        await updateDoc(
          doc(db, 'libraries', libraryId, 'books', book.id),
          lightweightData,
        );
      }

      const heavyData: BookDetailsPayload = {
        synopsis: synopsis as string | undefined,
        authorBio: authorBio as string | undefined,
        embedding: embedding as number[] | undefined,
        clusterCoordinates: clusterCoordinates as
          | {x: number; y: number}
          | undefined,
      };
      const cleanHeavyData = Object.fromEntries(
        Object.entries(heavyData).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(cleanHeavyData).length > 0) {
        await updateDoc(
          doc(db, 'libraries', libraryId, 'bookDetails', book.id),
          cleanHeavyData,
        ).catch(async () => {
          // If document doesn't exist yet, we must set it instead of update
          await setDoc(
            doc(db, 'libraries', libraryId, 'bookDetails', book.id),
            cleanHeavyData,
            {merge: true},
          );
        });
      }

      toast.success('Book details updated');
    } catch (error) {
      setBookBase(originalBookBase);
      setBookDetails(originalBookDetails);
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `libraries/${libraryId}/books/${book.id}`,
      );
    } finally {
      setIsSavingDetails(false);
    }
  };

  return (
    <motion.div
      initial={{opacity: 0}}
      animate={{opacity: 1}}
      exit={{opacity: 0}}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 font-sans text-left overflow-y-auto"
    >
      <motion.div
        initial={{y: 20, opacity: 0}}
        animate={{y: 0, opacity: 1}}
        exit={{y: 20, opacity: 0}}
        className="bg-surface rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-[0px_10px_40px_rgba(0,0,0,0.1)] border border-surface-variant my-8 flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-serif font-medium text-ink tracking-tight">
            Edit Book Details
          </h3>
          <button
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface p-1 rounded-full hover:bg-surface-container"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar pb-4 space-y-4">
          <div>
            <label className="block text-xs font-label-caps uppercase tracking-wider text-on-surface-variant mb-1">
              Title
            </label>
            <input
              value={editForm.title}
              onChange={e => setEditForm({...editForm, title: e.target.value})}
              className="w-full px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-label-caps uppercase tracking-wider text-on-surface-variant mb-1">
              Author
            </label>
            <input
              value={editForm.author}
              onChange={e => setEditForm({...editForm, author: e.target.value})}
              className="w-full px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-label-caps uppercase tracking-wider text-on-surface-variant mb-1">
                Format
              </label>
              <select
                value={editForm.format}
                onChange={e =>
                  setEditForm({
                    ...editForm,
                    format: e.target.value as 'physical' | 'digital',
                  })
                }
                className="w-full px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary appearance-none"
              >
                <option value="physical">Physical</option>
                <option value="digital">Digital</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-label-caps uppercase tracking-wider text-on-surface-variant mb-1">
                ISBN
              </label>
              <input
                value={editForm.isbn}
                onChange={e => setEditForm({...editForm, isbn: e.target.value})}
                className="w-full px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-label-caps uppercase tracking-wider text-on-surface-variant mb-1">
                Genres (comma separated)
              </label>
              <input
                value={editForm.genresInput || ''}
                onChange={e =>
                  setEditForm({...editForm, genresInput: e.target.value})
                }
                className="w-full px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-label-caps uppercase tracking-wider text-on-surface-variant mb-1">
                Published Date
              </label>
              <input
                value={editForm.publishedDate}
                onChange={e =>
                  setEditForm({
                    ...editForm,
                    publishedDate: e.target.value,
                  })
                }
                className="w-full px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-label-caps uppercase tracking-wider text-on-surface-variant mb-1">
              Series Name
            </label>
            <input
              value={editForm.series}
              onChange={e => setEditForm({...editForm, series: e.target.value})}
              className="w-full px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-label-caps uppercase tracking-wider text-on-surface-variant mb-1">
              Cover Image URL
            </label>
            <input
              value={editForm.coverUrl}
              onChange={e =>
                setEditForm({...editForm, coverUrl: e.target.value})
              }
              className="w-full px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-md text-sm text-on-surface focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="pt-4 border-t border-outline-variant/30 flex justify-end gap-3 mt-auto">
          <button
            onClick={onClose}
            className="px-4 py-2 text-on-surface hover:bg-surface-container rounded-md font-medium text-sm transition-colors border border-outline-variant/30"
          >
            Cancel
          </button>
          <button
            disabled={isSavingDetails}
            onClick={handleSaveDetails}
            className="px-4 py-2 bg-primary text-on-primary hover:bg-primary/90 rounded-md font-medium text-sm transition-colors shadow-sm flex items-center gap-2"
          >
            {isSavingDetails ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Changes
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
