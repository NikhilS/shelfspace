# Book Taxonomy & Genre Classification: Implementation Plan

## 1. Executive Summary & Problem Statement

Currently, the application stores genres as unstructured string arrays (`genres: string[]`). These values enter the database through three disparate channels:
1. **Raw BISAC Codes** (e.g., `FICTION / Mystery & Detective / General`, `LITERARY CRITICISM / European / Eastern`) from third-party APIs or unconstrained LLM output.
2. **Google Books / OpenLibrary Strings** (e.g., `Computers`, `Fiction`, `Great Britain -- Description and travel`).
3. **Free-Text User Input** (e.g., `Sci-Fi`, `scifi`, `science fiction`).

This causes severe UI fragmentation:
- Filter pill bars become unnavigable with hundreds of duplicate or hyper-specific categories.
- Header tags display truncated or uppercase industrial codes (`FICTION / ...`).
- Constellation clustering and recommendation models receive noisy category signals.

This document details the complete end-to-end plan to replace this with a **Two-Tier Standardized Taxonomy**, constrained UI controls with an "Other" fallback, and a clean database reset and re-classification strategy.

---

## 2. Real-World Category Testing & Calibration

To evaluate whether a standardized taxonomy is flexible and intuitive, we test three representative edge-case literary works:

### Test Case 1: Books by P.G. Wodehouse (e.g., *The Code of the Woosters*, *Right Ho, Jeeves*)
- **Nature of the Work**: Light English comic novels, farces, and comedy of manners centered around Jeeves, Bertie Wooster, and Blandings Castle.
- **Classification Dilemma**: In standard academic schemes, these are often labeled generic "Fiction" or "Humorous Fiction". In bookstores, they are either placed in **Humor** or **Classic British Fiction**.
- **Taxonomy Placement**:
  - **Primary Genre**: `Humor & Satire` (or `Literary & Classic Fiction`)
  - **Subgenres**: `Farce / Comic Fiction`, `Comedy of Manners`, `British Humor`, `Satire`
- **Taxonomy Adjustment**: While some taxonomies bury humor as a minor subgenre of general fiction, Wodehouse demonstrates why **Humor & Satire** must be a first-class Primary Category. It provides an immediate, natural home for works by P.G. Wodehouse, Douglas Adams, Terry Pratchett, and David Sedaris.

### Test Case 2: *Pale Fire* by Vladimir Nabokov
- **Nature of the Work**: A 999-line poem in heroic couplets by the fictional John Shade, accompanied by an extensive, unreliable, and manic commentary by his editor/neighbor Charles Kinbote.
- **Classification Dilemma**: It contains both genuine poetry and a brilliant, satirical novel in the form of academic apparatus. It is a cornerstone of metafiction and postmodern literature.
- **Taxonomy Placement**:
  - **Primary Genre**: `Literary & Classic Fiction`
  - **Subgenres**: `Postmodern & Experimental`, `Metafiction`, `Satire & Parody`, `Academic / Campus Fiction`
  - **Secondary Thematic Tag**: `Poetry`
- **Taxonomy Adjustment**: The `Literary & Classic Fiction` primary category must explicitly provide `Postmodern & Experimental` and `Metafiction` in its standard subcategory list to accurately capture complex 20th-century classics without forcing them into generic "Contemporary" buckets.

### Test Case 3: *Between the Woods and the Water* by Patrick Leigh Fermor
- **Nature of the Work**: The celebrated second volume of Fermor's journey walking across Europe in 1934 from the Hook of Holland to Constantinople, detailing his trek through Hungary, Transylvania, and Romania down to the Danube.
- **Classification Dilemma**: Blends deep geographical travel writing, autobiographical memoir, and vivid mid-war European social history.
- **Taxonomy Placement**:
  - **Primary Genre**: `Travel & Exploration`
  - **Subgenres**: `Travel Memoir`, `European Travel & Landscape`, `Cultural & Social History`, `Expeditions & Walking`
- **Taxonomy Adjustment**: Travel literature is often relegated to a small sub-item under "Essays" or "Geography". Fermor's work confirms that **Travel & Exploration** must exist as an autonomous top-level primary genre, reflecting how readers and bookstores actually navigate travel memoirs, nature expeditions, and global journeys.

---

## 3. The Standardized Taxonomy Specification

We establish 18 canonical top-level categories plus `"Other"`. Each category contains 5–8 standardized, recognizable subcategories.

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

export type PrimaryGenre = keyof typeof BOOK_TAXONOMY;
```

---

## 4. UI & Form Specifications

All points of manual and automated genre entry will be constrained to the taxonomy:

### 4.1 EditBookForm & ManualEntryTab Component Design
1. **Primary Genre Selection**:
   - Replaces the free-text `genresInput` field.
   - Rendered using a clean `<Select>` element (or Radix Select / custom styled dropdown) containing all 18 primary genres plus `"Other"`.
2. **"Other" Fallback Input**:
   - When `"Other"` is selected:
     - An animated text input labeled **"Custom Genre Name"** appears directly below.
     - The user enters freeform text (e.g., *"Afrofuturism"*, *"Post-Modern Noir"*, *"True Crime"*).
3. **Subgenres Pill Selector**:
   - When a canonical primary genre is chosen, a multi-select popover / pill-checkbox group displays the corresponding 5–8 preset subcategories.
   - Includes a lightweight `+ Add Custom Subgenre` chip input for free-form subgenre tags.
4. **Normalized Form Payload**:
   ```typescript
   interface BookTaxonomyData {
     primary: string;         // e.g. "Humor & Satire"
     subgenres: string[];     // e.g. ["Farce & Comic Fiction", "British Humor"]
     isCustom: boolean;       // true if user chose 'Other'
   }
   ```
   For backwards compatibility, `book.genres` is automatically derived as:
   ```typescript
   book.genres = [taxonomy.primary, ...taxonomy.subgenres];
   ```

### 4.2 Library Overview & Filter Updates
- In `LibraryOverview` and `useBookFilters`, replace the dynamic `Set<string>` of arbitrary strings with the 18 standard primary categories.
- Books are grouped and filtered by their primary genre, ensuring clean, single-row pill navigation without UI overflow.

---

## 5. Database Strategy: Clean Slate & Field Reset

To address accumulated legacy data, we evaluate the migration strategy:

### Strategy Comparison

| Strategy | Mechanism | User Impact | Assessment |
| :--- | :--- | :--- | :--- |
| **Option 1: Complete Collection Wipe** | Delete all documents in `/libraries/{id}/books` | Destroys all added books, cover URLs, reading dates, notes, and ratings. | **Too destructive** unless user explicitly wants a fresh empty library. |
| **Option 2: In-Place Genre Reset** | Batch update all book documents setting `genres: []` and deleting legacy metadata | Preserves all library books, covers, read status, and notes, but completely wipes noisy genre strings. | **Recommended safe baseline**. |
| **Option 3: Reset + Automatic Batch Re-classification** | Batch clear legacy genres, then immediately run `gemini-3.8-flash` across all books using the 18-category taxonomy | Books instantly receive pristine, standardized primary genres and subcategories. | **Optimal user experience**. |

### Implementation of the Reset & Re-classification Pipeline

1. **tRPC Mutation: `library.resetGenres`**:
   - Iterates through the library's books collection in Firestore in batches of 500:
     ```typescript
     const batch = firestore.batch();
     booksSnapshot.docs.forEach(doc => {
       batch.update(doc.ref, {
         genres: [],
         taxonomy: null,
         'enrichmentStatus.genres': false,
       });
     });
     await batch.commit();
     ```
2. **tRPC Mutation: `library.reclassifyAllBooks`**:
   - Gathers all books in the library.
   - Divides into batches of 10–20 books.
   - Calls `classifyBooks` with `gemini-3.8-flash` using a strict `responseSchema` constrained to the 18 primary categories.
   - Updates all book records with the new `taxonomy` object and clean `genres` array.
3. **UI Trigger**:
   - A dedicated **"Reset & Re-classify Genres"** action within Library Settings or Spruce Up view, complete with a confirmation dialog.

---

## 6. Backend & AI Classification Architecture

### 6.1 `src/constants/taxonomy.ts`
- Holds `BOOK_TAXONOMY`, type definitions, and helper utilities:
  - `getCanonicalPrimaryGenres()`
  - `getSubgenresFor(primary)`
  - `mapLegacyGenreToTaxonomy(legacyString)`

### 6.2 Upgrading `classifyBooks` in `src/services/server/gemini.ts`
Update the model prompt and `responseSchema` so that Gemini classifies strictly into our defined taxonomy:

```typescript
const primaryGenreEnum = Object.keys(BOOK_TAXONOMY);

const classificationSchema = {
  type: Type.OBJECT,
  properties: {
    classifiedBooks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          primaryGenre: {
            type: Type.STRING,
            enum: primaryGenreEnum,
            description: 'Exactly one primary category chosen from the canonical list.'
          },
          subgenres: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '1 to 3 specific subgenres matching the book context.'
          }
        },
        required: ['id', 'primaryGenre', 'subgenres']
      }
    }
  },
  required: ['classifiedBooks']
};
```

### 6.3 Unified Metadata Provider Integration
- Update `GenreMetadataProvider.ts` to implement the `IMetadataProvider` interface, wrapping the updated `classifyBooks` method and saving the structured `taxonomy` object and `genres` array.

---

## 7. Step-by-Step Execution Plan

1. **Step 1: Taxonomy Definition (`src/constants/taxonomy.ts`)**
   - Create the source-of-truth file defining the 18 categories, subcategories, types, and normalizers.

2. **Step 2: Server-Side AI Classifier Update (`src/services/server/gemini.ts`)**
   - Update `classifyBooks` with strict schema validation against the taxonomy enum.
   - Test with sample books (including Wodehouse, Nabokov, and Fermor).

3. **Step 3: Database Reset & Migration Endpoints (`src/server/trpc/routers/library.ts`)**
   - Add `resetGenres` mutation to wipe legacy genre fields.
   - Add `reclassifyAllBooks` mutation to batch-process books with the new taxonomy.

4. **Step 4: UI Input Controls**
   - Refactor `src/pages/book-details/EditBookForm.tsx` to use Primary Genre dropdown + "Other" text input + Subgenre selectors.
   - Refactor `src/pages/add-book/ManualEntryTab.tsx`.

5. **Step 5: UI Filters & Overview**
   - Update `src/hooks/useBookFilters.ts` and `src/pages/library/LibraryOverview.tsx` to group by the 18 standardized primary genres.
   - Update book card headers to cleanly display `taxonomy.primary`.

6. **Step 6: Verification & Testing**
   - Verify unit test suite (`npm test`).
   - Run `lint_applet` and `compile_applet`.
   - Verify dev server health check.
