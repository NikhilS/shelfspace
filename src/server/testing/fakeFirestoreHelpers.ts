/**
 * @fileoverview Pure path, FieldValue sentinel, cloning, and query-predicate helpers
 * for the spec-compliant in-memory FakeFirestore test engine.
 */

export interface FakeTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate: () => Date;
  toMillis: () => number;
}

export function createFakeTimestamp(ms = Date.now()): FakeTimestamp {
  const seconds = Math.floor(ms / 1000);
  const nanoseconds = (ms % 1000) * 1_000_000;
  return {
    seconds,
    nanoseconds,
    toDate: () => new Date(ms),
    toMillis: () => ms,
  };
}

export type WhereOp =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'array-contains'
  | 'array-contains-any';

export interface WhereClause {
  segments: string[];
  op: WhereOp;
  value: unknown;
}

export interface OrderByClause {
  segments: string[];
  direction: 'asc' | 'desc';
}

export interface QueryOptions {
  wheres: WhereClause[];
  orderBys: OrderByClause[];
  limitCount?: number;
  startAfterValues?: unknown[];
  selectedFields?: string[][];
}

export function normalizePath(rawPath: string): string {
  return rawPath
    .split('/')
    .map(part => part.trim())
    .filter(Boolean)
    .join('/');
}

export function getCollectionPathFromDocPath(docPath: string): string {
  const parts = docPath.split('/');
  return parts.slice(0, -1).join('/');
}

export function getDocIdFromPath(docPath: string): string {
  const parts = docPath.split('/');
  return parts[parts.length - 1] || '';
}

export function extractFieldSegments(fieldOrPath: unknown): string[] {
  if (typeof fieldOrPath === 'string') {
    if (fieldOrPath === '__name__') {
      return ['__name__'];
    }
    return fieldOrPath.split('.').filter(Boolean);
  }
  if (fieldOrPath && typeof fieldOrPath === 'object') {
    const obj = fieldOrPath as {
      segments?: unknown;
      _segments?: unknown;
      formattedName?: unknown;
    };
    if (Array.isArray(obj.segments)) {
      return obj.segments.map(String);
    }
    if (Array.isArray(obj._segments)) {
      return obj._segments.map(String);
    }
    if (typeof obj.formattedName === 'string') {
      return [obj.formattedName];
    }
  }
  return [String(fieldOrPath)];
}

export function cloneValue<Val>(value: Val): Val {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as Val;
  }
  if (
    typeof (value as {toDate?: unknown}).toDate === 'function' &&
    typeof (value as {toMillis?: unknown}).toMillis === 'function'
  ) {
    const ms = (value as unknown as {toMillis: () => number}).toMillis();
    return createFakeTimestamp(ms) as unknown as Val;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item: unknown) =>
      cloneValue(item),
    ) as unknown as Val;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry !== undefined) {
      copy[key] = cloneValue(entry);
    }
  }
  return copy as unknown as Val;
}

interface DetectedSentinel {
  kind:
    'serverTimestamp' | 'delete' | 'increment' | 'arrayUnion' | 'arrayRemove';
  operand?: number;
  elements?: unknown[];
}

function detectFieldValueSentinel(value: unknown): DetectedSentinel | null {
  if (typeof value === 'string') {
    if (
      value === 'MOCK_SERVER_TIMESTAMP' ||
      value === 'SERVER_TIMESTAMP' ||
      value === 'MOCK_TS' ||
      value === 'MOCK_TIMESTAMP'
    ) {
      return {kind: 'serverTimestamp'};
    }
    if (value === 'MOCK_DELETE_FIELD') {
      return {kind: 'delete'};
    }
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  if (value instanceof Date) {
    return null;
  }
  const ctorName =
    (value as {constructor?: {name?: string}}).constructor?.name || '';
  const obj = value as Record<string, unknown>;
  const methodName = typeof obj._methodName === 'string' ? obj._methodName : '';

  if (
    ctorName.includes('ServerTimestamp') ||
    methodName.includes('serverTimestamp') ||
    '_serverTimestamp' in obj
  ) {
    return {kind: 'serverTimestamp'};
  }
  if (
    ctorName.includes('Delete') ||
    methodName.includes('delete') ||
    '_delete' in obj
  ) {
    return {kind: 'delete'};
  }
  if (
    ctorName.includes('NumericIncrement') ||
    methodName.includes('increment') ||
    '_increment' in obj
  ) {
    const operand =
      typeof obj.operand === 'number'
        ? obj.operand
        : typeof obj._increment === 'number'
          ? obj._increment
          : 0;
    return {kind: 'increment', operand};
  }
  if (
    ctorName.includes('ArrayUnion') ||
    methodName.includes('arrayUnion') ||
    '_arrayUnion' in obj
  ) {
    const elements = Array.isArray(obj.elements)
      ? obj.elements
      : Array.isArray(obj._arrayUnion)
        ? obj._arrayUnion
        : [];
    return {kind: 'arrayUnion', elements};
  }
  if (
    ctorName.includes('ArrayRemove') ||
    methodName.includes('arrayRemove') ||
    '_arrayRemove' in obj
  ) {
    const elements = Array.isArray(obj.elements)
      ? obj.elements
      : Array.isArray(obj._arrayRemove)
        ? obj._arrayRemove
        : [];
    return {kind: 'arrayRemove', elements};
  }
  return null;
}

export function getNestedValue(
  docId: string,
  data: Record<string, unknown>,
  segments: string[],
): unknown {
  if (segments.length === 1 && segments[0] === '__name__') {
    return docId;
  }
  let cursor: unknown = data;
  for (const seg of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

function applyValueTransform(
  currentValue: unknown,
  incomingValue: unknown,
  mergeSubObjects: boolean,
): {shouldDelete: boolean; value: unknown} {
  const sentinel = detectFieldValueSentinel(incomingValue);
  if (sentinel) {
    if (sentinel.kind === 'delete') {
      return {shouldDelete: true, value: undefined};
    }
    if (sentinel.kind === 'serverTimestamp') {
      return {shouldDelete: false, value: createFakeTimestamp()};
    }
    if (sentinel.kind === 'increment') {
      const base = typeof currentValue === 'number' ? currentValue : 0;
      return {shouldDelete: false, value: base + (sentinel.operand ?? 0)};
    }
    if (sentinel.kind === 'arrayUnion') {
      const base: unknown[] = Array.isArray(currentValue)
        ? [...(currentValue as unknown[])]
        : [];
      for (const el of sentinel.elements || []) {
        if (!base.some(item => item === el)) {
          base.push(cloneValue(el));
        }
      }
      return {shouldDelete: false, value: base};
    }
    if (sentinel.kind === 'arrayRemove') {
      const removeSet = new Set(sentinel.elements || []);
      const base = Array.isArray(currentValue)
        ? currentValue.filter(item => !removeSet.has(item))
        : [];
      return {shouldDelete: false, value: base};
    }
  }

  if (incomingValue === undefined) {
    return {shouldDelete: false, value: currentValue};
  }

  if (
    mergeSubObjects &&
    incomingValue &&
    typeof incomingValue === 'object' &&
    !Array.isArray(incomingValue) &&
    !(incomingValue instanceof Date) &&
    typeof (incomingValue as {toDate?: unknown}).toDate !== 'function' &&
    currentValue &&
    typeof currentValue === 'object' &&
    !Array.isArray(currentValue)
  ) {
    const merged: Record<string, unknown> = cloneValue(
      currentValue as Record<string, unknown>,
    );
    for (const [k, v] of Object.entries(
      incomingValue as Record<string, unknown>,
    )) {
      const child = applyValueTransform(merged[k], v, true);
      if (child.shouldDelete) {
        delete merged[k];
      } else if (child.value !== undefined) {
        merged[k] = child.value;
      }
    }
    return {shouldDelete: false, value: merged};
  }

  if (
    incomingValue &&
    typeof incomingValue === 'object' &&
    !Array.isArray(incomingValue) &&
    !(incomingValue instanceof Date) &&
    typeof (incomingValue as {toDate?: unknown}).toDate !== 'function'
  ) {
    const transformedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      incomingValue as Record<string, unknown>,
    )) {
      const child = applyValueTransform(undefined, v, false);
      if (!child.shouldDelete && child.value !== undefined) {
        transformedObj[k] = child.value;
      }
    }
    return {shouldDelete: false, value: transformedObj};
  }

  return {shouldDelete: false, value: cloneValue(incomingValue)};
}

export function setBySegments(
  target: Record<string, unknown>,
  segments: string[],
  incomingValue: unknown,
  mergeSubObjects: boolean,
): void {
  if (segments.length === 0) {
    return;
  }
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const existing = cursor[seg];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, unknown>;
  }
  const leafKey = segments[segments.length - 1];
  const resolved = applyValueTransform(
    cursor[leafKey],
    incomingValue,
    mergeSubObjects,
  );
  if (resolved.shouldDelete) {
    delete cursor[leafKey];
  } else if (resolved.value !== undefined) {
    cursor[leafKey] = resolved.value;
  }
}

function toComparablePrimitive(val: unknown): string | number | boolean | null {
  if (val === undefined || val === null) {
    return null;
  }
  if (
    typeof val === 'number' ||
    typeof val === 'boolean' ||
    typeof val === 'string'
  ) {
    return val;
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof (val as {toDate?: unknown}).toDate === 'function') {
    return (val as {toDate: () => Date}).toDate().toISOString();
  }
  return JSON.stringify(val);
}

export function comparePrimitives(leftRaw: unknown, rightRaw: unknown): number {
  const left = toComparablePrimitive(leftRaw);
  const right = toComparablePrimitive(rightRaw);
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return -1;
  }
  if (right === null) {
    return 1;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left < right ? -1 : 1;
  }
  const leftStr = String(left);
  const rightStr = String(right);
  return leftStr < rightStr ? -1 : leftStr > rightStr ? 1 : 0;
}

export function matchesWhereClause(
  docId: string,
  data: Record<string, unknown>,
  clause: WhereClause,
): boolean {
  const fieldVal = getNestedValue(docId, data, clause.segments);
  const targetVal = clause.value;

  switch (clause.op) {
    case '==':
      if (fieldVal === undefined) {
        return targetVal === null || targetVal === undefined;
      }
      return (
        toComparablePrimitive(fieldVal) === toComparablePrimitive(targetVal)
      );
    case '!=':
      return (
        toComparablePrimitive(fieldVal) !== toComparablePrimitive(targetVal)
      );
    case '<':
      return (
        fieldVal !== undefined &&
        fieldVal !== null &&
        comparePrimitives(fieldVal, targetVal) < 0
      );
    case '<=':
      return (
        fieldVal !== undefined &&
        fieldVal !== null &&
        comparePrimitives(fieldVal, targetVal) <= 0
      );
    case '>':
      return (
        fieldVal !== undefined &&
        fieldVal !== null &&
        comparePrimitives(fieldVal, targetVal) > 0
      );
    case '>=':
      return (
        fieldVal !== undefined &&
        fieldVal !== null &&
        comparePrimitives(fieldVal, targetVal) >= 0
      );
    case 'in': {
      if (!Array.isArray(targetVal)) {
        return false;
      }
      const normalizedField = toComparablePrimitive(fieldVal);
      return targetVal.some(
        item => toComparablePrimitive(item) === normalizedField,
      );
    }
    case 'array-contains': {
      if (!Array.isArray(fieldVal)) {
        return false;
      }
      const normalizedTarget = toComparablePrimitive(targetVal);
      return fieldVal.some(
        item => toComparablePrimitive(item) === normalizedTarget,
      );
    }
    case 'array-contains-any': {
      if (!Array.isArray(fieldVal) || !Array.isArray(targetVal)) {
        return false;
      }
      const targets = new Set(
        targetVal.map(item => toComparablePrimitive(item)),
      );
      return fieldVal.some(item => targets.has(toComparablePrimitive(item)));
    }
    default:
      return false;
  }
}

export function normalizeUpdateArgs(
  dataOrField: Record<string, unknown> | unknown,
  moreFieldsAndValues: unknown[],
): Record<string, unknown> {
  if (
    moreFieldsAndValues.length === 0 &&
    dataOrField &&
    typeof dataOrField === 'object' &&
    !Array.isArray(dataOrField) &&
    !('segments' in (dataOrField as Record<string, unknown>)) &&
    !('_segments' in (dataOrField as Record<string, unknown>))
  ) {
    return dataOrField as Record<string, unknown>;
  }
  const updateObj: Record<string, unknown> = {};
  const pairs: unknown[] = [dataOrField, ...moreFieldsAndValues];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const segs = extractFieldSegments(pairs[i]);
    updateObj[segs.join('.')] = pairs[i + 1];
  }
  return updateObj;
}
