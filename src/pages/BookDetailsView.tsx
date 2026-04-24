import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, collection, query, onSnapshot, orderBy, updateDoc, Timestamp, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { generateBookInsights } from '../services/gemini';
import { fetchAuthorBioFromWikipedia } from '../services/wikipediaApi';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import { toTitleCase } from '../lib/utils';
import { BookDetails } from '../services/bookApi';
import { ArrowLeft, Edit2, Share2, Settings, Loader2, Book as BookIcon, User } from 'lucide-react';
import AppLayout from '../components/AppLayout';

type FirestoreDate = Timestamp | Date | string | number;

interface Book extends BookDetails {
  id: string;
  addedBy: string;
  addedAt: FirestoreDate;
  synopsis?: string;
  authorBio?: string;
  readingStatus?: 'unset' | 'reading' | 'finished' | 'abandoned';
}

interface Review {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  text: string;
  createdAt: FirestoreDate;
}

export default function BookDetailsView() {
  const { libraryId, bookId } = useParams<{ libraryId: string, bookId: string }>();
  const { user, logOut } = useAuth();
  const navigate = useNavigate();

  const [book, setBook] = useState<Book | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [activeInsight, setActiveInsight] = useState<'catchup' | 'similar' | null>(null);
  const [insightContent, setInsightContent] = useState<string | null>(null);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);

  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [isSavingReview, setIsSavingReview] = useState(false);

  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const hasAttemptedGeneration = useRef(false);

  useEffect(() => {
    if (!libraryId || !user) return;

    // Fetch Library to check permissions
    const checkPerms = async () => {
      try {
        const libDoc = await getDoc(doc(db, 'libraries', libraryId));
        if (libDoc.exists()) {
          const data = libDoc.data();
          setCanEdit(data.ownerId === user.uid || (data.sharedWith && data.sharedWith.includes(user.email || '')));
        }
      } catch (err) {
        console.error("Error fetching library perms:", err);
      }
    };
    checkPerms();
  }, [libraryId, user]);

  useEffect(() => {
    if (!libraryId || !bookId) return;

    // Fetch Book
    const unsubscribeBook = onSnapshot(doc(db, 'libraries', libraryId, 'books', bookId), (docSnap) => {
      if (docSnap.exists()) {
        const bookData = { id: docSnap.id, ...docSnap.data() } as Book;
        setBook(bookData);
      } else {
        toast.error("Book not found");
        navigate(`/library/${libraryId}`);
      }
      setIsLoading(false);
    }, (error) => {
      console.error("Book fetch error:", error);
      handleFirestoreError(error, OperationType.GET, `libraries/${libraryId}/books/${bookId}`);
      setIsLoading(false);
    });

    const reviewsRef = collection(db, 'libraries', libraryId, 'books', bookId, 'reviews');
    const q = query(reviewsRef, orderBy('createdAt', 'desc'));
    const unsubscribeReviews = onSnapshot(q, (snapshot) => {
      const revs: Review[] = [];
      snapshot.forEach((doc) => {
        revs.push({ id: doc.id, ...doc.data() } as Review);
      });
      setReviews(revs);
    }, (error) => {
      console.error("Reviews fetch error:", error);
    });

    return () => {
      unsubscribeBook();
      unsubscribeReviews();
    };
  }, [libraryId, bookId, navigate]);

  // Separate effect for auto-generating missing data
  useEffect(() => {
    if (!book || !canEdit || !libraryId || !bookId) return;

    const generateMissing = async () => {
      if (hasAttemptedGeneration.current) return;
      hasAttemptedGeneration.current = true;

      let updatesNeeded: Partial<Book> = {};
      
      if (!book.synopsis) {
        if (book.description) {
          updatesNeeded.synopsis = book.description;
        } else {
           try {
              const syn = await generateBookInsights(book.title, book.author, 'summary');
              updatesNeeded.synopsis = syn;
           } catch(e) {}
        }
      }
      
      if (!book.authorBio) {
         try {
            // First try Wikipedia
            let bio = await fetchAuthorBioFromWikipedia(book.author);
            
            // Fallback to Gemini if Wikipedia returns nothing
            if (!bio) {
              bio = await generateBookInsights(book.title, book.author, 'author_bio');
            }
            
            if (bio) {
               updatesNeeded.authorBio = bio;
            }
         } catch(e) {}
      }
      
      if (Object.keys(updatesNeeded).length > 0) {
         try {
           await updateDoc(doc(db, 'libraries', libraryId, 'books', bookId), {
             ...updatesNeeded,
             addedBy: book.addedBy || user?.uid,
             addedAt: book.addedAt || serverTimestamp()
           });
         } catch(e) { console.error(e); }
      }
    };

    if (!book.synopsis || !book.authorBio) {
      generateMissing();
    }
  }, [book?.synopsis, book?.description, book?.authorBio, book?.title, book?.author, canEdit, libraryId, bookId]);

  const handleGenerateInsight = async (type: 'catchup' | 'similar') => {
    if (!book) return;
    
    setActiveInsight(type);
    setIsGeneratingInsight(true);
    setInsightContent(null);
    
    try {
      const content = await generateBookInsights(book.title, book.author, type);
      setInsightContent(content);
    } catch (error: unknown) {
      toast.error("Failed to generate insights. Please try again.");
      setActiveInsight(null);
    } finally {
      setIsGeneratingInsight(false);
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
      await addDoc(collection(db, 'libraries', libraryId, 'books', book.id, 'reviews'), {
        userId: user.uid,
        userName: user.displayName || user.email || 'Unknown User',
        rating: reviewRating,
        text: reviewText.trim(),
        createdAt: serverTimestamp()
      });
      toast.success("Review added");
      setIsReviewing(false);
      setReviewRating(0);
      setReviewText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `libraries/${libraryId}/books/${book.id}/reviews`);
    } finally {
      setIsSavingReview(false);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-on-background">Loading...</div>;
  }

  if (!book) return null;

  return (
    <AppLayout
      sidebarActions={
        <Link 
          to={`/library/${libraryId}`}
          className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 font-serif text-lg tracking-tight"
        >
          <ArrowLeft className="w-5 h-5 text-outline" />
          <span>Back to Library</span>
        </Link>
      }
    >
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-8 max-w-[1200px] mx-auto w-full">
          


          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12">
            {/* Left Column */}
            <div className="md:col-span-4 flex flex-col gap-6">
              <div className="aspect-[2/3] w-full bg-surface-container rounded-lg overflow-hidden architectural-shadow relative">
                {book.coverUrl ? (
                   <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
                ) : (
                   <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                     <BookIcon className="w-16 h-16 text-primary opacity-50" />
                   </div>
                )}
                {/* Status Badge */}
                {book.readingStatus && book.readingStatus !== 'unset' && (
                  <div className={`absolute top-4 right-4 font-label-caps text-label-caps px-3 py-1 rounded shadow-sm ${
                    book.readingStatus === 'reading' ? 'bg-primary text-on-primary' :
                    book.readingStatus === 'finished' ? 'bg-[#2f4d40] text-white' :
                    'bg-error text-on-error'
                  }`}>
                      {book.readingStatus === 'reading' ? 'READING' : 
                       book.readingStatus === 'finished' ? 'FINISHED' : 
                       'ABANDONED'}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column */}
            <div className="md:col-span-8 flex flex-col gap-10">
              
              {/* Header Info */}
              <div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {book.genre && (
                    <span className="bg-tertiary-container/10 text-tertiary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem]">
                      {book.genre.toUpperCase()}
                    </span>
                  )}
                  {book.series && book.series !== 'Standalone' && (
                    <span className="bg-secondary-container/10 text-secondary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem]">
                      {book.series.toUpperCase()}
                    </span>
                  )}
                </div>
                <h1 className="font-headline-xl text-headline-xl text-primary mb-2">{toTitleCase(book.title)}</h1>
                <h2 className="font-headline-md text-headline-md text-secondary mb-6">by {toTitleCase(book.author)}</h2>
                
                <div className="flex flex-wrap items-center gap-6 text-on-surface-variant text-[14px] font-body-md border-b border-surface-dim pb-6">
                  <div className="flex flex-col">
                    <span className="text-outline uppercase text-xs tracking-wider mb-1">Published</span>
                    <span>{book.publishedDate || 'Unknown'}</span>
                  </div>
                  <div className="w-px h-8 bg-surface-variant hidden sm:block"></div>
                  <div className="flex flex-col">
                    <span className="text-outline uppercase text-xs tracking-wider mb-1">Format</span>
                    <span className="capitalize">{book.format || 'Physical'}</span>
                  </div>
                  <div className="w-px h-8 bg-surface-variant hidden sm:block"></div>
                  <div className="flex flex-col">
                    <span className="text-outline uppercase text-xs tracking-wider mb-1">ISBN</span>
                    <span>{book.isbn || 'Unknown'}</span>
                  </div>
                </div>
              </div>

              {/* Reading Status */}
              <section className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-surface-container p-4 rounded-lg border border-outline-variant/30 w-fit">
                <label htmlFor="readingStatus" className="font-label-caps text-label-caps text-outline uppercase tracking-wider">Reading Status</label>
                <select
                  id="readingStatus"
                  value={book.readingStatus || 'unset'}
                  onChange={async (e) => {
                    if (!libraryId || !bookId || !canEdit) return;
                    const newStatus = e.target.value;
                    try {
                      await updateDoc(doc(db, 'libraries', libraryId, 'books', bookId), {
                        readingStatus: newStatus,
                        addedBy: book.addedBy || user?.uid,
                        addedAt: book.addedAt || serverTimestamp()
                      });
                      toast.success("Reading status updated");
                    } catch (err) {
                      toast.error("Failed to update status");
                    }
                  }}
                  disabled={!canEdit}
                  className="px-4 py-2 bg-surface text-on-surface border border-outline-variant/60 rounded focus:ring-1 focus:ring-primary focus:outline-none cursor-pointer disabled:opacity-50 appearance-none min-w-[180px] text-sm font-medium"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 0.75rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1em' }}
                >
                  <option value="unset">Not Started</option>
                  <option value="reading">Currently Reading</option>
                  <option value="finished">Finished</option>
                  <option value="abandoned">Abandoned</option>
                </select>
              </section>

              {/* Synopsis */}
              <section>
                <h3 className="font-headline-md text-[24px] text-primary mb-4">Synopsis</h3>
                <div className="font-body-lg text-body-lg text-on-surface space-y-4 leading-relaxed">
                  {book.synopsis ? (
                     <div className="markdown-body">
                       <Markdown>{book.synopsis}</Markdown>
                     </div>
                  ) : (
                     <div className="flex items-center gap-2 text-outline"><Loader2 className="animate-spin" size={20}/> Fetching synopsis...</div>
                  )}
                </div>
              </section>

              {/* Author Bio Bento Box */}
              <section className="bg-surface-container-lowest rounded-lg border border-surface-variant p-8 architectural-shadow">
                <div className="flex flex-col sm:flex-row gap-6 items-start">
                  <div className="w-24 h-24 rounded-full overflow-hidden shrink-0 border-2 border-surface-container bg-surface flex items-center justify-center">
                    <User className="w-12 h-12 text-outline" />
                  </div>
                  <div>
                    <h3 className="font-headline-md text-[24px] text-primary mb-1">About {toTitleCase(book.author)}</h3>
                    <div className="font-body-md text-[16px] text-on-surface leading-relaxed mt-4">
                      {book.authorBio ? (
                         <div className="markdown-body">
                           <Markdown>{book.authorBio}</Markdown>
                         </div>
                      ) : (
                         <div className="flex items-center gap-2 text-outline"><Loader2 className="animate-spin" size={20}/> Fetching bio...</div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* AI Features */}
              <section className="mt-8">
                <div className="flex flex-wrap gap-4 mb-6">
                  <button
                    onClick={() => handleGenerateInsight('catchup')}
                    className={`px-6 py-2 rounded-full font-label-caps text-label-caps transition-all border ${
                      activeInsight === 'catchup' 
                        ? 'bg-primary text-on-primary border-primary' 
                        : 'bg-transparent text-primary border-primary hover:bg-primary/5'
                    }`}
                  >
                    CATCH ME UP (SPOILERS)
                  </button>
                  <button
                    onClick={() => handleGenerateInsight('similar')}
                    className={`px-6 py-2 rounded-full font-label-caps text-label-caps transition-all border ${
                      activeInsight === 'similar' 
                        ? 'bg-primary text-on-primary border-primary' 
                        : 'bg-transparent text-primary border-primary hover:bg-primary/5'
                    }`}
                  >
                    OTHER BOOKS LIKE THIS
                  </button>
                </div>

                {activeInsight && (
                  <div className="bg-surface-container-lowest rounded-lg p-6 sm:p-8 architectural-shadow border border-surface-variant">
                    {isGeneratingInsight ? (
                      <div className="flex items-center gap-3 text-outline">
                        <Loader2 className="animate-spin" size={24} />
                        <p>Consulting the AI...</p>
                      </div>
                    ) : insightContent ? (
                      <div className="markdown-body">
                        <Markdown>{insightContent}</Markdown>
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
              
              {/* Reviews */}
              <section className="mt-8 border-t border-surface-dim pt-12">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="font-headline-md text-[24px] text-primary">Reviews</h3>
                  {canEdit && !isReviewing && !reviews.some(r => r.userId === user?.uid) && (book.readingStatus === 'finished' || book.readingStatus === 'abandoned') && (
                    <button
                      className="px-6 py-2 rounded-full font-label-caps text-label-caps bg-primary text-on-primary hover:bg-primary/90 transition-colors shadow-sm"
                      onClick={() => setIsReviewing(true)}
                    >
                      WRITE REVIEW
                    </button>
                  )}
                </div>

                {isReviewing && (book.readingStatus === 'finished' || book.readingStatus === 'abandoned') && (
                  <div className="bg-surface-container rounded-lg p-6 mb-8 border border-surface-variant">
                    <div className="flex items-center gap-2 mb-4">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setReviewRating(star)}
                          className="focus:outline-none transition-transform hover:scale-110"
                        >
                          <svg className={`w-8 h-8 ${star <= reviewRating ? 'fill-secondary text-secondary' : 'text-outline/30 fill-current hover:text-secondary/50'}`} viewBox="0 0 24 24">
                            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                          </svg>
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={reviewText}
                      onChange={(e) => setReviewText(e.target.value)}
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
                    reviews.map((review) => (
                      <div key={review.id} className="bg-surface-container-lowest rounded-lg p-6 border border-surface-variant architectural-shadow">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                              {review.userName?.charAt(0)?.toUpperCase() || 'U'}
                            </div>
                            <div>
                              <p className="font-medium text-primary">{review.userName}</p>
                              <div className="flex items-center gap-1 mt-1 text-secondary">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <svg key={star} className={`w-4 h-4 ${star <= review.rating ? 'fill-current' : 'text-outline/30 fill-current'}`} viewBox="0 0 24 24">
                                    <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                                  </svg>
                                ))}
                              </div>
                            </div>
                          </div>
                          <span className="text-xs text-outline uppercase tracking-wider">
                            {typeof review.createdAt === 'object' && review.createdAt !== null && 'toDate' in review.createdAt && typeof (review.createdAt as any).toDate === 'function' ? (review.createdAt as any).toDate().toLocaleDateString() : 'Just now'}
                          </span>
                        </div>
                        <p className="text-on-surface leading-relaxed text-body-md whitespace-pre-wrap">{review.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </section>
              
            </div>
          </div>
        </div>
    </AppLayout>
  );
}
