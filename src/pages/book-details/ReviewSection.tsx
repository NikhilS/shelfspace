import React, {useState} from 'react';
import {toast} from 'sonner';
import {StarRating} from '@/components/ui/star-rating';
import {Review} from './useBook';
import {Book} from '../../types';
import {useAuth} from '../../stores/authStore';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {formatShortDate} from '../../lib/date';

interface ReviewSectionProps {
  libraryId: string;
  book: Book;
  reviews: Review[];
  setReviewsOptimistically: (reviews: Review[]) => void;
  canEdit?: boolean;
  addReview: (rating: number, text: string) => Promise<void>;
}

export function ReviewSection({
  libraryId,
  book,
  reviews,
  setReviewsOptimistically,
  addReview,
}: ReviewSectionProps) {
  const {user} = useAuth();
  const isOnline = useOnlineStatus();
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [isSavingReview, setIsSavingReview] = useState(false);

  const handleSaveReview = async () => {
    if (!book || !libraryId || !user || !isOnline) {
      return;
    }
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
      createdAt: new Date().toISOString(),
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
    <section className="bento-card p-5 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
        <div className="flex items-baseline gap-2.5">
          <h3 className="font-serif text-xl font-semibold text-primary">
            Reviews &amp; Reader Notes
          </h3>
          {reviews.length > 0 && (
            <span className="font-mono tabular-nums text-xs text-on-surface-variant">
              ({reviews.length})
            </span>
          )}
        </div>
        {Boolean(user) &&
          !isReviewing &&
          !reviews.some(r => r.userId === user?.uid) && (
            <Button
              size="sm"
              variant="outline"
              disabled={!isOnline}
              title={!isOnline ? 'Unavailable while offline' : undefined}
              onClick={() => isOnline && setIsReviewing(true)}
              className="h-8 px-3.5 text-xs font-sans font-semibold rounded-lg"
            >
              Write Review
            </Button>
          )}
      </div>

      {Boolean(user) && isReviewing && (
        <div className="bg-surface-container-low rounded-xl p-4 sm:p-5 mb-5 border border-outline-variant/60 swiper-no-swiping">
          <div className="mb-3.5 swiper-no-swiping">
            <StarRating
              interactive
              rating={reviewRating}
              onRatingChange={setReviewRating}
              size="lg"
            />
          </div>
          <Textarea
            value={reviewText}
            onChange={e => setReviewText(e.target.value)}
            placeholder="What did you think of this book?"
            className="w-full bg-surface border-outline-variant/60 rounded-lg p-3.5 text-sm text-on-surface min-h-[110px] mb-4 resize-y swiper-no-swiping"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsReviewing(false);
                setReviewRating(0);
                setReviewText('');
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveReview}
              disabled={!isOnline || isSavingReview}
              title={!isOnline ? 'Unavailable while offline' : undefined}
            >
              {isSavingReview ? 'Saving...' : 'Save Review'}
            </Button>
          </div>
        </div>
      )}

      {reviews.length === 0 ? (
        <p className="text-on-surface-variant italic text-sm font-sans">
          No notes or reviews yet. Share your thoughts when you&apos;re ready.
        </p>
      ) : (
        <div className="divide-y divide-outline-variant/50">
          {reviews.map(review => (
            <div key={review.id} className="py-4 first:pt-1 last:pb-0">
              <div className="flex items-center justify-between gap-3 mb-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-tertiary/12 border border-tertiary/25 flex items-center justify-center text-tertiary font-serif font-semibold text-sm shrink-0">
                    {review.userName?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <div className="min-w-0">
                    <p className="font-sans text-sm font-semibold text-on-surface truncate">
                      {review.userName}
                    </p>
                    <div className="flex items-center gap-1 mt-0.5 text-tertiary swiper-no-swiping">
                      <StarRating rating={review.rating} size="sm" />
                    </div>
                  </div>
                </div>
                <span className="font-mono tabular-nums text-[11px] text-on-surface-variant uppercase tracking-wider shrink-0">
                  {typeof review.createdAt === 'string' &&
                  !isNaN(new Date(review.createdAt).getTime())
                    ? formatShortDate(new Date(review.createdAt))
                    : review.createdAt instanceof Date &&
                        !isNaN(review.createdAt.getTime())
                      ? formatShortDate(review.createdAt)
                      : typeof review.createdAt === 'object' &&
                          review.createdAt !== null &&
                          'toDate' in review.createdAt &&
                          typeof (review.createdAt as {toDate: () => Date})
                            .toDate === 'function'
                        ? formatShortDate(
                            (review.createdAt as {toDate: () => Date}).toDate(),
                          )
                        : 'Just now'}
                </span>
              </div>
              {review.text && (
                <p className="text-on-surface/90 font-sans leading-relaxed text-sm whitespace-pre-wrap pl-12">
                  {review.text}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
