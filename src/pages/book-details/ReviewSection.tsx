import React, {useState} from 'react';
import {toast} from 'sonner';
import {StarRating} from '../../components/StarRating';
import {Review} from './useBook';
import {Book, FirestoreDate} from '../../types';
import {useAuth} from '../../stores/authStore';
import {Button} from '@/components/ui/button';
import {format} from 'date-fns';

interface ReviewSectionProps {
  libraryId: string;
  book: Book;
  reviews: Review[];
  setReviewsOptimistically: (reviews: Review[]) => void;
  canEdit: boolean;
  addReview: (rating: number, text: string) => Promise<void>;
}

export function ReviewSection({
  libraryId,
  book,
  reviews,
  setReviewsOptimistically,
  canEdit,
  addReview,
}: ReviewSectionProps) {
  const {user} = useAuth();
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [isSavingReview, setIsSavingReview] = useState(false);

  const handleSaveReview = async () => {
    if (!book || !libraryId || !user) return;
    if (reviewRating === 0 && !reviewText.trim()) {
      toast.error('Please provide a rating or write a review');
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
    setReviewsOptimistically([tempReview, ...reviews]);
    setIsReviewing(false);
    setReviewRating(0);
    setReviewText('');

    setIsSavingReview(true);
    try {
      await addReview(tempReview.rating, tempReview.text);
      toast.success('Review added');
    } catch {
      setReviewsOptimistically(originalReviews);
      setIsReviewing(true);
      setReviewRating(tempReview.rating);
      setReviewText(tempReview.text);
      toast.error('Failed to save review');
    } finally {
      setIsSavingReview(false);
    }
  };

  return (
    <section className="mt-8 border-t border-surface-dim pt-12">
      <div className="flex items-center justify-between mb-8">
        <h3 className="font-headline-md text-headline-md text-primary">
          Reviews
        </h3>
        {canEdit &&
          !isReviewing &&
          !reviews.some(r => r.userId === user?.uid) &&
          (book.userStatuses?.[user?.uid || ''] === 'finished' ||
            book.userStatuses?.[user?.uid || ''] === 'abandoned') && (
            <Button onClick={() => setIsReviewing(true)}>Write Review</Button>
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
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsReviewing(false);
                  setReviewRating(0);
                  setReviewText('');
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveReview} disabled={isSavingReview}>
                {isSavingReview ? 'Saving...' : 'Save Review'}
              </Button>
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
                    ? format(
                        (review.createdAt as {toDate: () => Date}).toDate(),
                        'MMM d, yyyy',
                      )
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
