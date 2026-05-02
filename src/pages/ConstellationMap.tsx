/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-floating-promises */
import React, {useState, useEffect} from 'react';
import {useParams, Link} from 'react-router-dom';
import {
  collection,
  doc,
  writeBatch,
  deleteField,
  getDocs,
} from 'firebase/firestore';
import {db} from '../firebase';
import {generateBookEmbeddings, generateClusterNames} from '../services/gemini';
import {ArrowLeft, Loader2, RefreshCw} from 'lucide-react';
import {kmeans} from '../lib/clustering';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import SidebarActions from '../components/SidebarActions';
import {BookDetails} from '../services/bookApi';

interface BookDoc extends BookDetails {
  id: string;
  embedding?: number[];
}

export default function ConstellationMap() {
  const {id: libraryId} = useParams<{id: string}>();
  const [books, setBooks] = useState<BookDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<string>('Loading books...');
  const [plotData, setPlotData] = useState<any[]>([]);
  const [clusterNames, setClusterNames] = useState<Record<number, string>>({});
  const [reclusterTrigger, setReclusterTrigger] = useState(0);

  // Distinct qualitative colors for categories
  const clusterColors = [
    '#3b82f6',
    '#ef4444',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
    '#f97316',
    '#6366f1',
    '#84cc16',
  ];

  useEffect(() => {
    let isMounted = true;

    async function processMap() {
      if (!libraryId) return;
      try {
        setLoading(true);
        setProgress('Fetching library data...');
        // 1. Fetch books and their corresponding heavy details
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

        // 2. Determine which books need embeddings
        const toEmbed = allBooks.filter(
          b => !b.embedding || b.embedding.length === 0,
        );

        if (toEmbed.length > 0) {
          setProgress(
            `Generating AI embeddings for ${toEmbed.length} books... (0%)`,
          );
          // Prepare text for embeddings (title + author + synopsis + genres)
          const texts = toEmbed.map(b => {
            const parts = [b.title];
            if (b.author) parts.push(`by ${b.author}`);
            if (b.genres && b.genres.length > 0)
              parts.push(`[${b.genres.join(', ')}]`);
            if (b.synopsis) parts.push(b.synopsis);
            return parts.join(' - ');
          });

          const embeddings = await generateBookEmbeddings(
            texts,
            (completed, total) => {
              setProgress(
                `Generating AI embeddings... (${Math.round((completed / total) * 100)}%)`,
              );
            },
          );
          if (!embeddings || embeddings.length !== toEmbed.length) {
            throw new Error('Failed to generate correct number of embeddings.');
          }

          setProgress(`Saving embeddings to library... (0/${toEmbed.length})`);
          // Save them back in batches of 50 to avoid request payload limits
          const BATCH_SIZE = 50;
          for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const slice = toEmbed.slice(i, i + BATCH_SIZE);
            const eSlice = embeddings.slice(i, i + BATCH_SIZE);
            for (let j = 0; j < slice.length; j++) {
              const ref = doc(
                db,
                'libraries',
                libraryId,
                'bookDetails',
                slice[j].id,
              );
              batch.set(ref, {embedding: eSlice[j]}, {merge: true});
              slice[j].embedding = eSlice[j]; // Update local memory too
            }
            await batch.commit();
            setProgress(
              `Saving embeddings to library... (${Math.min(i + BATCH_SIZE, toEmbed.length)}/${toEmbed.length})`,
            );
          }
        }

        setProgress('Running UMAP dimensionality reduction...');
        // Add a small artificial delay so UI renders the progress text
        await new Promise(r => setTimeout(r, 100));

        // Ensure all have embeddings before running
        const validBooks = allBooks.filter(
          b => b.embedding && b.embedding.length > 0,
        );
        if (validBooks.length < 3) {
          setProgress('Not enough valid embeddings to map.');
          setLoading(false);
          return;
        }

        // Run UMAP in Web Worker to avoid blocking UI thread
        const nNeighbors = Math.min(15, Math.max(2, validBooks.length - 1));
        const embeddingData = validBooks.map(b => b.embedding as number[]);

        setProgress('Projecting semantic space with UMAP...');
        const fittings = await new Promise<number[][]>((resolve, reject) => {
          const worker = new Worker(
            new URL('../workers/umapWorker.ts', import.meta.url),
            {
              type: 'module',
            },
          );
          worker.onmessage = e => {
            if (e.data.error) {
              reject(new Error(e.data.error));
            } else {
              resolve(e.data.reduced);
            }
            worker.terminate();
          };
          worker.onerror = err => {
            reject(err);
            worker.terminate();
          };
          worker.postMessage({embeddings: embeddingData, nNeighbors});
        });

        setProgress('Clustering to find relationships...');
        await new Promise(r => setTimeout(r, 100));

        // Use K-Means to cluster on the 2D UMAP space
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
        await new Promise(r => setTimeout(r, 100)); // give UI a tick
        const groupedClusters: Record<number, any[]> = {};
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
          const names = await generateClusterNames(clusterArray);
          // names should be { [id]: string }
          if (isMounted) setClusterNames(names);
        }

        if (isMounted) {
          setPlotData(newPlotData);
          setLoading(false);
        }
      } catch (err: any) {
        console.error('Map generation error:', err);
        if (isMounted) {
          setProgress(err?.message || 'Error building constellation map.');
          setLoading(false);
        }
      }
    }

    processMap();

    return () => {
      isMounted = false;
    };
  }, [libraryId, reclusterTrigger]);

  const handleRecluster = async () => {
    if (!libraryId || loading) return;
    try {
      setLoading(true);
      setProgress('Clearing old embeddings...');
      // batch delete all embeddings
      const BATCH_SIZE = 400; // firestore limit is 500
      for (let i = 0; i < books.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const slice = books.slice(i, i + BATCH_SIZE);
        for (let j = 0; j < slice.length; j++) {
          batch.update(
            doc(db, 'libraries', libraryId, 'bookDetails', slice[j].id),
            {
              embedding: deleteField(),
            },
          );
        }
        await batch.commit();
      }
      setClusterNames({});
      setReclusterTrigger(prev => prev + 1);
    } catch (err) {
      console.error(err);
      setProgress('Failed to clear embeddings');
      setLoading(false);
    }
  };

  const CustomTooltip = ({active, payload}: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const b = data.book as BookDoc;
      return (
        <div className="bg-surface border border-outline-variant p-3 shadow-lg rounded-xl max-w-[240px]">
          {b.coverUrl && (
            <img
              src={b.coverUrl}
              alt={b.title}
              className="w-full h-32 object-cover rounded mb-2 border border-outline-variant/30"
            />
          )}
          <p className="font-bold text-on-surface text-sm leading-tight mb-1">
            {b.title}
          </p>
          <p className="text-on-surface-variant text-xs">{b.author}</p>
          {b.genres && b.genres.length > 0 && (
            <p className="text-[10px] uppercase font-semibold text-primary mt-2">
              {b.genres[0]}
            </p>
          )}
          {data.clusterId >= 0 ? (
            <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] bg-secondary-container text-secondary-container-on">
              {clusterNames[data.clusterId] || `Cluster ${data.clusterId + 1}`}
            </span>
          ) : (
            <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] bg-surface-variant text-on-surface-variant">
              Uncategorized Star
            </span>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <>
      <SidebarActions>
        <Link
          to={`/library/${libraryId}`}
          className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
          <span>Back to Library</span>
        </Link>
      </SidebarActions>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-display text-on-surface mb-2">
              Constellation Map
            </h1>
            <p className="text-on-surface-variant text-sm max-w-xl">
              An AI-generated semantic map of your books. Books with similar
              themes, genres, and synopses are clustered closer together.
              Navigating the clusters reveals organic reading paths.
            </p>
          </div>

          <button
            onClick={handleRecluster}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-surface-container hover:bg-surface-variant text-on-surface text-sm font-medium rounded-full transition-colors border border-outline-variant disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Re-cluster Map
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container rounded-3xl border border-outline-variant p-8">
            <Loader2 size={48} className="text-primary animate-spin mb-4" />
            <p className="text-on-surface-variant font-medium animate-pulse">
              {progress}
            </p>
          </div>
        ) : plotData.length < 3 ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] bg-surface-container rounded-3xl border border-outline-variant p-8">
            <p className="text-on-surface-variant font-medium">{progress}</p>
          </div>
        ) : (
          <div className="relative w-full h-[600px] md:h-[700px] bg-paper rounded-3xl border border-outline-variant shadow-sm overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{top: 20, right: 20, bottom: 20, left: 20}}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="x"
                  domain={['auto', 'auto']}
                  hide
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="y"
                  domain={['auto', 'auto']}
                  hide
                />
                <Tooltip
                  content={<CustomTooltip />}
                  cursor={{strokeDasharray: '3 3'}}
                />
                <Scatter name="Books" data={plotData} fill="#8884d8">
                  {plotData.map((entry, index) => {
                    const isNoise = entry.clusterId === -1;
                    const baseColor = isNoise
                      ? '#a8a29e'
                      : clusterColors[entry.clusterId % clusterColors.length];
                    return (
                      <Cell
                        key={`cell-${index}`}
                        fill={baseColor}
                        opacity={isNoise ? 0.3 : 0.8}
                        style={{
                          filter: isNoise
                            ? 'none'
                            : 'drop-shadow(0px 0px 4px rgba(255,255,255,0.4))',
                        }}
                      />
                    );
                  })}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>

            {/* Map Legend */}
            <div className="absolute bottom-4 left-4 bg-surface/90 backdrop-blur border border-outline-variant p-3 rounded-xl shadow-lg">
              <h4 className="text-xs font-bold text-on-surface uppercase tracking-widest mb-2">
                Constellations
              </h4>
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-2">
                {Array.from(new Set(plotData.map(d => d.clusterId)))
                  .sort((a, b) => a - b)
                  .map(cid => {
                    if (cid === -1)
                      return (
                        <div
                          key="noise"
                          className="flex items-center gap-2 text-xs text-on-surface"
                        >
                          <div className="w-3 h-3 rounded-full bg-stone-400 opacity-30"></div>
                          <span>Uncategorized</span>
                        </div>
                      );
                    return (
                      <div
                        key={cid}
                        className="flex items-center gap-2 text-xs text-on-surface"
                      >
                        <div
                          className="w-3 h-3 rounded-full shadow-inner"
                          style={{
                            backgroundColor:
                              clusterColors[cid % clusterColors.length],
                          }}
                        ></div>
                        <span className="font-medium">
                          {clusterNames[cid] || `Cluster ${cid + 1}`}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
