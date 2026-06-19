import {useState, useEffect} from 'react';
import {collection, doc, getDocs, deleteField} from 'firebase/firestore';
import {db} from '../firebase';
import {kmeans} from '../lib/clustering';
import {BookDetails} from '../services/bookApi';
import {trpc} from '../lib/trpc';

interface BookDoc extends BookDetails {
  id: string;
  embedding?: number[];
}

export interface ScatterPoint {
  x: number;
  y: number;
  book: BookDoc;
  clusterId: number;
}

export function useConstellationData(libraryId: string | undefined) {
  const [books, setBooks] = useState<BookDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<string>('Loading books...');
  const [plotData, setPlotData] = useState<ScatterPoint[]>([]);
  const [clusterNames, setClusterNames] = useState<Record<number, string>>({});
  const [reclusterTrigger, setReclusterTrigger] = useState(0);

  const generateBookEmbeddingsMutation =
    trpc.gemini.generateBookEmbeddings.useMutation();
  const generateClusterNamesMutation =
    trpc.gemini.generateClusterNames.useMutation();

  useEffect(() => {
    let isMounted = true;

    async function processMap() {
      if (!libraryId) return;
      try {
        setLoading(true);
        setProgress('Fetching library data...');
        const [booksSnapshot, detailsSnapshot] = await Promise.all([
          getDocs(collection(db, 'libraries', libraryId, 'books')),
          getDocs(collection(db, 'libraries', libraryId, 'bookDetails')),
        ]);

        const detailsMap = new Map();
        detailsSnapshot.forEach(doc => detailsMap.set(doc.id, doc.data()));

        const allBooks: BookDoc[] = [];

        booksSnapshot.forEach(docSnap => {
          const bData = docSnap.data();
          const detail = detailsMap.get(docSnap.id) || {};
          const merged = {id: docSnap.id, ...bData, ...detail};

          allBooks.push(merged as BookDoc);
        });

        if (!isMounted) return;
        setBooks(allBooks);

        if (allBooks.length < 3) {
          setProgress(
            'Not enough books to form a constellation (minimum 3 needed).',
          );
          setLoading(false);
          return;
        }

        const toEmbed = allBooks.filter(
          b => !b.embedding || b.embedding.length === 0,
        );

        if (toEmbed.length > 0) {
          setProgress(
            `Generating AI embeddings for ${toEmbed.length} books... (0%)`,
          );
          const texts = toEmbed.map(b => {
            const parts = [b.title];
            if (b.author) parts.push(`by ${b.author}`);
            if (b.genres && b.genres.length > 0)
              parts.push(`[${b.genres.join(', ')}]`);
            if (b.synopsis) parts.push(b.synopsis);
            return parts.join(' - ');
          });

          const embeddings = await generateBookEmbeddingsMutation.mutateAsync(
            {texts},
            {
              onSuccess: () => {
                setProgress('Generating AI embeddings... (100%)');
              },
            },
          );
          if (!embeddings || embeddings.length !== toEmbed.length) {
            throw new Error('Failed to generate correct number of embeddings.');
          }

          setProgress(`Saving embeddings to library... (0/${toEmbed.length})`);
          const {ClientBulkWriter} = await import('../lib/clientBulkWriter');
          const writer = new ClientBulkWriter(db, 50);

          for (let j = 0; j < toEmbed.length; j++) {
            const ref = doc(
              db,
              'libraries',
              libraryId,
              'bookDetails',
              toEmbed[j].id,
            );
            writer.set(ref, {embedding: embeddings[j]}, {merge: true});
            toEmbed[j].embedding = embeddings[j];
          }

          await writer.close();
          setProgress(
            `Saving embeddings to library... (${toEmbed.length}/${toEmbed.length})`,
          );
        }

        setProgress('Running UMAP dimensionality reduction...');
        await new Promise(r => setTimeout(r, 100));

        const validBooks = allBooks.filter(
          b => b.embedding && b.embedding.length > 0,
        );
        if (validBooks.length < 3) {
          setProgress('Not enough valid embeddings to map.');
          setLoading(false);
          return;
        }

        const nNeighbors = Math.min(15, Math.max(2, validBooks.length - 1));
        const embeddingData = validBooks.map(b => b.embedding as number[]);

        setProgress('Projecting semantic space with UMAP...');
        await new Promise(r => setTimeout(r, 60));

        const fittings = await (async () => {
          const {UMAP} = await import('umap-js');
          const umap = new UMAP({
            nNeighbors,
            minDist: 0.1,
            nComponents: 2,
            nEpochs: 400,
          });
          return umap.fit(embeddingData);
        })();

        setProgress('Clustering to find relationships...');
        await new Promise(r => setTimeout(r, 100));

        const targetK = Math.min(
          12,
          Math.max(2, Math.floor(validBooks.length / 8)),
        );
        const clusters = kmeans(fittings, targetK);

        const newPlotData = validBooks.map((book, idx) => ({
          x: fittings[idx][0],
          y: fittings[idx][1],
          book,
          clusterId: clusters[idx],
        }));

        setProgress('Naming constellations with AI...');
        await new Promise(r => setTimeout(r, 100));
        const groupedClusters: Record<number, BookDoc[]> = {};
        newPlotData.forEach(p => {
          if (p.clusterId !== -1) {
            if (!groupedClusters[p.clusterId])
              groupedClusters[p.clusterId] = [];
            groupedClusters[p.clusterId].push(p.book);
          }
        });
        const clusterArray = Object.keys(groupedClusters).map(cid => ({
          id: parseInt(cid),
          books: groupedClusters[parseInt(cid)].map(b => ({
            title: b.title,
            author: b.author,
          })),
        }));

        if (clusterArray.length > 0) {
          const names = await generateClusterNamesMutation.mutateAsync({
            clusters: clusterArray,
          });
          if (isMounted) setClusterNames(names);
        }

        if (isMounted) {
          setPlotData(newPlotData);
          setLoading(false);
        }
      } catch (err: unknown) {
        console.error('Map generation error:', err);
        if (isMounted) {
          setProgress(
            err instanceof Error
              ? err.message
              : 'Error building constellation map.',
          );
          setLoading(false);
        }
      }
    }

    void processMap();

    return () => {
      isMounted = false;
    };
  }, [libraryId, reclusterTrigger]);

  const handleRecluster = async () => {
    if (!libraryId || loading) return;
    try {
      setLoading(true);
      setProgress('Clearing old embeddings...');
      const {ClientBulkWriter} = await import('../lib/clientBulkWriter');
      const writer = new ClientBulkWriter(db, 400);

      for (let j = 0; j < books.length; j++) {
        writer.update(
          doc(db, 'libraries', libraryId, 'bookDetails', books[j].id),
          {
            embedding: deleteField(),
          },
        );
      }
      await writer.close();
      setClusterNames({});
      setReclusterTrigger(prev => prev + 1);
    } catch (err) {
      console.error(err);
      setProgress('Failed to clear embeddings');
      setLoading(false);
    }
  };

  return {loading, progress, plotData, clusterNames, handleRecluster};
}
