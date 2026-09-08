# Book Taxonomy & Genre Classification: Implementation Plan

## 1. Executive Summary & Problem Statement

Currently, the application stores genres as unstructured string arrays (`genres: string[]`). These values enter the database through three disparate channels:
1. **Raw BISAC Codes** (e.g., `FICTION / Mystery & Detective / General`, `LITERARY CRITICISM / European / Eastern`) from third-party APIs or unconstrained LLM output.
2. **Google Books / OpenLibrary Strings** (e.g., `Computers`, `Fiction`, `Great Britain -- Description and travel`).
3. **Free-Text User Input** (e.g., `Sci-Fi`, `scifi`, `science fiction`).

This causes severe UI and data fragmentation:
- Filter pill bars become unnavigable with hundreds of duplicate, inconsistent, or hyper-specific categories.
- Header tags display truncated or uppercase industrial codes (`FICTION / ...`).
- Constellation clustering and recommendation models receive noisy category signals.

### Core Architectural Decisions
- **Complete Legacy Deprecation**: Rather than retaining backwards compatibility or maintaining dual fields (`genres` alongside new fields), we have **completely eliminated `book.genres`** and legacy genre reset operations across the entire codebase (frontend components, hooks, form states, backend tRPC routers, metadata providers, and Firestore documents).
- **Two-Tier Model**: Each book receives a mandatory **`primaryGenre: string`** (chosen from 18 canonical genres or custom via an `"Other"` fallback) and an **optional `subgenres?: string[]`** (0 to 3 curated subcategories or custom chips).
- **Single Source of Truth Validation**: A single shared Zod validator (`bookGenreSchema`) and sanitization helper (`sanitizeGenrePayload`) strictly enforce that any chosen subgenres belong exclusively to the selected canonical primary genre.
- **Generalized Shelf Care Reset**: We provide a generalized **"Reset Metadata by Kind"** utility in the Shelf Care (Spruce Up) page, allowing users to reset modern genre taxonomy, geo, temporal, synopsis, author bio, or embeddings.
- **Leveraging the Existing Bulk Enrichment Pipeline**: We do **not** build a redundant `reclassifyAllBooks` endpoint. Once `GenreMetadataProvider` is upgraded to the new taxonomy, users re-classify their collection using the standard Shelf Care bulk enrichment runner.

---

## 2. Real-World Category Testing & Calibration

To evaluate whether the standardized taxonomy is flexible, intuitive, and properly handles edge cases, we test three representative literary works:

### Test Case 1: Books by P.G. Wodehouse (e.g., *The Code of the Woosters*, *Right Ho, Jeeves*)
- **Nature of the Work**: Light English comic novels, farces, and comedy of manners centered around Jeeves, Bertie Wooster, and Blandings Castle.
- **Classification Dilemma**: Academic classification schemes bury these in generic "Fiction" or `FICTION / Humorous / General`. In reality, readers seeking Wodehouse, Douglas Adams, or Terry Pratchett look for comedic fiction first.
- **Taxonomy Placement**:
  - **Primary Genre**: `Humor & Satire` *(Required)*
  - **Subgenres**: `Farce & Comic Fiction`, `Comedy of Manners`, `British Humor` *(Optional — book is fully valid with or without subgenres)*
- **Taxonomy Calibration**: Confirms that **`Humor & Satire`** must be a first-class, top-level Primary Category rather than hidden as a minor tag.

### Test Case 2: *Pale Fire* by Vladimir Nabokov
- **Nature of the Work**: A 999-line heroic poem by the fictional John Shade, accompanied by a manic, unreliable academic commentary by Charles Kinbote.
- **Classification Dilemma**: Bridges formal poetry, academic satire, and postmodern metafiction.
- **Taxonomy Placement**:
  - **Primary Genre**: `Literary & Classic Fiction` *(Required)*
  - **Subgenres**: `Postmodern & Experimental`, `Metafiction`, `Satire & Parody` *(Optional)*
- **Taxonomy Calibration**: Top-level `Literary & Classic Fiction` must include **`Postmodern & Experimental`** and **`Metafiction`** in its standard subcategories so boundary-pushing 20th-century classics are not forced into generic contemporary buckets.

### Test Case 3: *Between the Woods and the Water* by Patrick Leigh Fermor
- **Nature of the Work**: The second volume of Fermor's journey walking across Europe in 1934 (through Hungary, Transylvania, and Romania down to the Danube), blending autobiographical memoir, vivid landscape writing, and European cultural history.
- **Classification Dilemma**: Sits at the intersection of travelogue, memoir, and mid-war European social history.
- **Taxonomy Placement**:
  - **Primary Genre**: `Travel & Exploration` *(Required)*
  - **Subgenres**: `Travel Memoir & Journey`, `European Journeys`, `Social & Cultural History` *(Optional)*
- **Taxonomy Calibration**: Travel literature is often relegated to a small sub-bullet under "Essays" or "Geography". Fermor's work highlights why **`Travel & Exploration`** must exist as an autonomous top-level category.

---

## 3. The Standardized Taxonomy Specification

We establish 18 canonical top-level categories plus `"Other"`. Subcategories are strictly optional.

### 3.1 Data Model
```typescript
export interface BookGenreData {
  primaryGenre: string;        // Required: 1 of 18 canonical genres, or custom text if isCustomPrimary is true
  subgenres?: string[];        // Optional: 0 to 3 subcategory strings
  isCustomPrimary?: boolean;   // Optional: true if user entered a custom genre via "Other"
}
```

The legacy `genres: string[]` field is **entirely removed** from `Book`, `BookDetails`, and Firestore schemas.

### 3.2 Canonical Catalog (`src/constants/taxonomy.ts`)

```typescript
export const BOOK_TAXONOMY = {
  'Literary & Classic Fiction': [
    'Classics (Pre-1945)',
    'Contemporary Fiction',
    'Postmodern & Experimental',
    'Metafiction',
    'Family Saga',
    'Coming of Age (Bildungsroman)',
    'Magical Realism',
    'Short Stories',
  ],
  'Science Fiction': [
    'Hard Sci-Fi',
    'Space Opera',
    'Cyberpunk',
    'Dystopian & Post-Apocalyptic',
    'Time Travel',
    'First Contact & Alien Lore',
    'Solarpunk & Climate Fiction',
  ],
  'Fantasy': [
    'Epic & High Fantasy',
    'Urban Fantasy',
    'Dark Fantasy & Grimdark',
    'Mythic & Folklore',
    'Sword & Sorcery',
    'Romantasy',
    'Fairy Tale Retellings',
  ],
  'Mystery & Crime': [
    'Cozy Mystery',
    'Police Procedural',
    'Hardboiled & Noir',
    'Whodunit & Detective',
    'Historical Mystery',
    'Legal Thriller',
  ],
  'Thriller & Suspense': [
    'Psychological Thriller',
    'Domestic Suspense',
    'Espionage & Spy Fiction',
    'Political & Legal Thriller',
    'Techno-Thriller',
    'Action & Adventure',
  ],
  'Horror & Supernatural': [
    'Gothic Horror',
    'Psychological Horror',
    'Haunted & Ghost Stories',
    'Cosmic Horror & Weird Fiction',
    'Occult & Paranormal',
    'Creature Feature & Survival',
  ],
  'Humor & Satire': [
    'Farce & Comic Fiction',
    'Satire & Parody',
    'Comedy of Manners',
    'Dark Comedy',
    'Humorous Essays & Memoirs',
    'British Humor',
  ],
  'Historical Fiction': [
    'Ancient World & Classical',
    'Medieval & Renaissance',
    '18th & 19th Century',
    'Victorian & Edwardian',
    'World War I & II Era',
    'Mid-20th Century',
  ],
  'Romance': [
    'Contemporary Romance',
    'Historical Romance',
    'Romantic Comedy',
    'Paranormal & Fantasy Romance',
    'LGBTQ+ Romance',
    'Suspense Romance',
  ],
  'Biography & Memoir': [
    'Autobiography',
    'Personal Memoir',
    'Literary & Artistic Biographies',
    'Historical Figures & Royalty',
    'Political Leaders & Activists',
    'Science & Adventure Biographies',
  ],
  'History': [
    'Ancient Civilizations',
    'Medieval History',
    'Early Modern & Renaissance History',
    'Military History & Battles',
    'Social & Cultural History',
    'World & Global Histories',
  ],
  'Philosophy & Critical Thought': [
    'Ethics & Moral Philosophy',
    'Existentialism & Phenomenology',
    'Political Philosophy',
    'Epistemology & Logic',
    'Eastern & Comparative Philosophy',
    'Ancient & Classical Philosophy',
  ],
  'Travel & Exploration': [
    'Travel Memoir & Journey',
    'European Journeys',
    'Americas & Polar Expeditions',
    'Asian & Middle Eastern Travels',
    'Nature & Wilderness Exploration',
    'Guidebooks & Cultural Landscapes',
  ],
  'Science & Nature': [
    'Physics & Astronomy',
    'Biology & Evolutionary Science',
    'Neuroscience & Cognitive Science',
    'Ecology, Climate & Conservation',
    'Mathematics & Information Theory',
    'History & Philosophy of Science',
  ],
  'Self-Help & Psychology': [
    'Cognitive Psychology & Behavior',
    'Habits, Focus & Productivity',
    'Mental Health & Resilience',
    'Mindfulness & Meditation',
    'Interpersonal Relationships',
  ],
  'Business & Economics': [
    'Entrepreneurship & Startups',
    'Macroeconomics & Financial History',
    'Leadership & Management',
    'Personal Finance & Investing',
    'Technology & Industry Analysis',
  ],
  'Poetry & Drama': [
    'Classical Poetry & Sonnets',
    'Modern & Contemporary Poetry',
    'Plays & Theatrical Drama',
    'Epic Poetry',
    'Screenplays & Monologues',
  ],
  'Young Adult & Children': [
    'YA Fiction & Realism',
    'YA Fantasy & Dystopia',
    'Middle Grade Adventures',
    'Children’s Illustrated / Picture Books',
  ],
  'Other': [],
} as const;

export type PrimaryGenreKey = keyof typeof BOOK_TAXONOMY;
```

### 3.3 Functional Role of Subgenres: What Subgenres Will Be Used For

While the legacy app used `genres` as a flat, uncurated list, the new `subgenres?: string[]` plays five targeted functional and aesthetic roles across the application:

1. **Drill-Down Secondary Filtering in Library Overview**:
   - In `LibraryOverview.tsx`, clicking a top-level primary genre pill (e.g. `Science Fiction`) expands an optional secondary filter row displaying only that category's active subgenres (e.g., `Cyberpunk (4)`, `Space Opera (7)`, `Hard Sci-Fi (3)`).
   - Allows users with large collections in a single primary genre to quickly filter down to specific thematic niches with zero clutter.
2. **Library Search & Discovery Matching**:
   - The global search query engine and library text search match against both `primaryGenre` and `subgenres`. Searching for `"Cozy"` or `"Post-Apocalyptic"` instantly returns matching books even if the word is not present in the book's title or author.
3. **Surface Badging & Interactive Tag Navigation**:
   - **On `BookCard`**: `primaryGenre` is rendered as the primary badge in the upper card header, while `subgenres` appear as subtle inline pills under the title and author.
   - **On `BookHeader` & `BookContent`**: Subgenres appear as interactive chips. Clicking any subgenre chip initiates a filtered view of the user's library showing all other books sharing that specific subgenre.
4. **Constellation Map & Semantic Embedding Micro-Clustering**:
   - In `EmbeddingMetadataProvider.ts` and `useConstellationData.ts`, subgenres are fed into the book's semantic embedding text payload:
     ```typescript
     const embeddingInput = `${book.title} by ${book.author}. Genre: ${book.primaryGenre}${book.subgenres?.length ? ` (${book.subgenres.join(', ')})` : ''}. ${book.synopsis || ''}`;
     ```
   - In the 2D/3D Constellation canvas, this creates nuanced micro-clusters—grouping Hard Sci-Fi books closely together, Space Operas together, and Cyberpunk together, rather than mushing all Science Fiction into a generic blob.
5. **AI Recommendations & "Pick of the Day" Curator Precision**:
   - When generating personalized recommendations or the Daily Pick in `gemini.ts`, passing subgenre preferences (e.g. "User frequently reads *Literary & Classic Fiction: Postmodern & Experimental, Metafiction*") provides significantly sharper stylistic context than generic category labels.

---

## 4. Single Entry Point Validation Architecture

To ensure data integrity and guarantee that users and AI models cannot assign invalid combinations (e.g. pairing `Science Fiction` with `Cozy Mystery`), all validations flow through a single source of truth in `src/constants/taxonomy.ts`.

### 4.1 Zod Schema (`bookGenreSchema`)
```typescript
import { z } from 'zod';
import { BOOK_TAXONOMY, PrimaryGenreKey } from './taxonomy';

export const bookGenreSchema = z
  .object({
    primaryGenre: z.string().min(1, 'Primary genre is required'),
    subgenres: z.array(z.string()).max(3, 'At most 3 subgenres allowed').optional().default([]),
    isCustomPrimary: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    // Custom genres entered via "Other" bypass canonical subgenre constraints
    if (data.isCustomPrimary || data.primaryGenre === 'Other') {
      return;
    }

    const validSubgenres = BOOK_TAXONOMY[data.primaryGenre as PrimaryGenreKey];
    if (!validSubgenres) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${data.primaryGenre}" is not a recognized canonical genre.`,
        path: ['primaryGenre'],
      });
      return;
    }

    // Ensure every selected subgenre belongs to the valid list for this primary genre
    data.subgenres?.forEach((subgenre, index) => {
      if (!validSubgenres.includes(subgenre as never)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${subgenre}" is not a valid subgenre for "${data.primaryGenre}". Allowed: ${validSubgenres.join(', ')}`,
          path: ['subgenres', index],
        });
      }
    });
  });
```

### 4.2 Sanitization Helper (`sanitizeGenrePayload`)
For non-form contexts (AI classification results, CSV import parsing, and bulk ingest), a pure sanitization function automatically strips out mismatched or hallucinated subgenres without throwing exceptions:

```typescript
export function sanitizeGenrePayload(input: {
  primaryGenre?: string;
  subgenres?: string[];
  isCustomPrimary?: boolean;
}): { primaryGenre: string; subgenres: string[]; isCustomPrimary: boolean } {
  if (!input.primaryGenre) {
    return { primaryGenre: 'Other', subgenres: [], isCustomPrimary: true };
  }

  if (input.isCustomPrimary || input.primaryGenre === 'Other') {
    return {
      primaryGenre: input.primaryGenre,
      subgenres: input.subgenres?.slice(0, 3) || [],
      isCustomPrimary: true,
    };
  }

  const validList = BOOK_TAXONOMY[input.primaryGenre as PrimaryGenreKey];
  if (!validList) {
    return {
      primaryGenre: input.primaryGenre,
      subgenres: [],
      isCustomPrimary: true,
    };
  }

  // Retain only valid subgenres for this specific primary genre, capped at 3
  const filteredSubgenres = (input.subgenres || [])
    .filter(s => validList.includes(s as never))
    .slice(0, 3);

  return {
    primaryGenre: input.primaryGenre,
    subgenres: filteredSubgenres,
    isCustomPrimary: false,
  };
}
```

### 4.3 Where This Validator Enforces Constraints

| Point of Entry | Enforcement Mechanism | Failure / Sanitization Behavior |
| :--- | :--- | :--- |
| **1. UI Forms (`EditBookForm.tsx`, `ManualEntryTab.tsx`)** | `bookGenreSchema` is composed into the form's Zod validator. | Rejects submission and highlights invalid subgenre chips with clear error messages. |
| **2. UI Cascading State** | Changing `primaryGenre` in the dropdown triggers `setValue('subgenres', [])`. | Automatically clears stale subgenres when switching categories, preventing mismatched states. |
| **3. AI Output (`gemini-3.8-flash`)** | Model response schema restricts `primaryGenre` to enum; raw outputs pass through `sanitizeGenrePayload`. | Discards any hallucinated subgenres that do not belong to the selected primary category. |
| **4. Ingestion (`CSVImportTab.tsx`, `ScanISBNTab.tsx`)** | External category strings pass through `mapLegacyGenreToTaxonomy` and `sanitizeGenrePayload`. | Maps raw categories to the closest canonical genre or safely marks as `"Other"`. |

---

## 5. UI & Form Specifications

All points of manual and automated genre entry will be constrained to this taxonomy:

### 5.1 EditBookForm & ManualEntryTab Component Design
1. **Primary Genre Selection (Mandatory)**:
   - Replaces the free-text `genresInput` field.
   - Rendered using a constrained `<Select>` element containing the 18 canonical primary genres plus `"Other"`.
2. **"Other" Fallback Input**:
   - When `"Other"` is chosen in the dropdown:
     - An animated text input labeled **"Custom Genre Name"** appears directly below.
     - The user enters freeform text (e.g., *"Afrofuturism"*, *"Post-Modern Noir"*, *"True Crime"*).
     - Form payload sets `primaryGenre = customText` and `isCustomPrimary = true`.
3. **Subgenres Pill Selector (Strictly Optional)**:
   - When a canonical primary genre is selected, a multi-select popover or pill-checkbox group presents the corresponding 5–8 preset subcategories.
   - Users can select **0, 1, 2, or up to 3 subgenres**. Leaving subgenres unselected is completely valid.
   - Includes a lightweight `+ Add Custom Subgenre` chip input for bespoke subgenre tags.

### 5.2 Library Overview & Filter Updates
- In `LibraryOverview` and `useBookFilters`:
  - Eliminate dynamic sets derived from raw genre strings.
  - The filter pill bar displays the 18 standardized primary genres (sorted by book count or alphabetically), plus an "Other" chip if custom genres exist.
  - Clicking a primary genre filters books where `book.primaryGenre === selectedGenre`.
  - Selecting a primary genre opens an optional sub-row of subgenre filter pills.
- In `BookCard` and `BookHeader`:
  - Display `book.primaryGenre` prominently as the primary category badge.
  - Render `book.subgenres` as secondary subtle tags underneath.

---

## 6. Firestore Field Dropping & Generalized Shelf Care Reset

### 6.1 Firestore Support for Dropping Fields from a Schema
Because Google Cloud Firestore is a **NoSQL schemaless document database**, there is no table-level DDL command (such as SQL `ALTER TABLE books DROP COLUMN genres;`). 

In Firestore, fields are removed at the **document data level**:
- **Mechanism**: Use `FieldValue.delete()` from the Admin SDK (`admin.firestore.FieldValue.delete()`) or Client SDK (`deleteField()`).
- **Storage Impact**: When a document is updated with `{ genres: FieldValue.delete() }`, Firestore physically deletes the field key from the document's stored map.
- **Bandwidth & Performance**: Subsequent document reads (`getDoc`, collection queries, real-time snapshot listeners) will no longer include the deleted field in the payload, decreasing bandwidth consumption and payload serialization overhead.
- **Batch Processing**: Firestore supports up to 500 operations per `WriteBatch`. Libraries with thousands of books are processed in consecutive 500-document batches.

### 6.2 Generalized "Reset Metadata by Kind" in Shelf Care (Spruce Up)
Instead of a single-purpose script, we generalize metadata purging on the Shelf Care page (`/library/:id/spruce-up`).

#### Shelf Care UI Controls
A new card in Shelf Care: **"Reset Metadata by Kind"**:
- Allows users to select a metadata kind to wipe across all books in the library.
- Supported kinds:
  - `COVER_IMAGE` (`coverUrl`)
  - `GEO` (`geoMetadata`)
  - `TEMPORAL` (`temporalMetadata`)
  - `SYNOPSIS` (`synopsis`)
  - `AUTHOR_BIO` (`authorBio`)
  - `SERIES` (`series`)
  - **`GENRE`** (`genre` / `primaryGenre`, `subgenres`) — resets taxonomy classification fields.

#### The Metadata Reset Mutation
- **Purpose**: Purges a selected metadata category from books in the library and prepares the collection for re-enrichment.
- **tRPC Route**: `library.resetMetadata`
- **Implementation**: Uses `FieldValue.delete()` across specified metadata fields.

### 6.3 Why No Bespoke `reclassifyAllBooks` Is Needed
We do not build a separate, custom `reclassifyAllBooks` route. Here is why:
1. The existing **Shelf Care (Spruce Up) page** already contains the **Complete Book Details** manual and bulk enrichment runner (`ManualEnrichmentSection` and `useBulkEnrichment`).
2. The `GenreMetadataProvider` is updated to query `gemini-3.8-flash` with the new 18-category schema and store `{ primaryGenre, subgenres }`.
3. If a user resets genres, any book without a `primaryGenre` will immediately appear in the Shelf Care filter as missing genre metadata.
4. The user simply uses the existing Shelf Care bulk runner for **"Genres"** to backfill the entire library. This reuses the battle-tested rate limiting, progress bar, error handling, and batching infrastructure already in place.

---

## 7. Codebase Refactoring Blueprint: Dropping `book.genres`

To ensure no lingering technical debt, every reference to the old field is replaced with `primaryGenre` and `subgenres`.

### 7.1 Type Definitions
- **`src/types.ts`**:
  ```typescript
  // Replace:
  // genres?: string[];
  // With:
  primaryGenre?: string;
  subgenres?: string[];
  isCustomPrimary?: boolean;
  ```
- **`src/types/metadata.ts`**:
  - `MetadataKey.GENRE = 'primaryGenre'` (or handle both `primaryGenre` and `subgenres` in the provider payload).
  - Update `IMetadataProvider<BookGenreData>`.

### 7.2 Provider & Server AI Service
- **`src/services/server/metadata/providers/GenreMetadataProvider.ts`**:
  - Return type becomes `BookGenreData` instead of `string[]`.
  - In `applyToBook`, writes `primaryGenre` and `subgenres` directly to the book document.
- **`src/services/server/gemini.ts` (`classifyBooks`)**:
  - Update `responseSchema` to strictly enforce `primaryGenre` from `Object.keys(BOOK_TAXONOMY)` and `subgenres` array.
  - Eliminate all BISAC references from system instructions and prompts.
  - Run output through `sanitizeGenrePayload`.

### 7.3 Ingestion & Form Inputs
- **`src/pages/book-details/EditBookForm.tsx`**:
  - Remove `genresInput` from Zod schema and React Hook Form.
  - Integrate `bookGenreSchema`.
  - Add `primaryGenre` dropdown + "Other" text input + optional `subgenres` multi-select with cascading reset.
- **`src/pages/add-book/ManualEntryTab.tsx`**:
  - Replace `genresInput` with `primaryGenre` dropdown and optional `subgenres` chips.
- **`src/components/ExtractedBooksTable.tsx` / `CSVImportTab.tsx`**:
  - Map incoming categories through `mapLegacyGenreToTaxonomy` and `sanitizeGenrePayload`.

### 7.4 Filters & Visualizations
- **`src/hooks/useBookFilters.ts`**:
  - Filter books using `b.primaryGenre === selectedGenre` and optional subgenre filter matching.
- **`src/pages/library/LibraryOverview.tsx`**:
  - Group books by `b.primaryGenre || 'Uncategorized'`.
- **`src/pages/WorldMap.tsx` & `src/components/ConstellationChart.tsx`**:
  - Read `book.primaryGenre` and `book.subgenres` instead of `book.genres[0]`.

---

## 8. Step-by-Step Execution Plan

### Step 1: Constants, Types & Validation
- Create `src/constants/taxonomy.ts` with `BOOK_TAXONOMY`, `PrimaryGenreKey`, `bookGenreSchema`, `sanitizeGenrePayload`, and normalizer helpers.
- Update `src/types.ts` and `src/types/metadata.ts` to replace `genres?: string[]` with `primaryGenre?: string` and `subgenres?: string[]`.

### Step 2: Server-Side AI Classification & Providers
- Refactor `classifyBooks` in `src/services/server/gemini.ts` to return `{ id: string; primaryGenre: string; subgenres?: string[] }`.
- Update `GenreMetadataProvider.ts` to store `primaryGenre` and `subgenres`.

### Step 3: Shelf Care Generalized Reset
- Add `resetMetadata` mutation in `src/server/trpc/routers/library.ts` (using `FieldValue.delete()`).
- Add generalized "Reset Metadata by Kind" UI section in `src/pages/spruce-up/ResetMetadataSection.tsx`.

### Step 4: UI Form Controls with Single Entry Validation
- Refactor `EditBookForm.tsx` and `ManualEntryTab.tsx` to use the constrained Primary Genre dropdown + "Other" text input + optional subgenres multi-select.
- Implement cascading reset: changing primary genre resets selected subgenres.
- Update `CSVImportTab.tsx` and camera ingestion pipelines with `sanitizeGenrePayload`.

### Step 5: Filter, Card, and Visualization Updates
- Update `useBookFilters.ts`, `LibraryOverview.tsx`, `BookCard.tsx`, `BookHeader.tsx`, `WorldMap.tsx`, and `ConstellationChart.tsx` to use `primaryGenre` and `subgenres`.
- Add secondary subgenre drill-down filtering to `LibraryOverview.tsx`.

### Step 6: Verification & Quality Assurance
- Run unit test suite (`npm test`).
- Run `lint_applet` and `compile_applet`.
- Verify dev server health and test bulk genre classification.
