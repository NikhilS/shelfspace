# Design Document: React Library & Book Tracking App

## Overview
This application is a personal library and book tracking system built as a Single Page Application (SPA). It allows users to digitize their physical and digital libraries, track reading statuses, get AI-driven book recommendations, and visualize their library via clustering algorithms. 

## Architectural Choices
1. **Frontend Framework**: **React 19** with **Vite** as the bundler. Uses React Router for SPA navigation.
2. **Styling and UI**: **TailwindCSS** for utility-first styling, paired with **lucide-react** for icons. Used **shadcn/ui** design patterns for some UI components. **Framer Motion** (`motion/react`) provides layout transition and animations. 
3. **Backend / Data Layer**: **Firebase Firestore (NoSQL)** accessed directly from the client. The application relies on Firestore's real-time nature (`onSnapshot`) to sync state seamlessly. To provide high availability and a resilient user experience, Firestore offline persistence is fully enabled using `persistentLocalCache` with `persistentMultipleTabManager`. This allows the application to read from the local cache immediately, enabling snappy UI interactions and offline capabilities, syncing changes back to the cloud automatically once network connectivity is restored.
4. **Authentication**: **Firebase Auth**, keeping user identities strictly secured and enabling fine-grained read/write logic via Firestore Rules.
5. **AI Integrations**: The direct client SDK for Gemini (`@google/genai`) handles embedding generation, data extraction (from images/csv), missing metadata enrichment, and text generative features (like summaries/recommendations).
6. **Data Processing (Client-Side)**:
   - Uses `umap-js` to compute a 2-dimensional spatial projection (UMAP) of book embeddings directly in the browser to power the "Constellation Map".
   - Uses `@zxing/browser` and `@zxing/library` to process and parse barcodes directly on the client without a backend dependency.
   - Uses `papaparse` to handle bulk CSV importing on the client.

## Data Model & Firestore Structure
The NoSQL design prioritizes real-time sync and nested collections where applicable, following the `firebase-blueprint.json`:

- `/users/{userId}`: Root user profile document.
- `/libraries/{libraryId}`: Contains library metadata (owner, share lists, hero image).
   - `/libraries/{libraryId}/books/{bookId}`: Subcollection containing book documents (title, author, isbn, userStatuses, embedding).
   - `/libraries/{libraryId}/books/{bookId}/reviews/{reviewId}`: Subcollection of reviews for a given book.
   - `/libraries/{libraryId}/allowedDuplicates/{allowedId}`: Subcollection maintaining user's acknowledged duplicate books to prevent noisy warnings.

## Data Flows

### 1. Library Synchronization & Data Store Caching
- **Offline-First SPA Architecture**: Leveraging Firestore's built-in multi-tab persistent cache, data fetched from Firestore is cached locally. The SPA can load and render immediately using cached data while invisibly validating against the server in the background.
- **On Dashboard Load**: The application listens to `/libraries` where `ownerId == userId` OR `sharedWith` includes the user's email. Local caches serve these queries nearly instantly to eliminate loading spinners.
- **On Library View Load**: Real-time snapshot listeners bind to `/libraries/{libraryId}` and its `/books` subcollection. Edits to books or their statuses fire `updateDoc` events. Thanks to the persistent cache, writes are optimistically applied locally providing instant UI feedback, and are queued for background remote replication even if the user is temporarily offline.

### 2. AI-Assisted Book Addition and Enrichment
- **Manual Search**: Uses `src/services/bookApi.ts` to query external APIs (like OpenLibrary or Google Books).
- **Barcode Scan**: Triggers ZXing barcode reader via user's camera -> Lookups barcode against OpenLibrary -> Inserts book to Firestore.
- **Image Scanning / Bookshelf Processing**: The client snaps a photo using the device camera (`CameraScanner.tsx`). The image is sent to Gemini mapping pixels to a JSON array of `[{title, author, isbn}]`. The front-end renders these as potential imports, checks if they're already in the library, and then inserts.
- **Enrichment**: Books added without a series or adequate metadata are batched and sent to Gemini via `enrichBooksMetadata()`. This runs synchronously on user action (e.g. during an explicit batch insert, or a manual "backfill missing metadata" button press) and not via background workers. Changed properties are synced back to the `/books` subcollection.

### 3. Embeddings and The Constellation Map
1. Each book requires an `embedding` array. For missing embeddings, the client sends the book description to `gemini-embedding-2-preview` to generate semantic vectors.
2. The user navigates to "Constellation Map".
3. `umap-js` takes all `[1024]` length embedding arrays and reduces them to a `[X, Y]` coordinate.
4. The client groups coordinates mathematically to define clusters, and calls `gemini-2.5-flash` to give the cluster a stylistic human-readable name.
5. React uses Recharts (or standard SVG plotting) to plot these points, providing a "Galaxy" visualization of the user's library.

## Security
- API keys (like Gemini) are restricted via environment variables and build pipelines (with respect to preview environment norms). 
- Firestore rules rigorously secure writes to only owners and specified roles, mitigating abuse and untrusted payloads via the client-side approach.

## Future Extensibility
- Due to the modular AI integration (`src/services/gemini.ts`), swapping the underlying prompt definitions or model versions is isolated to a single service file.
- The SPA can be further progressed into a Progressive Web App (PWA) using `vite-plugin-pwa` to cache static frontend assets, complementing the existing offline Firestore capabilities for a true zero-network experience.
