# Implementation Plan: Full Google TypeScript Style Guide Compliance

## Overview
We will bring the entire **book(ish)** codebase (**339 TypeScript files**: 237 source files and 102 test files) into **100% compliance with the official [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)** and **`gts` v7**, lock in automated enforcement via `eslint.config.cjs`, and codify these standards in the Evergreen Architecture Documentation (`docs/evergreen/`).

---

## Phase 1: Eliminate Default Exports (§ 3.3.2 — Named Exports Only)
The Google TypeScript Style Guide forbids `export default` so that every imported symbol has a canonical, refactor-safe name across the repository.

1. **Convert all 24 application files from `export default` to named exports (`export function ...`)**:
   - **Root & Layout (`3 files`)**:
     - `src/App.tsx` (`export function App()`)
     - `src/components/layout/AppLayout.tsx` (`export function AppLayout()`)
     - `src/components/layout/ScrollToTop.tsx` (`export function ScrollToTop()`)
   - **Route Page Views (`11 files`)**:
     - `src/pages/AddBookView.tsx` (`export function AddBookView()`)
     - `src/pages/AdminDashboard.tsx` (`export function AdminDashboard()`)
     - `src/pages/BookDetailsView.tsx` (`export function BookDetailsView()`)
     - `src/pages/ConstellationMap.tsx` (`export function ConstellationMap()`)
     - `src/pages/Dashboard.tsx` (`export function Dashboard()`)
     - `src/pages/LibraryView.tsx` (`export function LibraryView()`)
     - `src/pages/Login.tsx` (`export function Login()`)
     - `src/pages/SpruceUpView.tsx` (`export function SpruceUpView()`)
     - `src/pages/TimelineView.tsx` (`export function TimelineView()`)
     - `src/pages/WorldMap.tsx` (`export function WorldMap()`)
     - `src/pages/constellations/ConstellationChart.tsx` (`export function ConstellationChart()`)
   - **Book & Import Components (`10 files`)**:
     - `src/components/book/BookCard.tsx` (`export const BookCard = ...`)
     - `src/components/import/BarcodeScanner.tsx` (`export function BarcodeScanner()`)
     - `src/components/import/BookSearch.tsx` (`export function BookSearch()`)
     - `src/components/import/BulkImport.tsx` (`export function BulkImport()`)
     - `src/components/import/CsvImportTab.tsx` *(renamed from `CSVImportTab.tsx`, `export function CsvImportTab()`)*
     - `src/components/import/CameraScanner.tsx` (`export function CameraScanner()`)
     - `src/components/import/CoverCamera.tsx` (`export function CoverCamera()`)
     - `src/components/import/ExtractedBooksTable.tsx` (`export function ExtractedBooksTable()`)
     - `src/pages/add-book/CaptureShelfTab.tsx` (`export function CaptureShelfTab()`)
     - `src/pages/add-book/ScanIsbnTab.tsx` *(renamed from `ScanISBNTab.tsx`, `export function ScanIsbnTab()`)*
2. **Update all static imports, `React.lazy()` dynamic imports, and test mocks**:
   - Update `src/main.tsx`, `src/App.tsx`, `src/lib/routePreload.ts`, `src/pages/AddBookView.tsx`, `src/pages/ConstellationMap.tsx`, and all co-located `.test.tsx` files to import named symbols (using `.then(m => ({default: m.ComponentName}))` at `React.lazy` boundaries).
   - Keep `vite.config.ts` as the sole build-tool configuration exception required by Vite CLI.

---

## Phase 2: Standardize Named `function` Declarations Over `React.FC` Arrow Components (§ 5.2)
Google's style guide mandates `function foo()` declarations instead of `const foo = () =>` for named top-level functions and components.

1. **Refactor all 33 component files using `export const Component: React.FC<Props> = (...) =>` to `export function Component(props: Props)`**:
   - `src/components/book/`: `CoverGalleryPicker.tsx`, `CuratorPickCard.tsx`, `ExplorePerspectivesStrip.tsx`, `GenreBreakdownCard.tsx`, `ReadingBento.tsx`, `ReadingScopeToggle.tsx`
   - `src/components/debug/`: `DebugCacheTab.tsx`, `DebugConsoleHud.tsx`, `DebugConsoleLogsTab.tsx`, `DebugMetricsOverview.tsx`, `DebugNetworkTab.tsx`, `DebugPwaSystemTab.tsx`, `DebugStateInspectorTab.tsx`, `PersistenceTelemetryPanel.tsx`
   - `src/components/layout/BackToLibrary.tsx` & `src/components/ui/empty-state-illustrations.tsx`
   - `src/lib/telemetry/`: `GeminiTelemetryPlugin.tsx`, `RenderPerformancePlugin.tsx`
   - `src/pages/constellations/`: `ConstellationInspector.tsx`, `ConstellationToolbar.tsx`
   - `src/pages/dashboard/`: `CurrentlyReadingCard.tsx`, `ReadStackCanvasCard.tsx`, `ReadingListsDialog.tsx`
   - `src/pages/library/`: `BulkActionsBar.tsx`, `LibraryCollection.tsx`, `LibraryHeader.tsx`, `LibraryOverview.tsx`, `LibrarySettingsModals.tsx`, `LibraryShelf.tsx`
   - `src/pages/timeline/`: `TimelineBookList.tsx`, `TimelineControls.tsx`, `TimelineEraMarker.tsx`, `TimelineRiverCanvas.tsx`
   - `src/pages/world-map/`: `WorldMapCanvas.tsx`, `WorldMapInspector.tsx`

---

## Phase 3: Normalize Acronym Casing in Filenames & Identifiers (§ 7.2)
Google's style guide treats acronyms and abbreviations as whole words in `UpperCamelCase` / `lowerCamelCase` (`loadHttpUrl`, `CsvImportTab`, `ScanIsbnTab`, `DebugConsoleHud`).

1. **Rename 3 acronym-heavy component files (and co-located test)**:
   - `src/components/import/CSVImportTab.tsx` → `src/components/import/CsvImportTab.tsx` (symbol `CSVImportTab` → `CsvImportTab`)
   - `src/pages/add-book/ScanISBNTab.tsx` → `src/pages/add-book/ScanIsbnTab.tsx` (symbol `ScanISBNTab` → `ScanIsbnTab`)
   - `src/components/debug/DebugConsoleHUD.tsx` → `src/components/debug/DebugConsoleHud.tsx` (symbol `DebugConsoleHUD` → `DebugConsoleHud`)
   - `src/components/debug/DebugConsoleHUD.test.tsx` → `src/components/debug/DebugConsoleHud.test.tsx`
2. **Normalize acronym method/prop identifiers**:
   - `handleExportToCSV` → `handleExportToCsv` across `LibraryView.tsx`, `LibraryHeader.tsx`, `LibrarySettingsModals.tsx`, and their tests.

---

## Phase 4: Class Member Visibility (`no-public`), `interface` for Object Shapes, & `T[]` Array Syntax (§ 4.2, § 6.2, § 6.7)
1. **Remove redundant `public` modifiers across all 22 files**:
   - Strip explicit `public` keywords from methods, properties, and constructors in `src/components/layout/ErrorBoundary.tsx`, `src/lib/telemetry/*`, `src/pages/AdminDashboard.tsx`, `src/pages/book-details/useBookInsights.ts`, and `src/server/services/**` (`catalog/providers/*`, `enrichmentJobCoordinator.ts`, `gemini/client.ts`, `metadata/registry.ts`, `scheduler/*`, `telemetry/serverTelemetryBuffer.ts`).
2. **Convert object-shape `type` aliases to `interface` (§ 6.2)**:
   - `src/components/import/ExtractedBooksTable.tsx`: Convert `type ExtractedBooksTableProps = {...}` to `interface ExtractedBooksTableProps {...}`.
   - `src/server/services/book/bookWriteService.ts`: Convert object-literal `type` alias to `interface`.
3. **Normalize simple `Array<T>` generics to `T[]` (§ 6.7 `array-simple`)**:
   - Convert the 8 `Array<number>`, `Array<boolean>`, and `Array<Point2D>` annotations in `src/lib/clustering.ts` and 1 `Array<R>` annotation in `src/pages/add-book/useAddBooks.ts` to `number[]`, `boolean[]`, `Point2D[]`, and `R[]` (retaining `Array<...>` for complex object/union element types as required by Google style).

---

## Phase 5: Strict Typing in Test Files & ESLint Rule Hardening (§ 6.10)
1. **Eliminate all 52 `any` usages across the 11 test files**:
   - Replace `: any` and `as any` in test files (`ResetMetadataSection.test.tsx`, `WorldMap.test.tsx`, `EditBookForm.test.tsx`, `LibraryShelf.test.tsx`, `LibraryHeader.test.tsx`, `AppLayout.test.tsx`, `BookCard.test.tsx`, etc.) with strict types (`Partial<Book>`, `Book`, `unknown`, or typed test fixtures).
   - Clean up any unused imports or variables in test files.
2. **Harden `eslint.config.cjs`**:
   - Remove the `files: ['**/*.test.ts', '**/*.test.tsx']` override that disabled `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-unused-vars`, and `unused-imports/no-unused-imports`.
   - Add automated Google TypeScript Style Guide rules for all `.ts`/`.tsx` files:
     - `@typescript-eslint/array-type: ['error', {default: 'array-simple'}]`
     - `@typescript-eslint/explicit-member-accessibility: ['error', {accessibility: 'no-public'}]`
     - `@typescript-eslint/consistent-type-definitions: ['error', 'interface']`
     - `no-restricted-syntax` rule forbidding `ExportDefaultDeclaration` (with an override for `vite.config.ts`).

---

## Phase 6: Evergreen Documentation Updates & Full Verification
1. **Update `docs/evergreen/README.md`**:
   - Add a **TypeScript & Code Style** row to Section II (**The 'Golden Rules'**) referencing strict adherence to the **Google TypeScript Style Guide** and `gts`.
   - Record the compliance milestone in Section IV (**Living Architecture Changelog**).
2. **Update `docs/evergreen/06-CODEBASE-STRUCTURE-AND-CONVENTIONS.md`**:
   - Add **Section 3: Google TypeScript Style Guide Compliance (`gts`)** detailing the 7 core pillars enforced across the codebase:
     1. Named exports only (no `export default` in application code).
     2. `function` declarations for named functions and React components (no `React.FC` arrow components).
     3. Whole-word CamelCase for acronyms (`Csv`, `Isbn`, `Hud`, `Url`, `Api`).
     4. Implicit `public` visibility on class members (`accessibility: 'no-public'`).
     5. `interface` for object shapes; `type` for unions, intersections, and mapped types.
     6. `T[]` for simple array types and `Array<...>` for complex/union element types (`array-simple`).
     7. Zero `any` and zero non-null assertions (`!`) across both production and test suites.
   - Update the File & Identifier Naming table to reflect `CsvImportTab.tsx`, `ScanIsbnTab.tsx`, and `DebugConsoleHud.tsx`.
3. **Verification**:
   - Run `npm run lint` (`gts lint`), `npm test` (`vitest run`), and `compile_applet` (`npm run build`) to verify 0 lint errors, 100% passing tests, and a clean production build.
