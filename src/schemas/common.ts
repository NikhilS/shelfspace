import {z} from 'zod';

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const SAFE_RASTER_DATA_URL_REGEX =
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/i;

export function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Safe Firestore document identifier: 1-128 alphanumeric, underscore, or hyphen characters.
 * Rejects path traversal ('/', '..'), null bytes, and whitespace.
 */
export const safeIdSchema = z
  .string()
  .trim()
  .min(1, 'Identifier is required')
  .max(128, 'Identifier exceeds maximum length of 128 characters')
  .regex(
    SAFE_ID_REGEX,
    'Identifier may only contain letters, numbers, underscores, and hyphens',
  );

/**
 * Validates that a URL is either empty, a valid http(s) URL, or a safe raster image data URL.
 * Explicitly blocks javascript:, vbscript:, file:, data:text/html, and data:image/svg+xml.
 */
export function isSafeImageOrHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') {
    return true;
  }
  if (hasControlCharacters(trimmed)) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:') ||
    lower.startsWith('data:text/') ||
    lower.startsWith('data:image/svg')
  ) {
    return false;
  }

  if (lower.startsWith('data:')) {
    return SAFE_RASTER_DATA_URL_REGEX.test(trimmed);
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const safeUrlSchema = z
  .string()
  .trim()
  .max(2048, 'URL exceeds maximum length')
  .refine(isSafeImageOrHttpUrl, {
    message:
      'URL must use http(s) protocol or a valid raster data:image/(png|jpeg|webp|gif) URI',
  });

/**
 * Dedicated image URL schema that keeps standard http(s) URLs bounded to 2,048 characters
 * while allowing validated raster `data:image/(png|jpeg|jpg|webp|gif);base64,...` URIs
 * up to 500,000 characters (~375KB binary image) for persisted library hero banners and covers.
 */
export const safeImageUrlSchema = z
  .string()
  .trim()
  .max(500_000, 'Image URL or raster data URI exceeds maximum length of 500KB')
  .refine(isSafeImageOrHttpUrl, {
    message:
      'URL must use http(s) protocol or a valid raster data:image/(png|jpeg|webp|gif) URI',
  })
  .refine(
    val => {
      const trimmed = val.trim();
      if (trimmed === '' || trimmed.toLowerCase().startsWith('data:')) {
        return true;
      }
      return trimmed.length <= 2048;
    },
    {
      message: 'HTTP(S) URL exceeds maximum length of 2048 characters',
    },
  );

/**
 * Safe email schema that normalizes to lowercase and blocks Firestore path traversal characters.
 */
export const safeEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email is required')
  .max(254, 'Email exceeds maximum length')
  .email('Invalid email address')
  .refine(
    val =>
      !val.includes('/') &&
      !val.includes('\\') &&
      !val.includes('..') &&
      !hasControlCharacters(val),
    {
      message: 'Email contains disallowed path or control characters',
    },
  );

/**
 * Validates and normalizes an email address for safe use as a Firestore document ID.
 * Throws an Error if the email is malformed or contains path traversal sequences.
 */
export function validateAndNormalizeEmail(email: string): string {
  const parsed = safeEmailSchema.safeParse(email);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message || 'Invalid email address format',
    );
  }
  return parsed.data;
}

/**
 * Rejects objects that contain prototype pollution keys or Firestore dot-notation / slash keys.
 */
export function hasUnsafeObjectKeys(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    if (
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      key.includes('.') ||
      key.includes('/') ||
      hasControlCharacters(key)
    ) {
      return true;
    }
  }
  return false;
}

export interface ValidationIssueDetail {
  path: string;
  message: string;
  code: string;
}

export interface SchemaValidationContext {
  /** Logical entity or schema name (e.g., 'StoredBookDoc', 'StoredUserReadingStateDoc') */
  entity: string;
  /** Optional Firestore document path or identifier (e.g., '/users/u1/readingStates/isbn:9780140449136') */
  documentPath?: string;
  /** Operation being performed ('create' | 'update' | 'upsert' | 'read') */
  operation?: 'create' | 'update' | 'upsert' | 'read';
  /** If true, throws a SchemaValidationError when validation fails. */
  strict?: boolean;
  /** Optional custom debug logger callback (defaults to console.warn in non-production environments) */
  logger?: (message: string, details: Record<string, unknown>) => void;
}

export interface SchemaValidationResult<T> {
  success: boolean;
  data: T;
  issues: ValidationIssueDetail[];
}

export class SchemaValidationError extends Error {
  readonly entity: string;
  readonly documentPath?: string;
  readonly operation?: string;
  readonly issues: ValidationIssueDetail[];

  constructor(
    message: string,
    options: {
      entity: string;
      documentPath?: string;
      operation?: string;
      issues: ValidationIssueDetail[];
    },
  ) {
    super(message);
    this.name = 'SchemaValidationError';
    this.entity = options.entity;
    this.documentPath = options.documentPath;
    this.operation = options.operation;
    this.issues = options.issues;
  }
}

/**
 * Formats a ZodError into a flat array of human-readable field paths and issue descriptions.
 */
export function formatZodIssues(error: z.ZodError): ValidationIssueDetail[] {
  return error.issues.map(issue => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>',
    message: issue.message,
    code: issue.code,
  }));
}

const MOCK_SENTINEL_STRINGS = new Set([
  'MOCK_DELETE_FIELD',
  'MOCK_SERVER_TIMESTAMP',
  'MOCK_TS',
  'SERVER_TIMESTAMP',
  'MOCK_TIMESTAMP',
]);

/**
 * Detects Firebase Admin `FieldValue` sentinel transforms (e.g., `serverTimestamp()`,
 * `delete()`, `increment()`, `arrayUnion()`) and unit-test sentinel mocks so pre-persistence
 * validation can inspect domain fields without tripping on server-side sentinel objects.
 */
export function isFirestoreFieldValueSentinel(value: unknown): boolean {
  if (typeof value === 'string') {
    return MOCK_SENTINEL_STRINGS.has(value);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value) || value instanceof Date) {
    return false;
  }
  const ctorName = (value as {constructor?: {name?: string}}).constructor?.name;
  if (
    ctorName &&
    ctorName !== 'Object' &&
    (ctorName.includes('FieldValue') || ctorName.includes('Transform'))
  ) {
    return true;
  }
  const obj = value as Record<string, unknown>;
  if (
    '_methodName' in obj ||
    '_increment' in obj ||
    '_delete' in obj ||
    '_serverTimestamp' in obj
  ) {
    return true;
  }
  return false;
}

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Produces a validation-ready clone with Firestore `FieldValue` sentinels omitted,
 * dot-notation update paths expanded into nested objects for schema validation,
 * and `Date` instances normalized to ISO-8601 strings.
 */
export function stripFirestoreSentinels(value: unknown): unknown {
  if (value === undefined || isFirestoreFieldValueSentinel(value)) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .map(item => stripFirestoreSentinels(item))
      .filter(item => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const stripped = stripFirestoreSentinels(v);
      if (stripped === undefined) {
        continue;
      }
      if (k.includes('.')) {
        const segments = k.split('.').filter(Boolean);
        if (
          segments.length === 0 ||
          segments.some(seg => UNSAFE_PATH_SEGMENTS.has(seg))
        ) {
          continue;
        }
        let cursor: Record<string, unknown> = clean;
        for (let i = 0; i < segments.length - 1; i++) {
          const seg = segments[i];
          const existing = cursor[seg];
          if (
            !existing ||
            typeof existing !== 'object' ||
            Array.isArray(existing)
          ) {
            cursor[seg] = {};
          }
          cursor = cursor[seg] as Record<string, unknown>;
        }
        cursor[segments[segments.length - 1]] = stripped;
        continue;
      }
      if (
        stripped &&
        typeof stripped === 'object' &&
        !Array.isArray(stripped) &&
        clean[k] &&
        typeof clean[k] === 'object' &&
        !Array.isArray(clean[k])
      ) {
        clean[k] = {
          ...(clean[k] as Record<string, unknown>),
          ...(stripped as Record<string, unknown>),
        };
      } else {
        clean[k] = stripped;
      }
    }
    return clean;
  }
  return value;
}

function logSchemaValidationFailure(
  context: SchemaValidationContext,
  issues: ValidationIssueDetail[],
): string {
  const issueSummary = issues
    .map(issue => `${issue.path}: ${issue.message}`)
    .join('; ');
  const message = `[SchemaValidation] ${context.entity}${
    context.operation ? ` (${context.operation})` : ''
  }${
    context.documentPath ? ` at ${context.documentPath}` : ''
  } failed validation (${issues.length} issue${
    issues.length === 1 ? '' : 's'
  }): ${issueSummary}`;

  const details: Record<string, unknown> = {
    entity: context.entity,
    ...(context.operation ? {operation: context.operation} : {}),
    ...(context.documentPath ? {documentPath: context.documentPath} : {}),
    issues,
  };

  if (context.logger) {
    context.logger(message, details);
  } else if (process.env.NODE_ENV !== 'production') {
    console.warn(message, details);
  }

  return message;
}

/**
 * Strictly validates incoming API data against a Zod schema before persistence,
 * logging clear field-level diagnostic details for development debugging and
 * throwing a `SchemaValidationError` when validation fails.
 */
export function validateIncomingApiData<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: Omit<SchemaValidationContext, 'strict'>,
): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return parsed.data;
  }

  const issues = formatZodIssues(parsed.error);
  const message = logSchemaValidationFailure(
    {...context, strict: true},
    issues,
  );
  throw new SchemaValidationError(message, {
    entity: context.entity,
    documentPath: context.documentPath,
    operation: context.operation,
    issues,
  });
}

/**
 * Strictly validates a Firestore document read payload against a Stored Document Zod schema,
 * logging clear field-level diagnostic details for development debugging and
 * throwing a `SchemaValidationError` when validation fails.
 */
export function validateFirestoreReadPayload<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: Omit<SchemaValidationContext, 'strict'>,
): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return parsed.data;
  }

  const resolvedOp = context.operation ?? 'read';
  const issues = formatZodIssues(parsed.error);
  const message = logSchemaValidationFailure(
    {...context, operation: resolvedOp, strict: true},
    issues,
  );
  throw new SchemaValidationError(message, {
    entity: context.entity,
    documentPath: context.documentPath,
    operation: resolvedOp,
    issues,
  });
}

/**
 * Validates a Firestore write payload against a Stored Document Zod schema prior to persistence.
 * Automatically strips `FieldValue` sentinels (such as `FieldValue.serverTimestamp()` or `FieldValue.delete()`)
 * on a validation clone so domain fields are checked accurately while preserving sentinels on the returned payload.
 * Defaults to `strict: true` (throws `SchemaValidationError` on schema violations unless `strict: false` is passed).
 */
export function validateFirestoreWritePayload<T extends object>(
  schema: z.ZodType<unknown>,
  payload: T,
  context: SchemaValidationContext,
): SchemaValidationResult<T> {
  const validationCandidate = stripFirestoreSentinels(payload);
  const parsed = schema.safeParse(validationCandidate);
  if (parsed.success) {
    return {
      success: true,
      data: payload,
      issues: [],
    };
  }

  const isStrict = context.strict ?? true;
  const issues = formatZodIssues(parsed.error);
  const message = logSchemaValidationFailure(
    {...context, strict: isStrict},
    issues,
  );

  if (isStrict) {
    throw new SchemaValidationError(message, {
      entity: context.entity,
      documentPath: context.documentPath,
      operation: context.operation,
      issues,
    });
  }

  return {
    success: false,
    data: payload,
    issues,
  };
}
