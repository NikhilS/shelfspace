import type {SizingOptions, TelemetryProfilingLevel} from './types';

let fallbackProfilingLevelGetter: () => TelemetryProfilingLevel = () => 'basic';

export function registerProfilingLevelGetter(
  getter: () => TelemetryProfilingLevel,
): void {
  fallbackProfilingLevelGetter = getter;
}

/**
 * Calculates UTF-8 string byte size quickly without allocating Blob instances.
 */
export function estimateStringBytes(str: string): number {
  let bytes = 0;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const codePoint = str.charCodeAt(i);
    if (codePoint < 0x80) {
      bytes += 1;
    } else if (codePoint < 0x800) {
      bytes += 2;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function estimateSingleObjectBytes(obj: unknown): number {
  if (obj === null || obj === undefined) {
    return 0;
  }
  if (typeof obj === 'string') {
    return estimateStringBytes(obj);
  }
  if (typeof obj === 'number') {
    return 8;
  }
  if (typeof obj === 'boolean') {
    return 4;
  }
  try {
    const json = JSON.stringify(obj);
    return estimateStringBytes(json);
  } catch {
    return 64;
  }
}

/**
 * Fast, multi-tiered payload byte estimation.
 * - 'off': Returns 0 immediately with zero memory allocations.
 * - 'basic': Statistical O(1) sampling for arrays and fast string byte calculation (<0.05ms).
 * - 'high_fidelity': Full deep serialization and exact measurement.
 */
export function calculatePayloadBytes(
  data: unknown,
  options?: SizingOptions,
): number {
  const level = options?.level ?? fallbackProfilingLevelGetter();
  if (level === 'off' || data === undefined || data === null) {
    return 0;
  }

  if (typeof data === 'string') {
    return estimateStringBytes(data);
  }
  if (typeof data === 'number') {
    return 8;
  }
  if (typeof data === 'boolean') {
    return 4;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return 2;
    }
    if (level === 'basic') {
      const sampleCount = Math.min(data.length, options?.maxSamples ?? 5);
      let sampleBytes = 0;
      for (let i = 0; i < sampleCount; i++) {
        sampleBytes += estimateSingleObjectBytes(data[i]);
      }
      const avgBytesPerItem = sampleBytes / sampleCount;
      return Math.round(
        avgBytesPerItem * data.length + Math.max(0, data.length - 1) + 2,
      );
    }
  }

  if (level === 'basic') {
    return estimateSingleObjectBytes(data);
  }

  try {
    const json = JSON.stringify(data);
    return estimateStringBytes(json);
  } catch {
    return 0;
  }
}
