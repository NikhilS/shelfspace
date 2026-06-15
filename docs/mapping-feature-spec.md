# PRD, User Journeys, and Design Document: Interactive World Map of Books

This document outlines the Product Requirements, User Journeys, and Technical Design for the interactive map visualization feature. This feature allows users to visualize where the narratives of their books are set, using Gemini 3.5 Flash for metadata extraction and Google Maps Platform for the interactive, hierarchical clustering visualization.

---

## 1. Product Requirement Document (PRD)

### 1.1 Objective & Value Proposition
Standard book catalogs are text-heavy tables. Placing book settings on an interactive global map adds a visual and spatial layer to the user's library. It helps readers explore their geographic reading footprint, discover overlooked regions, and travel the world through literature.

### 1.2 Core Functional Requirements

1. **Interactive Map Visualization**:
   - A global map view showing where in the world the user's books are set.
   - Two presentation toggles:
     - **Label Cluster Count View**: Interactive markers/pin clusters showing labels of distinct book counts referring to that area.
     - **Heat Map View**: An ambient density overlay of geographical settings.

2. **Geographical setting extraction (at most 5 per book)**:
   - For books that discuss multiple key regions (e.g. travel memoirs, sprawling historical novels), we cap the number of geographical settings to at most **5 active settings per book** to prevent clutter and keep focus on primary locales.

3. **Hierarchical Zoom, Grouping & Clustering**:
   - Geopolitical hierarchies must resolve elegantly.
   - **Scenario**: Book A mentions "Delhi, India" and Book B mentions "India".
   - **Zoomed-Out Level**: The clusterer groups both references together under a broader marker. The label shows **2 distinct books** in India.
   - **Zoomed-In Level**: The cluster decomposes. The map displays:
     - 1 pinpoint specifically centered on **Delhi, India** (representing Book A).
     - 1 pinpoint centered generally on the country-wide boundary representing **India** (representing Book B).

4. **Dynamic Data Fetching Engine (Dual Pathway)**:
   - **Pathway A (Real-time Extraction)**: When a new book is added (manually, via scan, or CSV import), a background process prompts Gemini 3.5 Flash to extract its major geographic settings.
   - **Pathway B (Fallback Batch Backfill)**: When visiting the World Map page, the UI detects any catalog books lacking geo-metadata. It displays a quiet progress loader and triggers a bulk-backfill queue to process books in asynchronous **batches of 50** via Gemini-3.5-flash.

5. **Graceful Handling of Fictional / Abstract Works**:
   - Sci-fi set in deep space (e.g. *Neuromancer*, *Project Hail Mary*), high-fantasy epics (e.g. *The Lord of the Rings*), or abstract/scientific manuals (e.g. textbooks) do not refer to real-world Earth locations.
   - They must be tagged with a distinct permanent flag (e.g., `isNonEarth: true` / `unmappable`). The ingestion pipeline must skip these books on subsequent fallback sweeps so we **do not** make redundant API calls to fetch geo-metadata.

---

## 2. User Journeys

### Journey 2.1: The Explorateur (Exploring Hierarchical Locations)
* **Pre-requisite**: The user has added *Midnight's Children* (set in Delhi, Bombay, Karachi) and *A Passage to India* (general India setting).
* **Step 1**: The user navigates to the "Mapping the Library" view.
* **Step 2**: Sized fully outward, the user sees an elegant marker cluster positioned over South Asia showing a numeric badge of **2 books**.
* **Step 3**: The user double-clicks or pinches to zoom in specifically on northern India.
* **Step 4**: The cluster dissolves. One pin now snaps to **Delhi, India** (linking to *Midnight's Children*), and another sits centered globally as **India** (linking to *A Passage to India*).
* **Step 5**: Tapping the Delhi pin opens an off-canvas context panel detailing the book, author, cover, and a 1-sentence context excerpt explaining Delhi's role in the novel.

### Journey 2.2: Dynamic Fallback Backfill on Page Load
* **Pre-requisite**: The user has just imported 120 books via a custom CSV without geographical attributes.
* **Step 1**: The user visits the Map page.
* **Step 2**: The page detects 120 books lacking geolocation info. It initiates the fallback processing pipeline in groups of 50.
* **Step 3**: A progress indicator says, `"Mapping your library (0/120 mapped)..."`.
* **Step 4**: As the first batch of 50 converts and populates, new markers drop dynamically onto the globe in real-time.
* **Step 5**: 12 books set in hypothetical settings (e.g., *Dune*, *Calculus Volume 1*) are flagged as `isNonEarth: true`. They are listed under a "Non-Map Archive" accordion so the user knows they were successfully processed but cannot be mapped.
* **Step 6**: The process completes. Consecutive visits load instant cached coordinate sets with zero lag or API requests.

---

## 3. Engineering & Technical Design Document

### 3.1 Database & Schema Extensions (`/src/types.ts` / Firestore Blueprint)
To perform localized map queries without expensive database joins, we embed the geographic metadata directly within each `Book` record inside Firestore under our `libraries/{libraryId}/books` subcollection.

```typescript
export interface GeoLocationReference {
  name: string;          // E.g., "Delhi, India" or "Kyoto, Japan"
  adminLevel: 'city' | 'state' | 'country' | 'region';
  rationale: string;     // 1-sentence literary/historical context why the location matters
  coordinates?: {        // Resolved server-side from name using Geocoding API
    lat: number;
    lng: number;
  };
}

export interface BookGeoMetadata {
  isNonEarth: boolean;   // True if sci-fi, high-fantasy, or abstract text
  locations: GeoLocationReference[]; // Capped at at most 5 items
  lastSyncedAt: string;  // ISO string
}

// Added to the top-level Book type
export interface Book {
  id: string;
  title: string;
  author: string;
  isbn?: string;
  synopsis?: string;
  geoMetadata?: BookGeoMetadata;
}
```

---

### 3.2 Dynamic Ingestion Pipeline & API Endpoints

To maximize stability and ensure API keys remain strictly hidden in full-stack routes, we will structure server-side Express handlers:

1. `POST /api/books/enrich-geo`: Enriches a single book during incremental manual entry or active ISBN scan.
2. `POST /api/books/batch-enrich-geo`: Accepts an array of up to 50 book definitions (`{ id, title, author, synopsis }`), executes a highly efficient parallel bulk execution, and writes results in a Firestore Bulk-Writer transaction.

```
       [Client Map/Add Trigger]
                  │
                  ▼
        [REST API POST Request]
                  │
                  ▼
   [Express: server.ts API Proxy] ──(Checks process.env.GEMINI_API_KEY)
                  │
                  ▼
    [Gemini 3.5 Flash Model Run]
 (Structured Output JSON Formulation)
                  │
                  ▼
  [Server-Side Address Resolution] ──(Geocodes Names to Lat/Lng)
                  │
                  ▼
   [Firestore Cached Update Write] ──(Writes to libraryId/books)
```

---

### 3.3 Highly Precise Gemini Extraction Prompts

We leverage the `@google/genai` TypeScript SDK using structured JSON schema execution to ensure strict type returns.

#### Structured Type Declaration
```typescript
import { Type } from "@google/genai";

export const GeoExtractionSchema = {
  type: Type.OBJECT,
  properties: {
    isNonEarth: {
      type: Type.BOOLEAN,
      description: "Set to true ONLY if the entire work is sci-fi set in space/fictional planets, high fantasy set in completely fictional realms (like Middle-earth, Westeros, Narnia), or is a textbook, academic guide, or abstract literature with no logical earthly setting."
    },
    locations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: "Fully-qualified geographical name. Must include specific city, province/state, and country name combined to guarantee precise geocoding (e.g., 'Kyoto, Japan' instead of 'Kyoto', 'Delhi, India' instead of 'Delhi', 'Gettysburg, PA, USA' instead of 'Gettysburg')."
          },
          adminLevel: {
            type: Type.STRING,
            enum: ["city", "state", "country", "region"],
            description: "Granularity type of setting."
          },
          rationale: {
            type: Type.STRING,
            description: "A short context sentence (15 words max) describing why this spatial setting is vital to the story."
          }
        },
        required: ["name", "adminLevel", "rationale"]
      },
      description: "At most 5 key geographical regions, cities, states, or countries central to the narrative, plot, setting, or historical backdrop. Return empty list if isNonEarth is true."
    }
  },
  required: ["isNonEarth", "locations"]
};
```

#### Strict System Prompt
```
You are a peerless, academic literary geographer with deep encyclopedic knowledge of world literature, non-fiction contexts, and global histories.
Your task is to analyze details of the provided book (Title, Author, Synopsis) and determine exactly where the setting takes place on planet Earth.

System Directives:
1. Identify the primary locations (cities, regions, countries) where the actions, histories, or settings of the book take place.
2. STRICTLY CAP extraction to NO MORE than 5 locations. Select only the most critical settings.
3. Every location NAME must be globally unambiguous (e.g., 'Paris, France' instead of 'Paris', 'Springfield, IL, USA' instead of 'Springfield').
4. If the book is set in a fictional realm (Middle-earth, Westeros, Narnia), outer space / sci-fi galaxies (e.g. 'Project Hail Mary'), or is an abstract academic, scientific or mathematical textbook, set 'isNonEarth' to true and return an empty locations list.
```

---

### 3.4 Data Normalization & Server-Side Address Geocoding
To protect user experiences from excessive rate-limiting, we normalize spelling and resolve latitude/longitude *at ingestion time rather than at rendering time*:

1. **Step A**: Receive Structured Location data from Gemini (e.g., `name: "Delhi, India"`).
2. **Step B**: Check server-side cache map or call standard Maps Platform Geocoding services for `"Delhi, India"` -> resolves to `{ lat: 28.6139, lng: 77.2090 }`.
3. **Step C**: Write the resolved lat/lng coordinates and country/city labels to Firestore.
4. **Step D**: On the client Map component, render marker arrays directly. Zero on-the-fly client geocoding cost is required.

---

### 3.5 Hierarchical Map Visualization and Cluster Tuning
To render locations seamlessly with rich spatial clarity:

1. **Map Core**: Build using `@vis.gl/react-google-maps` (with `<APIProvider>` and dynamic key validation).
2. **Custom Marker Clusterer**:
   - Utilize `@googlemaps/markerclusterer` to establish grouping.
   - For any markers within close proximity (or nested child directories like Delhi within India), they group into a single clustered badge when zoomed out.
   - The badge displays a count of **distinct books** contributing to that cluster.
3. **Map Pan and Split Listeners**:
   - Tapping an active cluster performs a smooth zoom pan (`map.panTo()` and level increase).
   - As zooming approaches intermediate scales, the country-level clusters split, rendering specific city pins (Delhi) separated from generic fallback country centroids (India).
4. **Heatmap Toggle**:
   - Incorporate native Google Maps `Visualization` layers or dec.gl rendering overlay to paint dynamic, glowing warmth density fields across regional setting arrays.

---

## 4. API Keys & Platform Credentials Setup

To power the map visualizer and location extraction engine, two separate API platforms are integrated: **Google Maps Platform** and **Google AI Studio (Gemini)**. This section outlines how to obtain these credentials, their designated environment variable names, and how to configure them securely.

### 4.1 Required Credentials Reference Table

| Variable Name | Client / Server Scope | Platform | Purpose |
|:---|:---|:---|:---|
| `GEMINI_API_KEY` | **Server-Only (Private)** | Google AI Studio | Powers Gemini 3.5 Flash server-side requests to extract geographic entities from book descriptions. |
| `GOOGLE_MAPS_API_KEY` | **Server-Only (Private)** | Google Cloud Console | Used by the Node/Express server to call the Geocoding API to coordinate-resolve the extracted locations. |
| `VITE_GOOGLE_MAPS_API_KEY` | **Client-Visible (Public)** | Google Cloud Console | Loaded by the React application inside `<APIProvider>` to render interactive Maps and Advanced Marker views in the browser. |

> [!CAUTION]
> **API Key Security Directives (MANDATORY)**: Never commit real API keys to repository files (such as `server.ts` or `App.tsx`) or `.env` files. The private keys `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` must **never** be prefixed with `VITE_` or exposed in client-side code.

---

### 4.2 Step-by-Step Acquisition Guides

#### Guide A: How to Obtain a Google Maps API Key
1. Go to the **[Google Cloud Console](https://console.cloud.google.com/)**.
2. Create standard credentials or select your active Google Cloud project.
3. Open the navigation menu and go to **APIs & Services > Library**.
4. Search for and **Enable** the following APIs (both are mandatory):
   - **Maps JavaScript API** (Required for the frontend React map canvas and visual marker rendering)
   - **Geocoding API** (Required for translating literary location strings to GPS `{ lat, lng }` pairs)
5. Navigate to **APIs & Services > Credentials**.
6. Click **+ Create Credentials** and select **API key**.
7. *Security Best Practice*: It is highly recommended to restrict your public key (`VITE_GOOGLE_MAPS_API_KEY`) to accept requests only from specific HTTP referrers (e.g. your deployment domain or `http://localhost:3000`). Keep your backend key (`GOOGLE_MAPS_API_KEY`) unrestricted or restricted by IP if calling strictly from the server container.

#### Guide B: How to Obtain a Gemini API Key
1. Go to **[Google AI Studio](https://aistudio.google.com/)**.
2. Sign in with your Google Workspace or Personal account.
3. Click the prominently displayed **Get API Key** button in the dashboard sidebar.
4. Select **Create API Key** (you can choose to create it in an existing Google Cloud project or a free tier project).
5. Copy the generated string for configuration.

---

### 4.3 Environment Variable Configuration (How to set in AI Studio)

Instead of prompting users for API credentials in custom text fields, the application delegates secret management to the platform environment to protect integrity.

#### 1. In Your Local Configuration File (`.env.example` / `.env`)
Declare the missing keys inside `.env.example` so the dev system registers them:
```env
# .env.example
GEMINI_API_KEY=
GOOGLE_MAPS_API_KEY=
VITE_GOOGLE_MAPS_API_KEY=
```

#### 2. Within the AI Studio Settings Panel
1. Locate the **Settings⚙️** button or **Secrets / Env Variables** tab inside the AI Studio Workspace control panel.
2. Under the secrets input fields, insert:
   - **Name**: `GEMINI_API_KEY` ── **Value**: `[Your Gemini Key]`
   - **Name**: `GOOGLE_MAPS_API_KEY` ── **Value**: `[Your Google Maps Private Key]`
   - **Name**: `VITE_GOOGLE_MAPS_API_KEY` ── **Value**: `[Your Google Maps Public Browser Key]`
3. Apply changes and reload/restart the preview console. The system injects these safely on container launch.
