import {useState} from 'react';
import {
  collection,
  writeBatch,
  doc,
  serverTimestamp,
  increment,
  updateDoc,
} from 'firebase/firestore';
import {db} from '../../firebase';
import {BookDetails} from '../../services/bookApi';
import {BookDetailsPayload} from '../../types';
import {enrichBooksMetadata} from '../../services/gemini';
import {useAuth} from '../../contexts/AuthContext';

export function useAddBooks(libraryId?: string) {
  const {user} = useAuth();
  const [isAddingAll, setIsAddingAll] = useState(false);

  const addBooks = async (booksToAddFast: BookDetails[]) => {
    if (!libraryId || !user) throw new Error('Library or user not found');
    if (booksToAddFast.length === 0) return;

    setIsAddingAll(true);
    try {
      // 1. Enrich missing series in batched format via gemini API
      const enrichedBooks = booksToAddFast.map(book => ({
        ...book,
        format: book.format || 'physical',
      }));
      const booksMissingSeriesArr = enrichedBooks
        .map((b, i) => ({
          id: i.toString(),
          title: b.title || '',
          author: b.author || '',
          synopsis: b.synopsis || '',
        }))
        .filter(
          b => b.title && enrichedBooks[parseInt(b.id)].series === undefined,
        );

      if (booksMissingSeriesArr.length > 0) {
        try {
          const enrichments = await enrichBooksMetadata(booksMissingSeriesArr);
          if (enrichments && enrichments.length > 0) {
            const enrichMap = new Map(enrichments.map(e => [e.id, e.series]));
            for (const b of booksMissingSeriesArr) {
              const series = enrichMap.get(b.id);
              if (series) {
                const idx = parseInt(b.id);
                if (idx >= 0 && idx < enrichedBooks.length) {
                  enrichedBooks[idx].series = series;
                }
              }
            }
          }
        } catch (err) {
          console.warn('Failed to enrich metadata on batch add', err);
        }
      }

      // 2. Prepare cleanly sized payloads and use writeBatch
      const finalCleanBooks: BookDetails[] = [];
      for (let i = 0; i < enrichedBooks.length; i += 500) {
        const batchList = enrichedBooks.slice(i, i + 500);
        const batchRef = writeBatch(db);

        for (const enrichedDetails of batchList) {
          const cleanDetails = Object.fromEntries(
            Object.entries(enrichedDetails).filter(
              ([, v]) => v !== undefined && v !== null && v !== '',
            ),
          ) as Record<string, string | string[] | undefined>;

          if (cleanDetails.genres && Array.isArray(cleanDetails.genres))
            cleanDetails.genres = cleanDetails.genres
              .map((g: string) => g.substring(0, 100))
              .slice(0, 20);
          if (typeof cleanDetails.author === 'string')
            cleanDetails.author = cleanDetails.author.substring(0, 500);
          if (typeof cleanDetails.series === 'string')
            cleanDetails.series = cleanDetails.series.substring(0, 100);
          if (typeof cleanDetails.title === 'string')
            cleanDetails.title = cleanDetails.title.substring(0, 500);

          const newDocRef = doc(
            collection(db, 'libraries', libraryId, 'books'),
          );

          // Split heavy data from lightweight data
          const {
            synopsis,
            authorBio,
            embedding,
            clusterCoordinates,
            ...lightweightData
          } = cleanDetails;

          batchRef.set(newDocRef, {
            ...lightweightData,
            addedBy: user.uid,
            addedAt: serverTimestamp(),
          });

          // Write heavy payload to bookDetails subcollection
          const heavyData: BookDetailsPayload = {
            synopsis: synopsis as string | undefined,
            authorBio: authorBio as string | undefined,
            embedding: embedding as number[] | undefined,
            clusterCoordinates: clusterCoordinates as
              | {x: number; y: number}
              | undefined,
          };

          const cleanHeavyData = Object.fromEntries(
            Object.entries(heavyData).filter(([, v]) => v !== undefined),
          );

          if (Object.keys(cleanHeavyData).length > 0) {
            const detailRef = doc(
              db,
              'libraries',
              libraryId,
              'bookDetails',
              newDocRef.id,
            );
            batchRef.set(detailRef, cleanHeavyData);
          }

          finalCleanBooks.push(enrichedDetails);
        }

        // Wait, for offline-first, if they add a book and immediately shut the app,
        // writeBatch resolves later. We won't block the UI with an await if we want fast optimistic UI,
        // but for now we'll await so we don't proceed without queuing. Fireblocks offline sync queues this anyway.
        await batchRef.commit();
      }

      if (finalCleanBooks.length > 0 && libraryId) {
        // Fire-and-forget stats update
        updateDoc(doc(db, 'libraries', libraryId), {
          bookCount: increment(finalCleanBooks.length),
        }).catch(err => console.warn('Failed to update stats offline', err));
      }

      return finalCleanBooks;
    } finally {
      setIsAddingAll(false);
    }
  };

  return {addBooks, isAddingAll};
}
