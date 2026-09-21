# Design Document: Historical Temporal Timeline View
**Author**: Lead Systems & AI Architect  
**Project**: AI Studio Literary Geographer App  
**Status**: Architecture Phase (Design Approved)

---

## 1. Executive Summary & Objective

The **Historical Temporal Timeline** is a high-fidelity visual experience designed to map the historical eras represented within a reader's book collection. By parsing historical narratives, settings, and biographies, this feature visualizes the "chronological coverage" of a user's library on a vertical timeline. 

### Key Objectives:
- **Batch Processing Efficiency**: Replicate the high-performance parallel chunking and single-roundtrip JSON extraction architecture designed for the Geographic Map feature to minimize token costs, avoid rate limits, and maximize speed.
- **Strict Scope Filtering**: Filter out and bypass sci-fi, space opera, high fantasy, and abstract academic textbooks (e.g., mathematical guides, modern theory manuals) before clustering, focusing purely on real-world earth histories and settings.
- **Interactive Vertical Navigation**: Provide a visually stunning, performant vertical timeline supporting logarithmic zoom levels (Century $\rightarrow$ Decade $\rightarrow$ Year) and smooth state transitions.
- **Architectural Integrity**: Ensure zero bundle bloat by selecting clean, tailor-fit layout libraries or lightweight custom SVG engines rather than injecting heavy modern 3D or WebGL layout dependencies.

---

## 2. Core Operational Flow & LLM Alignment

To match the performance profile of the Geo-Metadata extraction, we will utilize `gemini-3.5-flash` with a strict JSON schema output in a single-roundtrip batch call. 

### Batching Mechanics
1. **Queueing Phase**: A client-side state controller checks for books missing `temporalMetadata`.
2. **Primitive Dependency Guard**: Utilizing the *Primitive-Count Dependency pattern*, the front-end guards backfilling with a numeric helper `backfillQuotaCount` to prevent accidental re-render loops:
   ```ts
   const backfillQuotaCount = booksToBackfill.length;

   useEffect(() => {
     if (backfillQuotaCount > 0 && !isBooksLoading && !isBackfilling && user) {
       void triggerBatchBackfill();
     }
   }, [backfillQuotaCount, isBooksLoading, isBackfilling, user]);
   ```
3. **Gateway Call & Schema Mapping**: The backfilling logic slices books into batches of exactly **20 books per request**, invoking `/api/enrich-temporal`. The prompt and schema instruct Gemini to return temporal metadata mapped precisely to each book's unique identifier (`id`) provided in the request payload.
4. **Concurrent Pipelines**: To mirror the bulk uploading model of the geo-data module, up to **4 batch requests can be dispatched in parallel** simultaneously, maximizing throughput while remaining well within platform API rate boundaries.

### The Gemini JSON Schema & Prompt Design

The prompt instructs the AI model to behave as an academic bibliophile historian, extracting temporal ranges representing the plot, historical context, or action of each book.

#### Response Output Schema:
```typescript
interface TemporalBookResult {
  id: string; // The exact input book ID
  isNonHistorical: boolean; // True for Sci-Fi, high fantasy, abstract technical manuals, etc.
  startYear: number; // Approximate start year of the events (e.g., -44 for Julius Caesar's death)
  endYear: number; // Approximate end year (gap must not exceed 100 years)
  eraName: string; // Dynamic label of the era (e.g., "Late Roman Republic", "Viking Age", "Interwar Period")
  rationale: string; // Max 15 words explaining why this temporal context is critical
}

interface BatchTemporalResponse {
  enrichment: TemporalBookResult[];
}
```

#### System Instructions / Prompt Outline:
- **Rule 1 (100-Year Spanning Cap)**: If a general history spans multiple centuries (e.g., "A History of the Roman Empire"), the LLM must isolate the single *most definitive 100-year window* or focus area (e.g., Pax Romana, 27 BC – 180 AD truncated or capped to a high-density 100-year slot).
- **Rule 2 (Chronological Grounding)**: Years must represent real-world calendar parameters. BC/BCE is expressed as a negative integer.
- **Rule 3 (Fictional/Abstract Exclusion)**: Science fiction set in future eras, high fantasy with entirely fictional lore (e.g., Tolkien, Sanderson), or modern textbooks with abstract, context-less theory must set `isNonHistorical: true` and omit year metrics.

---

## 3. Database Schema Design (Firestore)

Each document under the `books` subcollection is augmented with a nested `temporalMetadata` descriptor. This keeps data access localized to the book record and allows simple queries.

```typescript
// Subcollection: /libraries/{libraryId}/books/{bookId}
interface BookDocument {
  id: string;
  title: string;
  author: string;
  synopsis?: string;
  // ... existing fields (geoMetadata, etc.)
  temporalMetadata?: {
    isNonHistorical: boolean;
    startYear?: number; // Integer representation (can be negative)
    endYear?: number;
    eraName?: string;
    rationale?: string;
    lastProcessedAt: string; // ISO Timestamp string for caching lifecycle checks
  };
}
```

---

## 4. Frontend Visualization & Library Analysis

To deliver a vertically scrolling layout with interactive zooming, we evaluated multiple open-source visualization methodologies:

### Historical Timeline Library Matrix

| Strategy / Library | Bundle Impact | Tailwind Integration | Custom Animability | Zoom Support | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`react-vertical-timeline-component`** | ~35 KB | Mediocre (relies on legacy external CSS stylesheets) | Poor (fixed entrance animations) | Static Only (No relative zoom layers) | **REJECTED** (Too structural, rigid styles) |
| **`vis-timeline` / Vis.js** | >200 KB | Painful (uses absolute canvas placement) | Poor (requires manual HTML/DOM injection) | Excellent (native mouse pan/scroll zoom) | **REJECTED** (Forces old styles, massive performance overhead) |
| **Custom SVG + D3 Scales + Framer Motion (Recommended)** | **Negligible (~2-5 KB)** | Native (Tailwind utility classes style all nodes/bars) | Sovereign control with standard `layout` and spring transitions | Dynamic (Math boundaries mapped via lightweight numerical interpolation) | **CHOSEN REPRESENTATIVE** |

### Why Custom SVG + D3 is the Superior Solution:
- **Lightweight Composition**: Using only `@react-spring` or `motion/react` along with basic math utilities avoids multi-megabyte bundle payloads.
- **Styling Freedom**: We avoid rigid pre-packed CSS frameworks. The timeline track is styled purely using standard Tailwind utility properties (e.g., `stroke-zinc-800`, `fill-emerald-500`, transparent focus layers).
- **Adaptive Layout**: Fits beautifully within our responsive desktop/tablet splits.

---

## 5. UI Layout, Interactive Clustering, & Zoom Mechanics

### UI Structural Layout
- **Left Panel**: Library Sidebar Companion list of eligible/non-historical books.
- **Primary Stage**: Vertical chronological axis spanning from earliest historical records (e.g., Antiquity, $-2000$) to modern history ($2026$).
- **Control Bar**: A floating, elegant timeline control deck offering presets (All-Time, BC/BCE Focus, Century Highlights) and an interactive zoom slider (1x, 5x, 20x).

```
   [ Timeline Control Deck: (All Time) --- (Century) --- (Decade) --- [Zoom Slider: --o--] ]
   |
   |---- [-250 BCE] --- [ Ancient Greece Epoch ]
   |                      (Circle cluster proportional to unique book entries)
   |                        * "The Odyssey" (Homer)
   |                        * "Republic" (Plato)
   |
   |---- [1450 CE] ---- [ Gutenberg / early Renaissance Era ]
   |                      o (Smaller dot: single entry)
   |                        * "The Prince" (Machiavelli)
   |
   |---- [1914 CE] ---- [ World War I / Interwar Period ]
   |                      (Concentrically expanding circles showing high-density cluster)
   |                        * "All Quiet on the Western Front"
   |                        * "The Great Gatsby"
```

### Proportional Geometric Scaling (Anti-Linear Circle Scaling)
To represent book density accurately within timeline era slots, we use the logarithmic approach successfully deployed for map clustering, ensuring that eras with dozens of entries don't visually engulf single entries:

```typescript
// Calculation of concentric circle sizes based on Logarithmic Clustering
function getCircleSizeClasses(uniqueBookCount: number) {
  if (uniqueBookCount > 100) return { outer: 'w-44 h-44', middle: 'w-28 h-28', inner: 'w-10 h-10' };
  if (uniqueBookCount > 20)  return { outer: 'w-32 h-32', middle: 'w-20 h-20', inner: 'w-8 h-8' };
  if (uniqueBookCount > 5)   return { outer: 'w-24 h-24', middle: 'w-16 h-16', inner: 'w-6 h-6' };
  if (uniqueBookCount > 1)   return { outer: 'w-16 h-16', middle: 'w-10 h-10', inner: 'w-5 h-5' };
  return { outer: 'w-12 h-12', middle: 'w-8 h-8', inner: 'w-4 h-4' };
}
```

### Interactive Zoom Mechanics
When a user slides the zoom scale:
1. **Dynamic Re-Clustering**: Adjacent nodes merge or fragment depending on the current viewport time resolution:
   - **Low Zoom (1x)**: Books merge into major historical Epochs (e.g., "Mideaval Europe" spanning 500 years).
   - **Medium Zoom (5x)**: Segments decompose into Century modules (e.g., "18th Century Enlightenment").
   - **High Zoom (20x)**: Decadal views partition out specific years (e.g., "The Roaring Twenties (1920–1929)" separating and fanning out into discrete horizontal paths).
2. **Visual Continuity**: Transitioning between zoom levels uses `motion`'s smooth layout animation, giving a beautiful organic expand-and-contract animation to the timeline circles.

---
*End of Design Proposal.*
