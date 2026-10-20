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
  if (trimmed === '') return true;
  if (hasControlCharacters(trimmed)) return false;

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
