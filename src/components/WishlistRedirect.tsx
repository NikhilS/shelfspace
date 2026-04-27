import React, {useEffect} from 'react';
import {Navigate, useNavigate} from 'react-router-dom';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {db} from '../firebase';
import {useAuth} from '../contexts/AuthContext';
import {Loader2} from 'lucide-react';

export default function WishlistRedirect() {
  const {user} = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;

    async function ensureWishlist() {
      try {
        const q = query(
          collection(db, 'libraries'),
          where('ownerId', '==', user.uid),
          where('isWishlist', '==', true),
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          navigate(`/library/${doc.id}`, {replace: true});
        } else {
          // Create the Wishlist library
          const docRef = await addDoc(collection(db, 'libraries'), {
            name: 'My Wishlist',
            ownerId: user.uid,
            ownerName:
              user.displayName || user.email?.split('@')[0] || 'Unknown User',
            heroImageUrl: '', // Empty or default string for image
            createdAt: serverTimestamp(),
            isWishlist: true,
          });
          navigate(`/library/${docRef.id}`, {replace: true});
        }
      } catch (e) {
        console.error('Error ensuring wishlist:', e);
        navigate('/', {replace: true});
      }
    }

    ensureWishlist();
  }, [user, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-on-surface-variant font-serif italic text-lg">
          Finding your wishlist...
        </p>
      </div>
    </div>
  );
}
