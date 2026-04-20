import React, { useState, useEffect } from 'react';
import { X, Calendar, Hash, User, Clock, Edit2, Save, Image as ImageIcon, Trash2, Book as BookIcon, Sparkles, Loader2, Star, MessageSquare } from 'lucide-react';
import { BookDetails } from '../services/bookApi';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy, Timestamp } from 'firebase/firestore';
import { generateBookInsights } from '../services/gemini';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import { toTitleCase } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';

interface Book extends BookDetails {
  id: string;
  addedBy: string;
  addedAt: any;
}

interface Review {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  text: string;
  createdAt: any;
  updatedAt?: any;
}

interface BookDetailsModalProps {
  book: Book | null;
  libraryId: string;
  isOpen: boolean;
  onClose: () => void;
  canEdit?: boolean;
  onUpdate?: (bookId: string, data: Partial<Omit<Book, 'id'>>) => Promise<void>;
  onDelete?: (bookId: string) => void;
}

const getHash = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

const gradients = [
  'from-[#fef08a] to-[#fef9c3]', // Pastel Yellow
  'from-[#bbf7d0] to-[#dcfce7]', // Pastel Green
  'from-[#a7f3d0] to-[#d1fae5]', // Pastel Emerald
  'from-[#d9f99d] to-[#ecfccb]', // Pastel Lime
  'from-[#fde047] to-[#fef08a]', // Sunny Yellow
  'from-[#86efac] to-[#bbf7d0]', // Mint Green
  'from-[#fef08a] to-[#dcfce7]', // Yellow to Green
];

export default function BookDetailsModal({ book, libraryId, isOpen, onClose, canEdit, onUpdate, onDelete }: BookDetailsModalProps) {
  const { user } = useAuth();
  const [addedByName, setAddedByName] = useState<string>('Loading...');
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Omit<Book, 'id'>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [activeInsight, setActiveInsight] = useState<'summary' | 'catchup' | 'similar' | null>(null);
  const [insightContent, setInsightContent] = useState<string | null>(null);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'review' | 'cover', id?: string } | null>(null);

  useEffect(() => {
    if (!book || !libraryId) return;

    const reviewsRef = collection(db, 'libraries', libraryId, 'books', book.id, 'reviews');
    const q = query(reviewsRef, orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const revs: Review[] = [];
      snapshot.forEach((doc) => {
        revs.push({ id: doc.id, ...doc.data() } as Review);
      });
      setReviews(revs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `libraries/${libraryId}/books/${book.id}/reviews`);
    });

    return () => unsubscribe();
  }, [book, libraryId]);

  useEffect(() => {
    if (!book?.addedBy) return;

    const fetchUser = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', book.addedBy));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setAddedByName(data.displayName || data.email || 'Unknown User');
        } else {
          setAddedByName('Unknown User');
        }
      } catch (error) {
        console.error("Error fetching user details", error);
        setAddedByName('Unknown User');
      }
    };

    fetchUser();
  }, [book?.addedBy]);

  useEffect(() => {
    if (book) {
      setEditData({
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        coverUrl: book.coverUrl,
        publishedDate: book.publishedDate
      });
      setIsEditing(false);
      setActiveInsight(null);
      setInsightContent(null);
      setIsReviewing(false);
      setEditingReviewId(null);
      setReviewRating(0);
      setReviewText('');
    }
  }, [book]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (confirmDelete) {
          setConfirmDelete(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, confirmDelete]);

  const handleGenerateInsight = async (type: 'summary' | 'catchup' | 'similar') => {
    if (!book) return;
    
    setActiveInsight(type);
    setIsGeneratingInsight(true);
    setInsightContent(null);
    
    try {
      const content = await generateBookInsights(book.title, book.author, type);
      setInsightContent(content);
    } catch (error: any) {
      const errorMessage = error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED') || error?.message?.includes('quota')
        ? "The AI Librarian is currently resting (quota limit). Please come back later!"
        : "Failed to generate insights. Please try again.";
      toast.error(errorMessage);
      setActiveInsight(null);
    } finally {
      setIsGeneratingInsight(false);
    }
  };

  const handleSave = async () => {
    if (!book || !onUpdate) return;
    if (!editData.title?.trim()) {
      toast.error("Title is required");
      return;
    }
    setIsSaving(true);
    try {
      await onUpdate(book.id, editData);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveReview = async () => {
    if (!book || !libraryId || !user) return;
    if (reviewRating === 0) {
      toast.error("Please select a rating");
      return;
    }
    if (!reviewText.trim()) {
      toast.error("Please write a review");
      return;
    }

    setIsSavingReview(true);
    try {
      if (editingReviewId) {
        await updateDoc(doc(db, 'libraries', libraryId, 'books', book.id, 'reviews', editingReviewId), {
          rating: reviewRating,
          text: reviewText.trim(),
          updatedAt: serverTimestamp()
        });
        toast.success("Review updated");
      } else {
        await addDoc(collection(db, 'libraries', libraryId, 'books', book.id, 'reviews'), {
          userId: user.uid,
          userName: user.displayName || user.email || 'Unknown User',
          rating: reviewRating,
          text: reviewText.trim(),
          createdAt: serverTimestamp()
        });
        toast.success("Review added");
      }
      setIsReviewing(false);
      setEditingReviewId(null);
      setReviewRating(0);
      setReviewText('');
    } catch (error) {
      handleFirestoreError(error, editingReviewId ? OperationType.UPDATE : OperationType.CREATE, `libraries/${libraryId}/books/${book.id}/reviews`);
    } finally {
      setIsSavingReview(false);
    }
  };

  const handleEditReview = (review: Review) => {
    setReviewRating(review.rating);
    setReviewText(review.text);
    setEditingReviewId(review.id);
    setIsReviewing(true);
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!book || !libraryId) return;
    setConfirmDelete({ type: 'review', id: reviewId });
  };

  const handleRemoveCover = async () => {
    if (isEditing) {
      setEditData({ ...editData, coverUrl: '' });
      return;
    }
    
    if (!book || !libraryId || !onUpdate) return;
    setConfirmDelete({ type: 'cover' });
  };

  const averageRating = reviews.length > 0 
    ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1) 
    : null;

  const formatAddedDate = (addedAt: any) => {
    if (!addedAt) return 'Unknown date';
    const date = addedAt.toDate ? addedAt.toDate() : new Date(addedAt);
    if (isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getAddedAtInputValue = () => {
    const current = editData.addedAt !== undefined ? editData.addedAt : book?.addedAt;
    if (!current) return '';
    
    const d = current.toDate ? current.toDate() : new Date(current);
    if (isNaN(d.getTime())) return '';
    
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  };

  const handleAddedAtChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      setEditData({ ...editData, addedAt: Timestamp.fromDate(d) });
    }
  };

  const displayBook = isEditing ? { ...book, ...editData } : book;

  const hash = getHash(displayBook?.title || '');
  const gradientClass = gradients[hash % gradients.length];

  return (
    <AnimatePresence>
      {isOpen && book && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-sans" 
            onClick={onClose}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="bg-surface/95 backdrop-blur-xl rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col md:flex-row overflow-hidden shadow-2xl relative border border-border/40"
              onClick={e => e.stopPropagation()}
            >
            <div className="absolute top-4 right-4 flex gap-2 z-10">
          {canEdit && !isEditing && (
            <>
              <button 
                onClick={() => setIsEditing(true)} 
                className="p-3 bg-paper/80 backdrop-blur-md text-ink hover:bg-surface rounded-full transition-all shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-md border border-border/40 hover:text-accent"
                title="Edit Book"
              >
                <Edit2 size={18} strokeWidth={2} />
              </button>
              <button 
                onClick={() => {
                  if (onDelete && book) {
                     onDelete(book.id);
                  }
                }} 
                className="p-3 bg-paper/80 backdrop-blur-md text-muted hover:bg-red-50 hover:text-red-500 rounded-full transition-all shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-md border border-border/40 hover:border-red-200"
                title="Delete Book"
              >
                <Trash2 size={18} strokeWidth={2} />
              </button>
            </>
          )}
          {isEditing && (
            <button 
              onClick={handleSave} 
              disabled={isSaving} 
              className="p-3 bg-ink text-surface shadow-md hover:-translate-y-0.5 rounded-full transition-all disabled:opacity-50 border border-transparent"
              title="Save Changes"
            >
              <Save size={18} strokeWidth={2} />
            </button>
          )}
          <button 
            onClick={onClose} 
            className="p-3 bg-paper/80 backdrop-blur-md text-ink hover:bg-surface rounded-full transition-all shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-md border border-border/40 hover:text-muted"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Cover Section */}
        <div className="w-full md:w-2/5 bg-surface/40 flex items-center justify-center p-6 md:p-8 min-h-[250px] md:min-h-[300px] border-b md:border-b-0 md:border-r border-border/40 relative">
          {displayBook.coverUrl ? (
            <div className="relative group z-10">
              <img 
                src={displayBook.coverUrl} 
                alt={displayBook.title} 
                className="w-full max-w-[160px] md:max-w-[200px] rounded-r-md rounded-l-sm shadow-[8px_10px_20px_rgba(0,0,0,0.15)] object-cover"
                referrerPolicy="no-referrer"
              />
              {canEdit && (
                <button
                  onClick={handleRemoveCover}
                  className="absolute -top-3 -right-3 p-2 bg-red-500 text-white rounded-full shadow-md hover:bg-red-600 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 z-20"
                  title="Remove Cover"
                >
                  <Trash2 size={16} strokeWidth={2} />
                </button>
              )}
            </div>
          ) : (
            <div 
              className={`w-full max-w-[160px] md:max-w-[200px] aspect-[2/3] rounded-r-md rounded-l-sm shadow-[8px_10px_20px_rgba(0,0,0,0.15)] flex flex-col justify-between text-ink p-4 md:p-6 relative overflow-hidden bg-gradient-to-br ${gradientClass}`}
            >
              <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-black/20 via-black/5 to-transparent z-10" />
              <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-white/50 z-20" />
              <div className="absolute left-3 top-0 bottom-0 w-[1px] bg-black/5 z-20" />
              
              <div className="space-y-3 z-30 relative pl-4 mt-4">
                <div className="w-10 h-[2px] bg-ink/30 mb-6" />
                <h3 className="font-serif font-bold text-2xl leading-snug tracking-tight">{toTitleCase(displayBook.title)}</h3>
                <p className="font-sans text-xs opacity-80 font-bold tracking-wider uppercase">{toTitleCase(displayBook.author)}</p>
                {averageRating && (
                  <div className="flex items-center gap-1 mt-2">
                    <Star size={14} className="fill-yellow-500 text-yellow-500" />
                    <span className="text-sm font-medium">{averageRating}</span>
                  </div>
                )}
              </div>
              
              <div className="flex justify-between items-end z-30 relative pl-4 mb-2">
                <BookIcon size={24} className="text-ink/30" strokeWidth={1.5} />
                <div className="w-6 h-6 rounded-full border border-ink/20 flex items-center justify-center">
                  <div className="w-2 h-2 bg-ink/20 rounded-full" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Details Section */}
        <div className="w-full md:w-3/5 p-8 overflow-y-auto custom-scrollbar relative bg-surface">
          <div className="mb-10 pr-12">
            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted uppercase tracking-wider font-medium mb-1 block">Title</label>
                  <input 
                    value={editData.title || ''} 
                    onChange={e => setEditData({...editData, title: e.target.value})}
                    className="w-full text-3xl font-serif font-medium text-ink border-b border-border focus:border-accent focus:outline-none py-1.5 bg-transparent transition-colors"
                    placeholder="Book Title"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted uppercase tracking-wider font-medium mb-1 block">Author</label>
                  <input 
                    value={editData.author || ''} 
                    onChange={e => setEditData({...editData, author: e.target.value})}
                    className="w-full text-xl text-accent font-serif italic border-b border-border focus:border-accent focus:outline-none py-1.5 bg-transparent transition-colors"
                    placeholder="Author Name"
                  />
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-4xl sm:text-5xl font-serif font-bold text-ink mb-4 leading-tight tracking-tight">{toTitleCase(book.title)}</h2>
                <p className="text-2xl text-accent font-serif italic">{toTitleCase(book.author)}</p>
                {averageRating && (
                  <div className="flex items-center gap-2 mt-5">
                    <div className="flex items-center gap-1 bg-yellow-100 text-yellow-800 px-3 py-1.5 rounded-lg shadow-sm border border-yellow-200">
                      <Star size={16} className="fill-yellow-500 text-yellow-500" />
                      <span className="font-bold">{averageRating}</span>
                    </div>
                    <span className="text-muted text-sm font-medium">({reviews.length} {reviews.length === 1 ? 'review' : 'reviews'})</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
              <div className="flex items-start gap-4">
                <div className="mt-1 p-2.5 bg-surface/60 rounded-xl text-accent border border-border/40 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                  <Calendar size={18} strokeWidth={2} />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted uppercase tracking-wider font-medium mb-1.5">Published</p>
                  {isEditing ? (
                    <input 
                      value={editData.publishedDate || ''} 
                      onChange={e => setEditData({...editData, publishedDate: e.target.value})}
                      className="w-full text-ink border-b border-border focus:border-accent focus:outline-none py-1 bg-transparent text-sm transition-colors"
                      placeholder="YYYY or YYYY-MM-DD"
                    />
                  ) : (
                    <p className="text-ink font-medium">{book.publishedDate || 'Unknown'}</p>
                  )}
                </div>
              </div>

                <div className="flex items-start gap-4">
                  <div className="mt-1 p-2.5 bg-surface/60 rounded-xl text-accent border border-border/40 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                    <Hash size={18} strokeWidth={2} />
                  </div>
                  <div className="flex-1">
                  <p className="text-xs text-muted uppercase tracking-wider font-medium mb-1.5">ISBN</p>
                  {isEditing ? (
                    <input 
                      value={editData.isbn || ''} 
                      onChange={e => setEditData({...editData, isbn: e.target.value})}
                      className="w-full text-ink font-mono border-b border-border focus:border-accent focus:outline-none py-1 bg-transparent text-sm transition-colors"
                      placeholder="ISBN-10 or ISBN-13"
                    />
                  ) : (
                    <p className="text-ink font-mono text-sm">{book.isbn || 'N/A'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="mt-1 p-2.5 bg-surface/60 rounded-xl text-accent border border-border/40 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                  <BookIcon size={18} strokeWidth={2} />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted uppercase tracking-wider font-medium mb-1.5">Genre</p>
                  {isEditing ? (
                    <input 
                      value={editData.genre || ''} 
                      onChange={e => setEditData({...editData, genre: e.target.value})}
                      className="w-full text-ink border-b border-border focus:border-accent focus:outline-none py-1 bg-transparent text-sm transition-colors"
                      placeholder="e.g. Science Fiction"
                    />
                  ) : (
                    <p className="text-ink font-medium">{book.genre || 'Uncategorized'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="mt-1 p-2.5 bg-surface/60 rounded-xl text-accent border border-border/40 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                  <BookIcon size={18} strokeWidth={2} />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted uppercase tracking-wider font-medium mb-1.5">Series</p>
                  {isEditing ? (
                    <input 
                      value={editData.series || ''} 
                      onChange={e => setEditData({...editData, series: e.target.value})}
                      className="w-full text-ink border-b border-border focus:border-accent focus:outline-none py-1 bg-transparent text-sm transition-colors"
                      placeholder="e.g. Harry Potter"
                    />
                  ) : (
                    <p className="text-ink font-medium">{book.series || 'Standalone'}</p>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="flex items-start gap-4 sm:col-span-2">
                  <div className="mt-1 p-2.5 bg-surface/60 rounded-xl text-accent border border-border/40 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                    <ImageIcon size={18} strokeWidth={2} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted uppercase tracking-wider font-medium mb-1.5">Cover URL</p>
                    <input 
                      value={editData.coverUrl || ''} 
                      onChange={e => setEditData({...editData, coverUrl: e.target.value})}
                      className="w-full text-ink border-b border-border focus:border-accent focus:outline-none py-1 bg-transparent text-sm transition-colors"
                      placeholder="https://..."
                    />
                  </div>
                </div>
              )}

                <div className="flex items-start gap-4">
                  <div className="mt-1 p-2.5 bg-surface/60 rounded-xl text-accent border border-border/40 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                    <User size={18} strokeWidth={2} />
                  </div>
                  <div>
                  <p className="text-xs text-muted uppercase tracking-wider font-medium mb-1.5">Added By</p>
                  <p className="text-ink font-medium">{addedByName}</p>
                </div>
              </div>

                <div className="flex items-start gap-4">
                  <div className="mt-1 p-2.5 bg-surface/60 rounded-xl text-accent border border-border/40 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                    <Clock size={18} strokeWidth={2} />
                  </div>
                  <div className="flex-1">
                  <p className="text-xs text-muted uppercase tracking-wider font-medium mb-1.5">Added On</p>
                  {isEditing ? (
                    <input
                      type="datetime-local"
                      value={getAddedAtInputValue()}
                      onChange={handleAddedAtChange}
                      className="w-full text-ink border-b border-border focus:border-accent focus:outline-none py-1 bg-transparent text-sm transition-colors"
                    />
                  ) : (
                    <p className="text-ink font-medium">{formatAddedDate(book?.addedAt)}</p>
                  )}
                </div>
              </div>
            </div>

            {/* AI Reading Companion Section */}
            {!isEditing && (
              <div className="mt-12 pt-8 border-t border-border/40">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-accent text-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
                    <Sparkles size={20} strokeWidth={2} />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-serif font-bold text-ink tracking-tight">AI Reading Companion</h3>
                </div>
                
                <div className="flex flex-wrap gap-3 mb-8">
                  <button
                    onClick={() => handleGenerateInsight('summary')}
                    className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all border ${
                      activeInsight === 'summary' 
                        ? 'bg-ink text-surface border-ink shadow-md' 
                        : 'bg-surface/50 text-ink border-border/60 hover:bg-surface hover:border-ink/20 hover:shadow-sm'
                    }`}
                  >
                    Summary (No Spoilers)
                  </button>
                  <button
                    onClick={() => handleGenerateInsight('catchup')}
                    className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all border ${
                      activeInsight === 'catchup' 
                        ? 'bg-ink text-surface border-ink shadow-md' 
                        : 'bg-surface/50 text-ink border-border/60 hover:bg-surface hover:border-ink/20 hover:shadow-sm'
                    }`}
                  >
                    Catch me up (Spoilers)
                  </button>
                  <button
                    onClick={() => handleGenerateInsight('similar')}
                    className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all border ${
                      activeInsight === 'similar' 
                        ? 'bg-ink text-surface border-ink shadow-md' 
                        : 'bg-surface/50 text-ink border-border/60 hover:bg-surface hover:border-ink/20 hover:shadow-sm'
                    }`}
                  >
                    Other books like this
                  </button>
                </div>

                {activeInsight && (
                  <div className="bg-surface/40 rounded-3xl p-6 sm:p-8 shadow-sm border border-border/40">
                    {isGeneratingInsight ? (
                      <div className="flex flex-col items-center justify-center py-10 text-muted">
                        <Loader2 className="animate-spin mb-4 text-accent/80" size={32} strokeWidth={2} />
                        <p className="font-medium">Consulting the AI Librarian...</p>
                      </div>
                    ) : insightContent ? (
                      <div className="prose prose-sm sm:prose-base max-w-none prose-headings:font-serif prose-headings:font-bold prose-headings:text-ink prose-p:text-ink/80 prose-a:text-accent prose-strong:text-ink leading-relaxed">
                        <Markdown>{insightContent}</Markdown>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}

            {/* Reviews Section */}
            {!isEditing && (
              <div className="mt-12 pt-8 border-t border-border/40">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-accent text-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
                      <MessageSquare size={20} strokeWidth={2} />
                    </div>
                    <h3 className="text-xl sm:text-2xl font-serif font-bold text-ink tracking-tight">Reviews</h3>
                  </div>
                  {canEdit && !isReviewing && !reviews.some(r => r.userId === user?.uid) && (
                    <button
                      onClick={() => setIsReviewing(true)}
                      className="px-5 py-2.5 text-sm font-bold bg-ink text-surface hover:bg-ink/90 rounded-full transition-all shadow-sm hover:shadow-md"
                    >
                      Write a Review
                    </button>
                  )}
                </div>

                {isReviewing && (
                  <div className="bg-surface/50 rounded-3xl p-6 sm:p-8 mb-8 border border-border/60 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setReviewRating(star)}
                          className="focus:outline-none transition-transform hover:scale-110"
                        >
                          <Star
                            size={24}
                            className={star <= reviewRating ? "fill-yellow-500 text-yellow-500" : "text-border hover:text-yellow-300"}
                          />
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={reviewText}
                      onChange={(e) => setReviewText(e.target.value)}
                      placeholder="What did you think of this book?"
                      className="w-full bg-paper/80 border border-border/60 rounded-2xl p-5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20 focus:border-ink/40 transition-all min-h-[120px] mb-6 resize-y font-medium custom-scrollbar"
                    />
                    <div className="flex justify-end gap-3 sm:gap-4">
                      <button
                        onClick={() => {
                          setIsReviewing(false);
                          setEditingReviewId(null);
                          setReviewRating(0);
                          setReviewText('');
                        }}
                        className="px-6 py-3 text-sm font-bold text-ink border border-border/60 rounded-full hover:bg-surface transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveReview}
                        disabled={isSavingReview}
                        className="px-6 py-3 bg-accent text-surface text-sm font-bold rounded-full hover:bg-accent/90 transition-all disabled:opacity-50 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                      >
                        {isSavingReview ? 'Saving...' : 'Save Review'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-6">
                  {reviews.length === 0 && !isReviewing ? (
                    <p className="text-muted text-lg font-medium italic">No reviews yet.</p>
                  ) : (
                    reviews.map((review) => (
                      <div key={review.id} className="bg-surface/40 rounded-3xl p-6 sm:p-8 border border-border/40 shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:border-border/60 transition-colors">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-ink/5 flex items-center justify-center text-ink font-bold text-base shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] border border-border/40">
                              {review.userName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-ink tracking-tight">{review.userName}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <Star
                                    key={star}
                                    size={12}
                                    className={star <= review.rating ? "fill-yellow-500 text-yellow-500" : "text-border"}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 sm:gap-4">
                            <span className="text-xs font-medium text-muted uppercase tracking-wider">
                              {review.createdAt?.toDate ? review.createdAt.toDate().toLocaleDateString() : 'Just now'}
                            </span>
                            {user?.uid === review.userId && !isReviewing && (
                              <div className="flex items-center gap-2 bg-surface/60 px-2 py-1 rounded-full border border-border/40 shadow-sm">
                                <button
                                  onClick={() => handleEditReview(review)}
                                  className="p-1.5 text-muted hover:text-accent transition-colors rounded-full hover:bg-paper"
                                  title="Edit Review"
                                >
                                  <Edit2 size={14} strokeWidth={2.5} />
                                </button>
                                <button
                                  onClick={() => handleDeleteReview(review.id)}
                                  className="p-1.5 text-muted hover:text-red-500 transition-colors rounded-full hover:bg-red-50"
                                  title="Delete Review"
                                >
                                  <Trash2 size={14} strokeWidth={2.5} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-ink/80 whitespace-pre-wrap leading-relaxed font-medium">{review.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {confirmDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4 font-sans" 
            onClick={() => setConfirmDelete(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="bg-surface/95 backdrop-blur-xl rounded-3xl w-full max-w-sm p-8 shadow-2xl border border-border/40" 
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-2xl font-serif font-bold tracking-tight text-ink mb-3">Confirm Deletion</h3>
            <p className="text-muted font-medium mb-8">
              {confirmDelete.type === 'cover' 
                ? "Are you sure you want to remove this book's cover image?" 
                : "Are you sure you want to delete this review?"}
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmDelete(null)}
                className="px-6 py-2.5 rounded-full text-sm font-bold text-ink border border-border/60 hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  if (confirmDelete.type === 'cover') {
                    try {
                      await onUpdate?.(book.id, { coverUrl: '' });
                      toast.success("Cover image removed");
                    } catch (e) {}
                  } else if (confirmDelete.type === 'review' && confirmDelete.id) {
                    try {
                      await deleteDoc(doc(db, 'libraries', libraryId, 'books', book.id, 'reviews', confirmDelete.id));
                      toast.success("Review deleted");
                    } catch (error) {
                      handleFirestoreError(error, OperationType.DELETE, `libraries/${libraryId}/books/${book.id}/reviews/${confirmDelete.id}`);
                    }
                  }
                  setConfirmDelete(null);
                }}
                className="px-6 py-2.5 rounded-full text-sm font-bold bg-red-500 text-white hover:bg-red-600 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                Delete
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </>
    )}
    </AnimatePresence>
  );
}
