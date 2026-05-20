import React, {useState} from 'react';
import {BookDetails} from '../../services/bookApi';
import CoverCamera from '../../components/CoverCamera';
import {Camera, X, Loader2} from 'lucide-react';
import {toast} from 'sonner';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Input} from '../../components/ui/input';
import {Label} from '../../components/ui/label';
import {Button} from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  triggerHaptics,
  toSentenceCase,
  normalizeTitle,
  normalizeName,
  normalizeIsbn,
  normalizeText,
} from '../../lib/utils';

interface ManualEntryTabProps {
  existingBooks: BookDetails[];
  allowDuplicates: boolean;
  addBooks: (books: BookDetails[]) => Promise<BookDetails[] | void | undefined>;
}

const manualEntrySchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  author: z.string().min(1, 'Author is required').max(500),
  format: z.enum(['physical', 'digital']),
  isbn: z.string().optional(),
  genresInput: z.string().optional(),
  publishedDate: z.string().optional(),
  series: z.string().max(100).optional(),
  synopsis: z.string().optional(),
});

type ManualEntryFormValues = z.infer<typeof manualEntrySchema>;

export function ManualEntryTab({
  existingBooks,
  allowDuplicates,
  addBooks,
}: ManualEntryTabProps) {
  const [coverUrl, setCoverUrl] = useState<string>('');
  const [isCoverCameraActive, setIsCoverCameraActive] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: {errors, isValid},
  } = useForm<ManualEntryFormValues>({
    resolver: zodResolver(manualEntrySchema),
    defaultValues: {
      title: '',
      author: '',
      isbn: '',
      genresInput: '',
      series: '',
      synopsis: '',
      publishedDate: '',
      format: 'physical',
    },
    mode: 'onChange',
  });

  const formatValue = watch('format');

  const onSubmit = async (data: ManualEntryFormValues) => {
    const cleanNewIsbn = (data.isbn || '').trim().replace(/[^0-9X]/gi, '');
    const cleanNewTitle = data.title.trim().toLowerCase();
    const cleanNewAuthor = data.author.trim().toLowerCase();

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
      triggerHaptics([50, 100, 50]);
      toast.info(`Skipped duplicate: ${data.title}`);
      return;
    }

    setIsAdding(true);
    try {
      const newBook: BookDetails = {
        title: normalizeTitle(data.title),
        author: normalizeName(data.author),
        isbn: normalizeIsbn(data.isbn),
        series: normalizeText(data.series),
        synopsis: normalizeText(data.synopsis),
        publishedDate: data.publishedDate || '',
        format: data.format,
        coverUrl,
        genres: data.genresInput
          ? data.genresInput
              .split(',')
              .map(g => toSentenceCase(g.trim()))
              .filter(Boolean)
          : [],
      };

      await addBooks([newBook]);
      triggerHaptics([30, 50, 30]);
      toast.success(`Added ${newBook.title}`);
      reset();
      setCoverUrl('');
    } catch {
      triggerHaptics([50, 100, 50]);
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
              setCoverUrl(base64Image);
              setIsCoverCameraActive(false);
            }}
            onCancel={() => setIsCoverCameraActive(false)}
          />
        ) : (
          <div className="flex flex-col items-center">
            {coverUrl ? (
              <div className="relative group">
                <img
                  src={coverUrl}
                  alt="Cover"
                  className="w-32 h-48 object-cover rounded-xl shadow-[2px_4px_12px_rgb(26,47,75,0.1)] border border-outline-variant/40"
                />
                <button
                  type="button"
                  onClick={() => setCoverUrl('')}
                  className="absolute -top-3 -right-3 p-2 bg-error text-on-error rounded-full opacity-0 group-hover:opacity-100 transition-all hover:scale-110 shadow-md"
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <button
                type="button"
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

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1">
            <Label
              htmlFor="title"
              className="text-sm font-bold text-on-surface ml-1"
            >
              Title *
            </Label>
            <Input
              id="title"
              className="bg-surface-container-low/60 border-outline-variant/80 rounded-2xl px-5 py-6 font-medium"
              {...register('title')}
            />
            {errors.title && (
              <p className="text-xs text-error mt-1">{errors.title.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="author"
              className="text-sm font-bold text-on-surface ml-1"
            >
              Author *
            </Label>
            <Input
              id="author"
              className="bg-surface-container-low/60 border-outline-variant/80 rounded-2xl px-5 py-6 font-medium"
              {...register('author')}
            />
            {errors.author && (
              <p className="text-xs text-error mt-1">{errors.author.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="space-y-1">
            <Label
              htmlFor="genresInput"
              className="text-sm font-bold text-on-surface ml-1"
            >
              Genres
            </Label>
            <Input
              id="genresInput"
              className="bg-surface-container-low/60 border-outline-variant/80 rounded-2xl px-5 py-6 font-medium"
              {...register('genresInput')}
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="series"
              className="text-sm font-bold text-on-surface ml-1"
            >
              Series
            </Label>
            <Input
              id="series"
              className="bg-surface-container-low/60 border-outline-variant/80 rounded-2xl px-5 py-6 font-medium"
              {...register('series')}
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="isbn"
              className="text-sm font-bold text-on-surface ml-1"
            >
              ISBN
            </Label>
            <Input
              id="isbn"
              className="bg-surface-container-low/60 border-outline-variant/80 rounded-2xl px-5 py-6 font-medium font-mono text-sm"
              {...register('isbn')}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1">
            <Label
              htmlFor="publishedDate"
              className="text-sm font-bold text-on-surface ml-1"
            >
              Published Date
            </Label>
            <Input
              id="publishedDate"
              placeholder="e.g., 2023 or YYYY-MM-DD"
              className="bg-surface-container-low/60 border-outline-variant/80 rounded-2xl px-5 py-6 font-medium"
              {...register('publishedDate')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-bold text-on-surface ml-1">
              Format *
            </Label>
            <Select
              value={formatValue}
              onValueChange={(val: 'physical' | 'digital') =>
                setValue('format', val)
              }
            >
              <SelectTrigger className="w-full bg-surface-container-low/60 border-outline-variant/80 rounded-2xl px-5 py-6 font-medium">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="physical">Physical Book</SelectItem>
                <SelectItem value="digital">Digital / E-Book</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label
            htmlFor="synopsis"
            className="text-sm font-bold text-on-surface ml-1"
          >
            Synopsis
          </Label>
          <textarea
            id="synopsis"
            className="w-full bg-surface-container-low/60 border border-outline-variant/80 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium min-h-[120px] resize-y"
            {...register('synopsis')}
          />
        </div>

        <Button
          type="submit"
          disabled={!isValid || isAdding}
          className="w-full rounded-full h-14 text-base font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] hover:shadow-lg hover:-translate-y-0.5 mt-8 disabled:opacity-50"
        >
          {isAdding ? (
            <Loader2
              className="animate-spin mr-2"
              size={24}
              strokeWidth={2.5}
            />
          ) : null}
          {isAdding ? 'Adding Book...' : 'Add Book to Library'}
        </Button>
      </form>
    </div>
  );
}
