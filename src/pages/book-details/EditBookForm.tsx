import React, {useState} from 'react';
import {Save, Loader2} from 'lucide-react';
import {doc, updateDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {toast} from 'sonner';
import {Book, BookDetailsPayload} from '../../types';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import {Button} from '../../components/ui/button';
import {Input} from '../../components/ui/input';
import {Label} from '../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

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

const editBookSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  author: z.string().min(1, 'Author is required').max(500),
  format: z.enum(['physical', 'digital']),
  isbn: z.string().optional(),
  genresInput: z.string().optional(),
  publishedDate: z.string().optional(),
  series: z.string().max(100).optional(),
  coverUrl: z.string().optional(),
});

type EditBookFormValues = z.infer<typeof editBookSchema>;

export function EditBookForm({
  libraryId,
  book,
  bookBase,
  bookDetails,
  setBookBase,
  setBookDetails,
  onClose,
}: EditBookFormProps) {
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: {errors},
  } = useForm<EditBookFormValues>({
    resolver: zodResolver(editBookSchema),
    defaultValues: {
      title: book?.title || '',
      author: book?.author || '',
      isbn: book?.isbn || '',
      format: book?.format || 'physical',
      publishedDate: book?.publishedDate || '',
      coverUrl: book?.coverUrl || '',
      genresInput:
        book?.genres && book?.genres.length > 0 ? book.genres.join(', ') : '',
      series: book?.series || '',
    },
  });

  const formatValue = watch('format');

  const onSubmit = async (data: EditBookFormValues) => {
    if (!book || !libraryId) return;

    const originalBookBase = bookBase ? {...bookBase} : null;
    const originalBookDetails = bookDetails ? {...bookDetails} : null;

    setIsSavingDetails(true);
    try {
      const cleanForm: Partial<Book & BookDetailsPayload> = {
        title: data.title,
        author: data.author,
        format: data.format,
        isbn: data.isbn,
        publishedDate: data.publishedDate,
        series: data.series,
        coverUrl: data.coverUrl,
      };

      if (data.genresInput) {
        cleanForm.genres = data.genresInput
          .split(',')
          .map(g => g.trim())
          .filter(Boolean)
          .slice(0, 20);
      }

      // Remove undefined or empty values
      Object.keys(cleanForm).forEach(key => {
        const k = key as keyof typeof cleanForm;
        if (cleanForm[k] === undefined || cleanForm[k] === '') {
          delete cleanForm[k];
        }
      });

      // Optimistic update
      setBookBase(prev => (prev ? ({...prev, ...cleanForm} as Book) : null));
      onClose();

      await updateDoc(
        doc(db, 'libraries', libraryId, 'books', book.id),
        cleanForm,
      );

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
    <Dialog open={true} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b border-outline-variant/30 shrink-0">
          <DialogTitle className="text-xl font-serif font-medium text-ink tracking-tight">
            Edit Book Details
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="space-y-1">
              <Label
                htmlFor="title"
                className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant"
              >
                Title
              </Label>
              <Input
                id="title"
                className="bg-surface-container"
                {...register('title')}
              />
              {errors.title && (
                <p className="text-xs text-error">{errors.title.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="author"
                className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant"
              >
                Author
              </Label>
              <Input
                id="author"
                className="bg-surface-container"
                {...register('author')}
              />
              {errors.author && (
                <p className="text-xs text-error">{errors.author.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant">
                  Format
                </Label>
                <Select
                  value={formatValue}
                  onValueChange={(val: 'physical' | 'digital') =>
                    setValue('format', val)
                  }
                >
                  <SelectTrigger className="bg-surface-container">
                    <SelectValue placeholder="Format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="physical">Physical</SelectItem>
                    <SelectItem value="digital">Digital</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="isbn"
                  className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant"
                >
                  ISBN
                </Label>
                <Input
                  id="isbn"
                  className="bg-surface-container"
                  {...register('isbn')}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label
                  htmlFor="genresInput"
                  className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant"
                >
                  Genres (comma separated)
                </Label>
                <Input
                  id="genresInput"
                  className="bg-surface-container"
                  {...register('genresInput')}
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="publishedDate"
                  className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant"
                >
                  Published Date
                </Label>
                <Input
                  id="publishedDate"
                  className="bg-surface-container"
                  {...register('publishedDate')}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="series"
                className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant"
              >
                Series Name
              </Label>
              <Input
                id="series"
                className="bg-surface-container"
                {...register('series')}
              />
              {errors.series && (
                <p className="text-xs text-error">{errors.series.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="coverUrl"
                className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant"
              >
                Cover Image URL
              </Label>
              <Input
                id="coverUrl"
                className="bg-surface-container"
                {...register('coverUrl')}
              />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-outline-variant/30 shrink-0 gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSavingDetails}>
              {isSavingDetails ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
