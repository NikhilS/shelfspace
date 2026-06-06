import React, {useState, useEffect} from 'react';
import {
  Save,
  Loader2,
  Trash2,
  Camera,
  Sparkles,
  Link,
  AlertTriangle,
  Check,
  BookOpen,
} from 'lucide-react';
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
import {
  toSentenceCase,
  normalizeTitle,
  normalizeName,
  normalizeIsbn,
  normalizeText,
} from '../../lib/utils';
import CoverCamera from '../../components/CoverCamera';
import {applyNanobananaFlash} from '../../lib/nanobanana';
import {useCoverHarvester} from './useCoverHarvester';
import {useGenreSuggestor} from './useGenreSuggestor';

interface EditBookFormProps {
  libraryId: string;
  book: Book;
  bookBase: Book | null;
  bookDetails: BookDetailsPayload | null;
  updateBook: (cleanForm: Partial<Book & BookDetailsPayload>) => Promise<void>;
  updateBookOptimistically: (
    partialBook: Partial<Book & BookDetailsPayload>,
  ) => void;
  onClose: () => void;
  onDelete?: () => Promise<void>;
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
  coverUrlRaw: z.string().optional(),
});

type EditBookFormValues = z.infer<typeof editBookSchema>;

export function EditBookForm({
  libraryId,
  book,
  bookBase,
  bookDetails,
  updateBook,
  updateBookOptimistically,
  onClose,
  onDelete,
}: EditBookFormProps) {
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isDeletingInProgress, setIsDeletingInProgress] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  // Cover image management
  const [activeCoverUrl, setActiveCoverUrl] = useState(book?.coverUrl || '');
  const [registeredRawCover, setRegisteredRawCover] = useState(
    book?.coverUrlRaw || '',
  );
  const [isCameraActive, setIsCameraActive] = useState(false);

  const {coverSources, isSearchingCovers, setCoverSources} =
    useCoverHarvester(book);

  // Nanobanana flash states
  const [useNanobananaFlash, setUseNanobananaFlash] = useState(false);
  const [isProcessingFlash, setIsProcessingFlash] = useState(false);
  const [flashLog, setFlashLog] = useState('');

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
      coverUrlRaw: book?.coverUrlRaw || '',
      genresInput:
        book?.genres && book?.genres.length > 0 ? book.genres.join(', ') : '',
      series: book?.series || '',
    },
  });

  const formatValue = watch('format');
  const manualCoverUrl = watch('coverUrl');

  // Sync back to form state when activeCoverUrl changes
  useEffect(() => {
    setValue('coverUrl', activeCoverUrl);
  }, [activeCoverUrl, setValue]);

  const {suggestedGenres, isSearchingGenres} = useGenreSuggestor(book);

  // Watch genres input to determine current selection state
  const genresInputValue = watch('genresInput') || '';

  const isGenreSelected = (genre: string) => {
    const selected = genresInputValue
      .split(',')
      .map(g => g.trim().toLowerCase())
      .filter(Boolean);
    return selected.includes(genre.trim().toLowerCase());
  };

  const toggleGenre = (genre: string) => {
    const currentGenres = genresInputValue
      .split(',')
      .map(g => g.trim())
      .filter(Boolean);

    const normalizedGenre = toSentenceCase(genre.trim());
    const index = currentGenres.findIndex(
      g => g.toLowerCase() === normalizedGenre.toLowerCase(),
    );

    let newGenres: string[];
    if (index >= 0) {
      newGenres = currentGenres.filter((_, idx) => idx !== index);
    } else {
      newGenres = [...currentGenres, normalizedGenre];
    }

    setValue('genresInput', newGenres.join(', '), {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  // Handle camera capture callback
  const handleCaptureImage = (base64Data: string) => {
    setRegisteredRawCover(base64Data);
    setValue('coverUrlRaw', base64Data);

    const runCleanFlow = async () => {
      if (useNanobananaFlash) {
        setIsProcessingFlash(true);
        setFlashLog('Detecting book cover boundaries...');
        await new Promise(r => setTimeout(r, 400));
        setFlashLog('Calibrating brightness & color contrast...');
        await new Promise(r => setTimeout(r, 400));
        setFlashLog('Running Curator Lens™ straightening engine...');
        try {
          const cleaned = await applyNanobananaFlash(base64Data, {
            straighten: true,
            contrast: 1.25,
            brightness: 1.05,
          });
          setActiveCoverUrl(cleaned);
          // Add custom source
          setCoverSources(prev => [
            {
              id: 'captured-cleaned',
              url: cleaned,
              label: 'Cleaned Photo',
              description: 'Curator Lens™ applied',
            },
            {
              id: 'captured-raw',
              url: base64Data,
              label: 'Raw Camera Photo',
              description: 'Original camera snapshot',
            },
            ...prev.filter(
              s => s.id !== 'captured-cleaned' && s.id !== 'captured-raw',
            ),
          ]);
        } catch {
          toast.error('Clean up process encountered an error');
          setActiveCoverUrl(base64Data);
        } finally {
          setIsProcessingFlash(false);
          setFlashLog('');
        }
      } else {
        setActiveCoverUrl(base64Data);
        setCoverSources(prev => [
          {
            id: 'captured-raw',
            url: base64Data,
            label: 'Camera Photo',
            description: 'Unprocessed snapshot',
          },
          ...prev.filter(s => s.id !== 'captured-raw'),
        ]);
      }
    };

    void runCleanFlow();
    setIsCameraActive(false);
  };

  // Toggle Curator Lens™ processing on/off for current raw image
  const handleToggleNanobanana = async (checked: boolean) => {
    setUseNanobananaFlash(checked);
    if (!registeredRawCover) return;

    if (checked) {
      setIsProcessingFlash(true);
      setFlashLog('Detecting book cover boundaries...');
      await new Promise(r => setTimeout(r, 300));
      setFlashLog('Aligning crop perspective...');
      await new Promise(r => setTimeout(r, 350));
      setFlashLog('Boosting levels & ambient sharpness...');
      try {
        const cleaned = await applyNanobananaFlash(registeredRawCover, {
          straighten: true,
          contrast: 1.25,
          brightness: 1.05,
        });
        setActiveCoverUrl(cleaned);
        setCoverSources(prev => [
          {
            id: 'captured-cleaned',
            url: cleaned,
            label: 'Cleaned Photo',
            description: 'Curator Lens™ applied',
          },
          ...prev.filter(s => s.id !== 'captured-cleaned'),
        ]);
        toast.success('Cover enhanced with Curator Lens™!');
      } catch (err) {
        console.error(err);
        toast.error('Could not apply enhancement');
      } finally {
        setIsProcessingFlash(false);
        setFlashLog('');
      }
    } else {
      // Revert to raw image
      setActiveCoverUrl(registeredRawCover);
      toast.info('Reverted to raw camera photo');
    }
  };

  const onSubmit = async (data: EditBookFormValues) => {
    if (!book || !libraryId) return;

    const originalBookBase = bookBase ? {...bookBase} : null;
    const originalBookDetails = bookDetails ? {...bookDetails} : null;

    setIsSavingDetails(true);
    try {
      const cleanForm: Partial<Book & BookDetailsPayload> = {
        title: normalizeTitle(data.title),
        author: normalizeName(data.author),
        format: data.format,
        isbn: normalizeIsbn(data.isbn),
        publishedDate: data.publishedDate,
        series: normalizeText(data.series),
        coverUrl: activeCoverUrl || data.coverUrl,
        coverUrlRaw: registeredRawCover || data.coverUrlRaw,
      };

      if (data.genresInput) {
        cleanForm.genres = data.genresInput
          .split(',')
          .map(g => toSentenceCase(g.trim()))
          .filter(Boolean)
          .slice(0, 20);
      }

      // Remove undefined values
      Object.keys(cleanForm).forEach(key => {
        const k = key as keyof typeof cleanForm;
        if (cleanForm[k] === undefined) {
          delete cleanForm[k];
        }
      });

      // Optimistic update
      updateBookOptimistically(cleanForm);
      onClose();

      await updateBook(cleanForm);
      toast.success('Book details updated successfully');
    } catch {
      updateBookOptimistically({...originalBookBase, ...originalBookDetails});
      toast.error('Failed to update book details');
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!onDelete) return;
    setIsDeletingInProgress(true);
    try {
      await onDelete();
    } catch {
      setIsDeletingInProgress(false);
      setShowDeleteConfirmation(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-hidden flex flex-col p-0 bg-surface text-ink border border-outline-variant/30 transition-all shadow-[0_12px_45px_-8px_rgba(15,23,42,0.22)]">
        {/* INLINE DELETE CONFIRMATION SCREEN */}
        {showDeleteConfirmation ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-surface animate-in fade-in zoom-in duration-200">
            <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mb-6 border border-error/20">
              <AlertTriangle size={32} />
            </div>
            <h3 className="font-serif text-2xl font-medium tracking-tight mb-3">
              Delete "{toSentenceCase(book.title)}"
            </h3>
            <p className="text-on-surface-variant max-w-md text-sm leading-relaxed mb-8">
              Are you sure you want to remove this book from your library? This
              will permanently delete the record and all reviews. This
              transaction cannot be undone.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
              <Button
                variant="outline"
                className="flex-1 text-sm outline-none font-medium h-11"
                onClick={() => setShowDeleteConfirmation(false)}
                disabled={isDeletingInProgress}
              >
                No, Keep Book
              </Button>
              <Button
                variant="destructive"
                className="flex-1 text-sm font-medium h-11 flex items-center justify-center gap-2"
                onClick={handleDeleteConfirm}
                disabled={isDeletingInProgress}
              >
                {isDeletingInProgress ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                Yes, Delete Book
              </Button>
            </div>
          </div>
        ) : (
          /* MAIN FORM LAYOUT */
          <>
            <DialogHeader className="px-6 py-4.5 border-b border-outline-variant/25 shrink-0 flex flex-row items-center justify-between">
              <div className="space-y-0.5">
                <DialogTitle className="text-xl font-serif font-medium text-ink leading-tight tracking-tight">
                  Edit Book Details
                </DialogTitle>
                <p className="text-xs text-on-surface-variant">
                  Update taxonomy, categories, or customize the cover image.
                </p>
              </div>
            </DialogHeader>

            <form
              onSubmit={handleSubmit(onSubmit)}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
                  {/* LEFT COLUMN: ACTIVE COVER & COVERS HARVESTER */}
                  <div className="md:col-span-5 flex flex-col gap-5">
                    <Label className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant">
                      Book Cover Studio
                    </Label>

                    {/* Camera view or image viewer container */}
                    <div className="relative aspect-[2/3] max-w-[180px] w-full mx-auto bg-surface-container-low rounded-2xl border border-outline-variant/35 overflow-hidden shadow-sm flex flex-col justify-between">
                      {isCameraActive ? (
                        <div className="absolute inset-0 z-10 flex flex-col bg-on-surface">
                          <CoverCamera
                            onCapture={handleCaptureImage}
                            onCancel={() => setIsCameraActive(false)}
                          />
                        </div>
                      ) : isProcessingFlash ? (
                        <div className="absolute inset-0 bg-surf-container-high/80 z-10 flex flex-col items-center justify-center p-6 text-center">
                          <div className="relative w-full h-full overflow-hidden flex flex-col items-center justify-center gap-4">
                            {/* Animated Yellow Scanner Laser Bar */}
                            <div className="absolute top-0 left-0 right-0 h-1.5 bg-yellow-400 opacity-90 shadow-[0_0_15px_rgba(234,179,8,0.7)] rounded-full animate-pulse" />
                            <Loader2 className="w-10 h-10 animate-spin text-primary" />
                            <div className="space-y-1">
                              <p className="text-sm font-semibold tracking-tight text-ink">
                                Curator Lens™ Active
                              </p>
                              <p className="text-xs text-on-surface-variant italic animate-pulse">
                                {flashLog}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {/* Display Current Live Active Cover */}
                      {activeCoverUrl ? (
                        <img
                          src={activeCoverUrl}
                          alt="Cover Selector Preview"
                          className="w-full h-full object-cover rounded-2xl"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <BookOpen size={24} />
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              No cover image URL
                            </p>
                            <p className="text-xs text-on-surface-variant mt-1">
                              Paste an address, pick an harvested match, or take
                              a live snap.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Action trigger overlay over active cover */}
                      {!isCameraActive && !isProcessingFlash && (
                        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 z-10">
                          <Button
                            type="button"
                            size="sm"
                            className="flex-1 bg-surface/90 text-on-surface hover:bg-surface/100 backdrop-blur-md shadow-sm border border-outline-variant/30 text-xs font-semibold h-9"
                            onClick={() => setIsCameraActive(true)}
                          >
                            <Camera size={14} className="mr-1.5" />
                            Take Photo
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* CURATOR LENS SWITCH */}
                    {registeredRawCover && (
                      <div className="flex items-center justify-between p-3.5 rounded-xl bg-primary/5 border border-primary/15 animate-in fade-in duration-300">
                        <div className="flex items-start gap-2.5">
                          <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                          <div>
                            <Label
                              className="text-sm font-medium text-ink block leading-tight cursor-pointer"
                              htmlFor="nanobanana-toggle"
                            >
                              Curator Lens™ Enhancer
                            </Label>
                            <p className="text-xs text-on-surface-variant leading-relaxed">
                              Straightens perspective and cleans margins using
                              canvas geometry.
                            </p>
                          </div>
                        </div>
                        <input
                          id="nanobanana-toggle"
                          type="checkbox"
                          checked={useNanobananaFlash}
                          onChange={e => {
                            void handleToggleNanobanana(e.target.checked);
                          }}
                          className="w-5 h-5 accent-primary rounded cursor-pointer shrink-0 ml-3"
                        />
                      </div>
                    )}

                    {/* SOURCE LIST SELECTOR (Cycling Through Covers) */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                          Harvested Cover Sources
                        </Label>
                        {isSearchingCovers && (
                          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                            Querying APIs...
                          </div>
                        )}
                      </div>

                      {coverSources.length === 0 && !isSearchingCovers ? (
                        <p className="text-xs text-on-surface-variant leading-relaxed py-2 italic border border-dashed border-outline-variant/30 p-3 rounded-lg">
                          No direct API search thumbnails metadata resolved.
                          Provide an ISBN above to search candidates
                          automatically.
                        </p>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 max-h-[140px] overflow-y-auto p-1 border border-outline-variant/20 rounded-lg bg-surface-container-lowest">
                          {coverSources.map(source => {
                            const isSelected = activeCoverUrl === source.url;
                            return (
                              <button
                                key={source.id}
                                type="button"
                                onClick={() => {
                                  setActiveCoverUrl(source.url);
                                  toast.info(
                                    `Cover switched to: ${source.label}`,
                                  );
                                }}
                                className={`group relative aspect-[3/4] rounded-lg overflow-hidden border bg-surface-container transition-all outline-none text-left p-0.5 ${
                                  isSelected
                                    ? 'border-primary ring-2 ring-primary/40'
                                    : 'border-outline-variant/50 hover:border-outline hover:scale-[1.02]'
                                }`}
                                title={`${source.label}: ${source.description}`}
                              >
                                <img
                                  src={source.url}
                                  alt={source.label}
                                  className="w-full h-full object-cover rounded-[6px]"
                                  referrerPolicy="no-referrer"
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-black/75 p-1 text-[9px] text-white font-medium line-clamp-1 truncate text-center rounded-b-[6px]">
                                  {source.label}
                                </div>
                                {isSelected && (
                                  <div className="absolute top-1 right-1 bg-primary text-on-primary w-4 h-4 rounded-full flex items-center justify-center shadow-md">
                                    <Check
                                      className="w-2.5 h-2.5"
                                      strokeWidth={3}
                                    />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* CUSTOM RECOURSE URL INPUT */}
                    <div className="space-y-1">
                      <Label
                        htmlFor="coverUrl"
                        className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant flex items-center gap-1"
                      >
                        <Link size={12} /> External Cover URL
                      </Label>
                      <Input
                        id="coverUrl"
                        className="bg-surface-container h-10 rounded-lg text-sm"
                        placeholder="https://image-location.com/cover.jpg"
                        value={manualCoverUrl}
                        onChange={e => setActiveCoverUrl(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* RIGHT COLUMN: TAXONOMICAL DETAILS FORM */}
                  <div className="md:col-span-7 space-y-5">
                    <Label className="text-xs font-label-caps uppercase tracking-wider text-on-surface-variant">
                      Book Metadata
                    </Label>

                    <div className="space-y-4">
                      <div className="space-y-1">
                        <Label
                          htmlFor="title"
                          className="text-xs font-semibold text-ink"
                        >
                          Title
                        </Label>
                        <Input
                          id="title"
                          placeholder="Lord of the Rings"
                          className="bg-surface-container text-sm h-11 rounded-lg"
                          {...register('title')}
                        />
                        {errors.title && (
                          <p className="text-xs text-error">
                            {errors.title.message}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label
                          htmlFor="author"
                          className="text-xs font-semibold text-ink"
                        >
                          Author
                        </Label>
                        <Input
                          id="author"
                          placeholder="J.R.R. Tolkien"
                          className="bg-surface-container text-sm h-11 rounded-lg"
                          {...register('author')}
                        />
                        {errors.author && (
                          <p className="text-xs text-error">
                            {errors.author.message}
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-ink">
                            Format
                          </Label>
                          <Select
                            value={formatValue}
                            onValueChange={(val: 'physical' | 'digital') =>
                              setValue('format', val)
                            }
                          >
                            <SelectTrigger className="bg-surface-container h-11 rounded-lg text-sm">
                              <SelectValue placeholder="Format" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="physical">
                                Physical Layout
                              </SelectItem>
                              <SelectItem value="digital">
                                Digital E-Book
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label
                            htmlFor="isbn"
                            className="text-xs font-semibold text-ink"
                          >
                            ISBN Code
                          </Label>
                          <Input
                            id="isbn"
                            placeholder="9780007525546"
                            className="bg-surface-container text-sm h-11 rounded-lg"
                            {...register('isbn')}
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label
                          htmlFor="genresInput"
                          className="text-xs font-semibold text-ink"
                        >
                          Genres (Comma separated list)
                        </Label>
                        <Input
                          id="genresInput"
                          placeholder="Fantasy, Fiction, Classic"
                          className="bg-surface-container text-sm h-11 rounded-lg"
                          {...register('genresInput')}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                            Suggested Genres
                          </Label>
                          {isSearchingGenres && (
                            <div className="flex items-center gap-1 text-[11px] text-on-surface-variant/70">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>Searching...</span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1">
                          {suggestedGenres.map(genre => {
                            const isSelected = isGenreSelected(genre);
                            return (
                              <Button
                                key={genre}
                                type="button"
                                variant={isSelected ? 'secondary' : 'outline'}
                                className={`h-7 px-2.5 py-1 text-xs font-medium rounded-md select-none transition-all flex items-center gap-1 ${
                                  isSelected
                                    ? 'bg-primary/10 text-primary hover:bg-primary/15 border-transparent'
                                    : 'bg-surface-container hover:bg-surface-container-high border-outline-variant/30 text-on-surface'
                                }`}
                                onClick={() => toggleGenre(genre)}
                                id={`genre-tag-${genre.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                              >
                                {isSelected && (
                                  <Check className="w-3 h-3 stroke-[2.5]" />
                                )}
                                {genre}
                              </Button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label
                            htmlFor="publishedDate"
                            className="text-xs font-semibold text-ink"
                          >
                            Published Year / Date
                          </Label>
                          <Input
                            id="publishedDate"
                            placeholder="1954"
                            className="bg-surface-container text-sm h-11 rounded-lg"
                            {...register('publishedDate')}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label
                            htmlFor="series"
                            className="text-xs font-semibold text-ink"
                          >
                            Series Name
                          </Label>
                          <Input
                            id="series"
                            placeholder="The Lord of the Rings (Book 1)"
                            className="bg-surface-container text-sm h-11 rounded-lg"
                            {...register('series')}
                          />
                          {errors.series && (
                            <p className="text-xs text-error">
                              {errors.series.message}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {onDelete && (
                  <div className="border-t border-outline-variant/15 mt-8 pt-6 flex justify-start">
                    <Button
                      type="button"
                      variant="outline"
                      className="text-error hover:bg-error/5 hover:text-error border-error-container/40 outline-none flex items-center gap-1.5 h-10 select-none"
                      onClick={() => setShowDeleteConfirmation(true)}
                    >
                      <Trash2 size={15} />
                      Delete Book
                    </Button>
                  </div>
                )}
              </div>

              <DialogFooter className="px-6 py-4.5 border-t border-outline-variant/25 shrink-0 flex items-center justify-end w-full h-18 bg-surface-container-lowest gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  className="h-10 hover:bg-surface-container"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSavingDetails}
                  className="h-10 shadow-sm px-5 flex items-center gap-1.5"
                >
                  {isSavingDetails ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
