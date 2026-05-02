import React, {useState} from 'react';
import {collection, addDoc, serverTimestamp} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {toast} from 'sonner';
import {StarRating} from '../../components/StarRating';
import {Review} from './useBook';
import {Book, FirestoreDate} from '../../types';
import {useAuth} from '../../contexts/AuthContext';

interface ReviewSectionProps {
  libraryId: string;
  book: Book;
  reviews: Review[];
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>;
  canEdit: boolean;
}

export function ReviewSection({
  libraryId,
  book,
  reviews,
  setReviews,
  canEdit,
}: ReviewSectionProps) {
  const {user} = useAuth();
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [isSavingReview, setIsSavingReview] = useState(false);

  const handleSaveReview = async () => {
    if (!book || !libraryId || !user) return;
    if (reviewRating === 0) {
      toast.error('Please select a rating');
      return;
    }
    if (!reviewText.trim()) {
      toast.error('Please write a review');
      return;
    }

    const tempReview: Review = {
      id: `temp-${Date.now()}`,
      userId: user.uid,
      userName: user.displayName || user.email || 'Unknown User',
      rating: reviewRating,
      text: reviewText.trim(),
      createdAt: new Date() as unknown as FirestoreDate,
    };

    const originalReviews = [...reviews];
    setReviews(prev => [tempReview, ...prev]);
    setIsReviewing(false);
    setReviewRating(0);
    setReviewText('');

    setIsSavingReview(true);
    try {
      await addDoc(
        collection(db, 'libraries', libraryId, 'books', book.id, 'reviews'),
        {
          userId: user.uid,
          userName: user.displayName || user.email || 'Unknown User',
          rating: tempReview.rating,
          text: tempReview.text,
          createdAt: serverTimestamp(),
        },
      );
      toast.success('Review added');
    } catch (error) {
      setReviews(originalReviews);
      setIsReviewing(true);
      setReviewRating(tempReview.rating);
      setReviewText(tempReview.text);
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `libraries/${libraryId}/books/${book.id}/reviews`,
      );
    } finally {
      setIsSavingReview(false);
    }
  };

  return (
    <section className="mt-8 border-t border-surface-dim pt-12">
      <div className="flex items-center justify-between mb-8">
        <h3 className="font-headline-md text-[24px] text-primary">Reviews</h3>
        {canEdit &&
          !isReviewing &&
          !reviews.some(r => r.userId === user?.uid) &&
          (book.userStatuses?.[user?.uid || ''] === 'finished' ||
            book.userStatuses?.[user?.uid || ''] === 'abandoned') && (
            <button
              className="px-6 py-2 rounded-full font-label-caps text-label-caps bg-primary text-on-primary hover:bg-primary/90 transition-colors shadow-sm"
              onClick={() => setIsReviewing(true)}
            >
              WRITE REVIEW
            </button>
          )}
      </div>

      {isReviewing &&
        (book.userStatuses?.[user?.uid || ''] === 'finished' ||
          book.userStatuses?.[user?.uid || ''] === 'abandoned') && (
          <div className="bg-surface-container rounded-lg p-6 mb-8 border border-surface-variant">
            <div className="mb-4">
              <StarRating
                interactive
                rating={reviewRating}
                onRatingChange={setReviewRating}
                size="lg"
              />
            </div>
            <textarea
              value={reviewText}
              onChange={e => setReviewText(e.target.value)}
              placeholder="What did you think of this book?"
              className="w-full bg-surface-container-lowest border border-outline-variant/60 rounded-md p-4 text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all min-h-[120px] mb-6 resize-y"
            />
            <div className="flex justify-end gap-4">
              <button
                onClick={() => {
                  setIsReviewing(false);
                  setReviewRating(0);
                  setReviewText('');
                }}
                className="px-6 py-2 text-sm font-label-caps text-outline border border-outline/50 rounded-full hover:bg-surface-variant transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={handleSaveReview}
                disabled={isSavingReview}
                className="px-6 py-2 bg-primary text-on-primary text-sm font-label-caps rounded-full hover:bg-primary/90 transition-all disabled:opacity-50 shadow-sm"
              >
                {isSavingReview ? 'SAVING...' : 'SAVE REVIEW'}
              </button>
            </div>
          </div>
        )}

      <div className="space-y-6">
        {reviews.length === 0 ? (
          <p className="text-on-surface-variant italic">No reviews yet.</p>
        ) : (
          reviews.map(review => (
            <div
              key={review.id}
              className="bg-surface-container-lowest rounded-lg p-6 border border-surface-variant architectural-shadow"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {review.userName?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <div>
                    <p className="font-medium text-primary">
                      {review.userName}
                    </p>
                    <div className="flex items-center gap-1 mt-1 text-secondary">
                      <StarRating rating={review.rating} size="sm" />
                    </div>
                  </div>
                </div>
                <span className="text-xs text-on-surface-variant uppercase tracking-wider">
                  {typeof review.createdAt === 'object' &&
                  review.createdAt !== null &&
                  'toDate' in review.createdAt &&
                  typeof (review.createdAt as {toDate: () => Date}).toDate ===
                    'function'
                    ? (review.createdAt as {toDate: () => Date})
                        .toDate()
                        .toLocaleDateString()
                    : 'Just now'}
                </span>
              </div>
              <p className="text-on-surface leading-relaxed text-body-md whitespace-pre-wrap">
                {review.text}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
