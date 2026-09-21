# Design Document: Semantic Debug Console & App HUD

## Executive Summary
For high-performance, complex applications like the **Bibliophile Hub**, developer visibility into runtime states is paramout. Standard browser DevTools are helpful but disconnected from the semantic context of the application—they lack domain-awareness of books, UMAP dimensions, Firestore cache metadata, and background job queues.

This document outlines the architecture for an **in-app, collapsible, developer-friendly HUD (Heads-Up Display) / Debug Console**. It operates as a passive, non-intrusive runtime observer that intercepts console telemetry, intercepts database read/write lifecycles to detect cache hits/misses, monitors network latency, and exposes active page view states at a semantic level.

---

## 1. System Architecture & Telemetry Flow

The Debug Console acts as a centralized observer, catching notifications from various modules and presenting them in a unified HUD.

```
+--------------------------------------------------------------------------+
|                              Active React Pages                          |
|   (Component State, Route State, Active book details, UMAP settings)     |
+--------------------+---------------------+-------------------------------+
                     |                     |
                     v                     v
+--------------------+----+    +-----------+------------+
|      Console Logging     |    |   Semantic Operations  |
| (console.log/warn/error) |    |  (Database, APIs, AI)  |
+--------------------+-----+    +-----------+------------+
                     |                     |
                     | (Intercept)         | (Explicit Intercept/Proxy)
                     v                     v
+--------------------+---------------------+-------------------------------+
|                        DebugTelemetryEngine (Facade)                     |
|     - Tracks log buffer (max 200 entries)                                |
|     - Computes real-time diagnostics (latency, Firestore cache hits)     |
|     - Exposes Event Bus/Observer pattern to trigger HUD re-renders       |
+------------------------------------+-------------------------------------+
                                     |
                                     v
+------------------------------------+-------------------------------------+
|                     Toggleable HUD Interface (React UI)                  |
|   - Low-Impact Overlay Panel (Ctrl + ~ or floating bezel)                |
|   - Dynamic filter controls, live state inspection, search queries       |
+--------------------------------------------------------------------------+
```

---

## 2. Core Telemetry & Facade Designs

### 2.1 The Console Log Interception Facade
To capture any log, warning, or error without breaking the standard browser DevTools workflow, we will instantiate a global interceptor that proxies `window.console` methods.

- **Non-Destructive Logging**: It preserves original native browser behavior by wrapping standard functions rather than completely replacing them.
- **Ring Buffer Storage**: Logs are stored in a size-capped memory buffer (e.g., 200 entries) inside the facade to avoid memory leaks during long development sessions.
- **Strict Format Preserves**: Captures caller origin tags, stack traces for errors, timestamp offsets, and stringifies complex objects safely to avoid circular reference references.

### 2.2 Semantic Network & Database Monitoring
Instead of capturing raw HTTP headers or low-level websocket payloads, the telemetry layer translates these transactions into **human-friendly domain actions** (domain metrics).

- **Firestore Operation Interception**:
  - We capture query paths (e.g., `/books/9780132350884` or `/bookDetails`) and inspect Firestore's snapshot `metadata.fromCache` boolean.
  - This populates a dedicated cached-access counter: `Cache Hit Ratio = (Cache Hits / Total Reads) * 100`.
- **API Call Profiler**:
  - Outgoing metadata calls via Google Books, OpenLibrary, and Express API routes are proxied.
  - Telemetry logs contain: Operation Name (e.g., *"Ingest Cover Art"*), response status (e.g., `200 Success`), duration in milliseconds, and bytes returned.
- **AI Model Diagnostics**:
  - Dedicated telemetry for tracking Google Gemini queries (e.g., *"Cluster Thematic Labeling"*), recording total prompt tokens, execution time, and model version used.

### 2.3 Page State Tracker (Hook-Based State Exposure)
To inspect what actual states are steering the current page view, components can voluntarily "register" their local state dependencies with our debugger using a clean React Hook.

- **Hook Signature**: `useDebugInspect(moduleName, stateObject)`
- **Behavior**: Whenever the `stateObject` changes, the hook publishes the update to the Debug Telemetry Engine, making it instantly browsable in an interactive tree view.
- **Example Usage**: Inspecting exact coordinate maps, loaded books list size, active cluster labels, and UMAP settings in real time.

---

## 3. UI/UX & Interaction Design

The HUD Console lives as an elegant, modern visual overlay positioned at the bottom of the viewport. It handles visual rhythm through crisp monospaced typography, robust filtering tabs, and subtle layout transitions.

### 3.1 Design Palette & Typography
- **Background Theme**: High-contrast, deeply saturated obsidian slate (`rgb(15, 17, 23, 0.95)`) backdrops with frosted glass blur effects (`backdrop-blur-md`). This distinguishes the console from primary page components visually.
- **Typography pairings**: 
  - **JetBrains Mono**: For logs, payload trees, network queries, and raw metrics.
  - **Inter**: For tabs, filter toggles, buttons, and section titles.
- **Log Accents**:
  - `Error`: Soft red text with warning outlines (`#f87171` / `border-red-500/30`).
  - `Warn`: Vibrant amber accents (`#fbbf24`).
  - `Info`: Electric cyan indicators (`#22d3ee`).
  - `Log`: Balanced silver-gray tones (`#cbd5e1`).

### 3.2 Main Layout & Tabs Dashboard

```
+-----------------------------------------------------------------------------------------+
| [O] DEBUG CONSOLE  [Active Page: Constellation_Map]   [Latency: 48ms]  [Cache: 84% Hit] |
+-----------------------------------------------------------------------------------------+
| [ Console Logs ] [ Network & DB Ops ] [ Active Page State ] [ Diagnostics & Workers ]   |
+-----------------------------------------------------------------------------------------+
|  Filter: [X] Info   [X] Logs   [X] Warnings   [X] Errors                   Search: [   ]   |
|                                                                                         |
|  13:14:02 [DB_READ]   Read Collection 'books' (12 items) ---> (FROM CACHE ✓)            |
|  13:14:03 [API_RES]   GET /api/books/enrich/9780132350884 ---> (Status: 200, 142ms)      |
|  13:14:05 [WORKER]    UMAP Web Worker initialized. Thread ID: 2                         |
|  13:14:07 [GEN_AI]    Gemini Flash: Categorized 12 items as "Cyberpunk Lit" (64 tokens)   |
|  13:14:08 [WARN]      Missing high-resolution thumbnail asset for selected book title.  |
|                                                                                         |
+-----------------------------------------------------------------------------------------+
```

### 3.3 Dashboard Breakdown

1.  **Console Logs Pane**:
    - Includes multi-checkbox level filter.
    - Integrated text filter to locate specific messages.
    - An option to export the current debug log buffer as a clean `.json` file for inclusion in issues or bug reports.
2.  **Network & DB Ops Pane**:
    - Timeline of semantic database queries and third-party API fetches.
    - Displays active execution latency.
    - Highlights whether Firestore data came from server transactions or offline local persistence caches.
3.  **Active Page State Pane**:
    - Dynamic interactive component displaying deep JSON structures.
    - Collapsible nodes to inspect only what is relevant.
4.  **Diagnostics & Workers Pane**:
    - Real-time CPU latency logs.
    - Online/Offline connectivity indicators (`navigator.onLine`).
    - Web Worker thread state analytics (running counts, computation workloads, thread memory usage).
    - Session lifetime statistics (total database reads, average Gemini API response time, cumulative network bandwidth).

---

## 4. Implementation Steps & Development Sequence

1.  **Build Telemetry Engine**: Create `src/lib/telemetry.ts` implementing the Singleton manager, log buffer, subscription bus, and console monkey-patching wrapper.
2.  **Build Inspector Hook**: Create `src/hooks/useDebugInspect.ts` to coordinate registration and updates from mounted React views.
3.  **Create Console HUD Component**: Create `src/components/DebugConsoleHUD.tsx` utilizing `motion` (from `motion/react`) for smooth accordion slide-ups and collapsible tabs. Stylize using high-quality Tailwind utilities and JetBrains Mono.
4.  **Integrate Proxy Hooks**:
    - Intercept Express requests and output high-level logs under `[Express API]`.
    - Intercept Firebase Reads and inspect snapshot metadata.
5.  **Inject debug console into `App.tsx`**: Add the HUD directly to the footer of the global parent component. It can be toggled using `Ctrl + ~` or are hidden based on environment values (`process.env.NODE_ENV !== 'production'`).

---
