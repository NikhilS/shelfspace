# Goodreads API Evaluation

## Overview & Current Status (Is it usable?)
The official **Goodreads API is retired and no longer usable for new applications**. 
In December 2020, Goodreads (owned by Amazon) explicitly announced the deprecation of their developer API and stopped issuing new API keys. While some legacy applications with existing keys may still have partial access to certain endpoints, no new developer registrations are accepted, and the API is wholly unsupported. 

Because we are building a modern application and cannot obtain a developer key, **the Goodreads API is completely unusable for our project.**

## What it Supports & What it was Good At
Historically, the Goodreads API excelled at **social graph and subjective user data**:
*   **User Reviews & Ratings:** Access to millions of rich, text-heavy user reviews and aggregate rating data.
*   **Reading States:** Data on what users are currently reading, want to read, or have read (Shelves).
*   **Community Data:** Friends, group discussions, and reading challenges.

It was essentially the absolute best source for qualitative data on how humans felt about a book, replacing the need for an application to build its own standalone social network.

## Comparison to Our Existing APIs (Google Books & OpenLibrary)
*   **Google Books API:** 
    *   *Strengths:* Extremely reliable, massive database, great for core metadata (ISBNs, authors, page counts, raw descriptions), supports full-text search, and provides cover images.
    *   *Weaknesses:* Lacks rich community/social data. Ratings are present but very sparse compared to Goodreads.
*   **OpenLibrary API:**
    *   *Strengths:* Fully open-source and open-data, great for resolving obscure editions, historical publications, classification systems (LCC, DDC), and subject linking.
    *   *Weaknesses:* Slower, rate-limited, UI/cover images can be inconsistent, and absolutely zero social review data.
*   **Goodreads API (Historical):**
    *   *Strengths:* Unmatched social and review data, community tagging (genres derived from user shelves).
    *   *Weaknesses:* Closed ecosystem, restrictive terms of service, and now officially dead.

## Recommendation
**We absolutely should NOT attempt to use the Goodreads API.** 
Attempting to use it would require illicit web scraping (which violates Goodreads/Amazon Terms of Service, risks IP bans, and creates brittle infrastructure that breaks on UI updates) or trying to buy/find a legacy API key (which is insecure and unsustainable).

### Strategic Alternative & Interaction with Existing APIs
Because we cannot get Goodreads' social data, we need to lean into our existing API stack and augment it with our AI layer:
1.  **Core Metadata:** Continue using **Google Books** as the primary source of truth for standard metadata (Title, Author, Publisher, Synopsis, Cover Images) and **OpenLibrary** as a fallback for missing ISBNs or deep library classifications.
2.  **Replacing Goodreads' Recommendations (The AI Layer):** Instead of relying on Goodreads for community recommendations and genre-tagging, we should utilize our existing **Gemini AI integration**. We are already using Gemini to bulk-enrich books with missing temporal, geographic, and thematic metadata. We can extend Gemini's capabilities to generate "AI-curated" reading recommendations, subjective themes, and "similar books" graphs.
3.  **Replacing Goodreads' Ratings (Internal State):** We will build and store our own subjective review/rating data within our own Firestore database (`bookDetails` collection) rather than pulling external ratings.

By completely avoiding Goodreads, we remain independent, terms-of-service compliant, and build a highly resilient architecture backed by Google Books, OpenLibrary, and Gemini.
