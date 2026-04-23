import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, collection, query, onSnapshot, orderBy, updateDoc, Timestamp, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { generateBookInsights } from '../services/gemini';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import { toTitleCase } from '../lib/utils';
import { BookDetails } from '../services/bookApi';
import { ArrowLeft, Edit2, Share2, Settings, Loader2 } from 'lucide-react';

type FirestoreDate = Timestamp | Date | string | number;

interface Book extends BookDetails {
  id: string;
  addedBy: string;
  addedAt: FirestoreDate;
  synopsis?: string;
  authorBio?: string;
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
            const bio = await generateBookInsights(book.title, book.author, 'author_bio');
            updatesNeeded.authorBio = bio;
         } catch(e) {}
      }
      
      if (Object.keys(updatesNeeded).length > 0) {
         try {
           await updateDoc(doc(db, 'libraries', libraryId, 'books', bookId), updatesNeeded);
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
    <div className="bg-background text-on-background font-body-md text-body-md antialiased flex min-h-screen relative w-full overflow-x-hidden">
      
      {/* Mobile Nav Overlay */}
      {isMobileNavOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      {/* SideNavBar Component */}
      <nav className={`fixed left-0 top-0 flex flex-col h-screen w-64 py-8 border-r border-outline-variant/30 bg-surface shadow-md md:shadow-none z-50 transition-transform duration-300 ease-in-out md:translate-x-0 ${isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-6 mb-8 flex flex-col gap-1">
          <Link to="/" className="text-2xl font-headline-md italic text-primary tracking-tight">Athenaeum</Link>
          <span className="text-on-surface-variant font-body-md text-sm opacity-80">Modern Archivist</span>
        </div>
        
        <div className="flex-grow flex flex-col gap-2">
          <Link 
            to={`/library/${libraryId}`}
            onClick={() => setIsMobileNavOpen(false)}
            className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 font-serif text-lg tracking-tight"
          >
            <span className="material-symbols-outlined text-primary">arrow_back</span>
            <span>Back to Library</span>
          </Link>
        </div>
        
        <div className="mt-auto">
          <button 
            onClick={logOut}
            className="flex items-center gap-3 text-on-surface hover:text-primary pl-6 py-3 hover:bg-surface-container transition-colors duration-200 w-full text-left font-serif text-lg tracking-tight"
          >
            <span className="material-symbols-outlined text-primary">logout</span>
            <span>Logout</span>
          </button>
        </div>
      </nav>

      {/* Main Content Wrapper */}
      <main className="flex-1 flex flex-col md:ml-64 pt-16 md:pt-0 min-h-screen">
        
        {/* TopNavBar */}
        <header className="flex justify-between items-center h-16 px-8 fixed md:sticky top-0 w-full md:w-auto z-40 bg-surface/80 backdrop-blur-md border-b border-outline-variant/30 shadow-[0_8px_30px_rgb(26,47,75,0.04)] font-body-md text-on-background">
          <div className="flex items-center space-x-6 w-1/3">
            <button 
              className="md:hidden p-2 -ml-2 text-on-surface hover:text-primary rounded-full hover:bg-surface-container transition-colors flex items-center justify-center"
              onClick={() => setIsMobileNavOpen(true)}
            >
              <span className="material-symbols-outlined">menu</span>
            </button>
          </div>
          <div className="text-2xl font-headline-md italic text-primary w-1/3 text-center md:block">Athenaeum</div>
          <div className="flex items-center justify-end space-x-6 w-1/3 ml-auto text-outline">
            <button className="hover:text-primary transition-colors duration-200 ease-in-out">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <button className="hover:text-primary transition-colors duration-200 ease-in-out">
              <span className="material-symbols-outlined">settings</span>
            </button>
            <div className="h-8 w-8 rounded-full bg-surface-variant overflow-hidden">
               {user?.photoURL ? (
                 <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
               ) : (
                 <div className="w-full h-full flex items-center justify-center text-primary font-bold">
                   {user?.email?.[0]?.toUpperCase() || 'U'}
                 </div>
               )}
            </div>
          </div>
        </header>

        {/* Canvas */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-8 md:py-16 max-w-[1200px] mx-auto w-full">
          
          {/* Breadcrumbs */}
          <nav className="flex items-center space-x-2 text-on-surface-variant mb-8 text-sm">
            <Link className="hover:text-primary transition-colors" to={`/library/${libraryId}`}>Library</Link>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            <span className="hover:text-primary transition-colors">{book.genre || 'Collection'}</span>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            <span className="text-primary font-medium">{book.title}</span>
          </nav>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12">
            {/* Left Column */}
            <div className="md:col-span-4 flex flex-col gap-6">
              <div className="aspect-[2/3] w-full bg-surface-container rounded-lg overflow-hidden architectural-shadow relative">
                {book.coverUrl ? (
                   <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
                ) : (
                   <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                     <span className="material-symbols-outlined text-primary opacity-50" style={{ fontSize: '64px' }}>book</span>
                   </div>
                )}
                {/* Status Badge - Static for now or dynamically set based on reading status */}
                <div className="absolute top-4 right-4 bg-primary text-on-primary font-label-caps text-label-caps px-3 py-1 rounded">
                    READING
                </div>
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
                    <span className="material-symbols-outlined text-outline" style={{ fontSize: '48px'}}>person</span>
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
                  {canEdit && !isReviewing && !reviews.some(r => r.userId === user?.uid) && (
                    <button
                      className="px-6 py-2 rounded-full font-label-caps text-label-caps bg-primary text-on-primary hover:bg-primary/90 transition-colors shadow-sm"
                      onClick={() => setIsReviewing(true)}
                    >
                      WRITE REVIEW
                    </button>
                  )}
                </div>

                {isReviewing && (
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
      </main>
    </div>
  );
}
