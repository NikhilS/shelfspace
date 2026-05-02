import React, {useState} from 'react';
import {BookDetails} from '../../services/bookApi';
import CoverCamera from '../../components/CoverCamera';
import {Camera, X, Loader2} from 'lucide-react';
import {toast} from 'sonner';

interface ManualEntryTabProps {
  existingBooks: BookDetails[];
  allowDuplicates: boolean;
  addBooks: (books: BookDetails[]) => Promise<void>;
}

export function ManualEntryTab({
  existingBooks,
  allowDuplicates,
  addBooks,
}: ManualEntryTabProps) {
  const [manualBook, setManualBook] = useState<BookDetails>({
    title: '',
    author: '',
    isbn: '',
    genres: [],
    series: '',
    synopsis: '',
    publishedDate: '',
    coverUrl: '',
    format: 'physical',
  });
  const [isCoverCameraActive, setIsCoverCameraActive] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

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

    setIsAdding(true);
    try {
      await addBooks([manualBook]);
      toast.success(`Added ${manualBook.title}`);
      setManualBook({
        title: '',
        author: '',
        isbn: '',
        genres: [],
        series: '',
        synopsis: '',
        publishedDate: '',
        coverUrl: '',
        format: 'physical',
      });
    } catch {
      toast.error('Failed to add book');
    } finally {
      setIsAdding(false);
    }
  };

  return (
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
            Synopsis
          </label>
          <textarea
            value={manualBook.synopsis || ''}
            onChange={e =>
              setManualBook(prev => ({
                ...prev,
                synopsis: e.target.value,
              }))
            }
            className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium min-h-[120px] resize-y"
          />
        </div>

        <button
          onClick={handleManualAdd}
          disabled={
            !manualBook.title.trim() || !manualBook.author.trim() || isAdding
          }
          className="w-full bg-primary text-on-primary px-8 py-4 rounded-full hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] hover:shadow-lg hover:-translate-y-0.5 mt-8"
        >
          {isAdding ? (
            <Loader2 className="animate-spin" size={24} strokeWidth={2.5} />
          ) : (
            'Add Book to Library'
          )}
        </button>
      </div>
    </div>
  );
}
