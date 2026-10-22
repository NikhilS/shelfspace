import {Book} from '../types';

export type DuplicateMatchReason =
  'Exact ISBN' | 'Exact Title & Author' | 'Fuzzy Title/Subtitle Match';

export interface DuplicateGroupMetadata {
  groupKey: string;
  books: Book[];
  confidence: number;
  reason: DuplicateMatchReason;
}

export function normalizeIsbnForDedupe(raw?: string): string {
  if (!raw) {
    return '';
  }
  return raw
    .trim()
    .replace(/[^0-9X]/gi, '')
    .toUpperCase();
}

export function normalizeTitleForDedupe(
  raw?: string,
  stripSubtitle = false,
): string {
  if (!raw) {
    return '';
  }
  let t = raw.trim().toLowerCase();

  // Strip parenthetical or bracketed series suffixes e.g. "(The Lord of the Rings, #1)"
  t = t.replace(/\s*\([^)]*#\d+[^)]*\)/g, '');
  t = t.replace(/\s*\[[^\]]*#\d+[^\]]*\]/g, '');

  if (stripSubtitle) {
    // Strip subtitle after colon or dash
    t = t.split(':')[0].split(' - ')[0].split(' — ')[0];
    // Also strip trailing parenthetical notes
    t = t.replace(/\s*\([^)]*\)\s*$/g, '');
  }

  // Strip punctuation
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  // Strip leading English articles
  t = t.replace(/^\s*(the|a|an)\s+/i, '');

  return t.replace(/\s+/g, ' ').trim();
}

export function normalizeAuthorForDedupe(raw?: string): string {
  if (!raw) {
    return '';
  }
  let a = raw.trim().toLowerCase();
  if (a.includes(',')) {
    const parts = a
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);
    if (parts.length === 2) {
      a = `${parts[1]} ${parts[0]}`;
    }
  }
  a = a.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return a.replace(/\s+/g, ' ').trim();
}

export function diceCoefficient(a: string, b: string): number {
  if (!a && !b) {
    return 1;
  }
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

export function detectDuplicatesWithConfidence(
  books: Book[],
): DuplicateGroupMetadata[] {
  if (!books || books.length < 2) {
    return [];
  }

  const adjList: Record<string, Set<string>> = {};
  const edgeMeta = new Map<
    string,
    {confidence: number; reason: DuplicateMatchReason}
  >();

  const edgeKey = (id1: string, id2: string) =>
    id1 < id2 ? `${id1}::${id2}` : `${id2}::${id1}`;

  const addEdge = (
    id1: string,
    id2: string,
    confidence: number,
    reason: DuplicateMatchReason,
  ) => {
    if (id1 === id2) {
      return;
    }
    if (!adjList[id1]) {
      adjList[id1] = new Set();
    }
    if (!adjList[id2]) {
      adjList[id2] = new Set();
    }
    adjList[id1].add(id2);
    adjList[id2].add(id1);

    const k = edgeKey(id1, id2);
    const existing = edgeMeta.get(k);
    if (!existing || confidence > existing.confidence) {
      edgeMeta.set(k, {confidence, reason});
    }
  };

  const isbnGroups: Record<string, string[]> = {};
  const exactTitleAuthorGroups: Record<string, string[]> = {};

  interface PreparedBook {
    book: Book;
    cleanIsbn: string;
    fullTitle: string;
    coreTitle: string;
    cleanAuthor: string;
    format: string;
  }

  const prepared: PreparedBook[] = books.map(book => {
    const cleanIsbn = normalizeIsbnForDedupe(book.isbn);
    const fullTitle = normalizeTitleForDedupe(book.title, false);
    const coreTitle = normalizeTitleForDedupe(book.title, true);
    const cleanAuthor = normalizeAuthorForDedupe(book.author);
    const format = book.format || 'physical';

    if (cleanIsbn) {
      const key = `${cleanIsbn}:${format}`;
      if (!isbnGroups[key]) {
        isbnGroups[key] = [];
      }
      isbnGroups[key].push(book.id);
    }

    if (fullTitle && cleanAuthor) {
      const key = `${fullTitle}|${cleanAuthor}:${format}`;
      if (!exactTitleAuthorGroups[key]) {
        exactTitleAuthorGroups[key] = [];
      }
      exactTitleAuthorGroups[key].push(book.id);
    }

    return {
      book,
      cleanIsbn,
      fullTitle,
      coreTitle,
      cleanAuthor,
      format,
    };
  });

  for (const group of Object.values(isbnGroups)) {
    if (group.length > 1) {
      const first = group[0];
      for (let i = 1; i < group.length; i++) {
        addEdge(first, group[i], 100, 'Exact ISBN');
      }
    }
  }

  for (const group of Object.values(exactTitleAuthorGroups)) {
    if (group.length > 1) {
      const first = group[0];
      for (let i = 1; i < group.length; i++) {
        addEdge(first, group[i], 98, 'Exact Title & Author');
      }
    }
  }

  // Fuzzy pass bucketed by format and author prefix / length to stay fast on large libraries
  const byFormat = new Map<string, PreparedBook[]>();
  for (const item of prepared) {
    if (!item.coreTitle || !item.cleanAuthor) {
      continue;
    }
    const list = byFormat.get(item.format) || [];
    list.push(item);
    byFormat.set(item.format, list);
  }

  for (const list of byFormat.values()) {
    const n = list.length;
    if (n < 2 || n > 2500) {
      continue;
    }

    for (let i = 0; i < n; i++) {
      const a = list[i];
      for (let j = i + 1; j < n; j++) {
        const b = list[j];

        // If both have valid ISBNs and they differ, only merge if coreTitle & author are near-identical
        const authorSim = diceCoefficient(a.cleanAuthor, b.cleanAuthor);
        if (authorSim < 0.82) {
          continue;
        }

        const coreSim = diceCoefficient(a.coreTitle, b.coreTitle);
        const fullSim = diceCoefficient(a.fullTitle, b.fullTitle);
        const bestTitleSim = Math.max(coreSim, fullSim);

        if (bestTitleSim < 0.86) {
          continue;
        }

        const combined = bestTitleSim * 0.65 + authorSim * 0.35;
        if (combined >= 0.88) {
          const score = Math.min(96, Math.round(combined * 100));
          addEdge(a.book.id, b.book.id, score, 'Fuzzy Title/Subtitle Match');
        }
      }
    }
  }

  const visited = new Set<string>();
  const results: DuplicateGroupMetadata[] = [];
  const bookMap = new Map(books.map(b => [b.id, b]));

  for (const node of Object.keys(adjList)) {
    if (visited.has(node)) {
      continue;
    }

    const groupIds: string[] = [];
    const queue = [node];
    visited.add(node);

    let bestConfidence = 88;
    let bestReason: DuplicateMatchReason = 'Fuzzy Title/Subtitle Match';

    while (queue.length > 0) {
      const curr = queue.shift()!;
      groupIds.push(curr);
      for (const neighbor of adjList[curr] || []) {
        const meta = edgeMeta.get(edgeKey(curr, neighbor));
        if (meta && meta.confidence >= bestConfidence) {
          bestConfidence = meta.confidence;
          bestReason = meta.reason;
        }
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (groupIds.length > 1) {
      const groupBooks = groupIds.map(id => bookMap.get(id)!).filter(Boolean);
      if (groupBooks.length > 1) {
        results.push({
          groupKey: groupBooks
            .map(b => b.id)
            .sort()
            .join(':'),
          books: groupBooks,
          confidence: bestConfidence,
          reason: bestReason,
        });
      }
    }
  }

  return results;
}
