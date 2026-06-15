# Design Document: Spruce Up Page Overhaul & AI-Powered Genre Enrichment

## Overview
This document outlines the redesign of the "Spruce Up" page to transition from a list-based view to a comprehensive tabular management interface. A key feature of this redesign is the addition of batch-processed, AI-driven genre classification using the BISAC Subject Headings standard.

## 1. Product/User Flow Redesign

### Current State
- `DuplicateSection`: Lists duplicate groups for deletion/dismissal.
- `MetadataSection`: Lists books with missing specific fields (cover, synopsis, etc.) with individual "Fix" buttons.

### Future State (Overhaul)
The "Metadata Section" will evolve into a "Library Integrity Table":

1.  **Tabular View of All Books**:
    - **Selection**: Checkbox column (with "Select All").
    - **Book Info**: Title, Author.
    - **Status/Integrity**: A dynamic column (or multiple tags) showing what metadata is missing (e.g., "Missing Genre", "Missing Synopsis", "Low Res Cover").
    - **Current Genre**: Shows the existing genre (if any).

2.  **Filtering & Search**:
    - Filter by "Missing Type" (e.g., Show only books with missing genres).
    - Filter by "Selection State" (Selected vs Unselected).

3.  **Universal Action Bar**:
    - Located prominently above the table.
    - Actions are applied only to **selected** books.
    - **Fix Missing Metadata**: Uses Google Books / OpenLibrary to fill in missing fields (except Genre via AI).
    - **Force Sync All Metadata**: Refreshes all fields from external APIs for selected books.
    - **Fix Missing Genre (AI)**: Only for selected books missing genres. Uses Gemini with the batching logic.
    - **Force Sync Genre (AI)**: Overwrites existing genres with AI-suggested BISAC categories for selected books.

4.  **Progress & Feedback**:
    - Real-time progress bar indicating the number of books processed.
    - Status indicators per row during processing (e.g., "Processing...", "Success", "Failed").

---

## 2. Technical Implementation: AI Genre Enrichment

### Model Selection
- **Gemini 2.0 Flash**: Selected for high speed, reliability, and cost-effectiveness for classification tasks.

### Input Data Construction
For each book in a batch:
- **Title**
- **Author**
- **Description Snippet**: First 300 characters of the `synopsis` (to provide semantic context without ballooning token usage).

### Prompt Strategy
The prompt will explicitly instruct Gemini to act as a librarian specializing in BISAC classification.
- **Constraint**: MUST return only values from the provided/known BISAC Subject Headings list.
- **Example Prompt Structure**:
  ```text
  You are an expert librarian. Classify the following batch of 20 books into the most appropriate BISAC Subject Headings.
  Use only established BISAC categories (e.g., FICTION / Mystery & Detective / General, BIOGRAPHY & AUTOBIOGRAPHY / Historical).
  
  Format the output as a JSON array where each object has:
  1. "id": the provided ID
  2. "genres": an array of 1-3 suggested BISAC categories.

  Books:
  1. ID: [id], Title: [title], Author: [author], Context: [description_300]
  ...
  ```

### Batching & Parallelization
To optimize API usage and UI responsiveness:
- **Batch Size**: 20 books per single API call.
- **Concurrency**: Up to 3 parallel batch calls (60 books processing at once).
- **Library**: `date-fns` for timestamping metadata updates, and standard `Promise.all` with chunking for parallelization.

---

## 3. Metadata Source Priority Update

### Genre Fetching
- **Current Metadata Flow**: In `getTieredMetadata`, genre fetching from Google Books/Open Library remains as a "Standard" baseline.
- **AI Refinement**: The "Fix Genre using AI" action will be a targeted second-pass enrichment that specifically maps books to the structured BISAC taxonomy, providing higher quality and more consistent data than raw API categories.

---

## 4. Proposed File Structure Changes

- `src/pages/spruce-up/LibraryIntegrityTable.tsx`: New component replaces `MetadataSection`.
- `src/pages/spruce-up/SpruceUpActionBar.tsx`: New component for multi-select actions.
- `src/services/gemini.ts`: Add `classifyBooks(books: BookBatch[])` function.
- `src/hooks/useSpruceUp.ts`: Update to support bulk selection and the four new action paths.

---

## 5. Migration Plan
1.  Implement the `LibraryIntegrityTable` with basic selection.
2.  Add the `SpruceUpActionBar`.
3.  Implement the Gemini-based `classifyBooks` service.
4.  Wire up the batching logic in `useSpruceUp`.
5.  Refactor `DuplicateSection` to sit below or alongside the new table (or integrate as a filter view).
