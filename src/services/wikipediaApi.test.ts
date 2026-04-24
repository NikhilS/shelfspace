import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAuthorBioFromWikipedia } from './wikipediaApi';

describe('wikipediaApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null if author name is empty or unknown', async () => {
    expect(await fetchAuthorBioFromWikipedia('')).toBeNull();
    expect(await fetchAuthorBioFromWikipedia('   ')).toBeNull();
    expect(await fetchAuthorBioFromWikipedia('unknown')).toBeNull();
    expect(await fetchAuthorBioFromWikipedia('Unknown')).toBeNull();
  });

  it('returns author bio on successful fetch', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '123': {
              extract: 'George Orwell was an English novelist.'
            }
          }
        }
      })
    });

    const result = await fetchAuthorBioFromWikipedia('George Orwell');
    expect(result).toBe('George Orwell was an English novelist.');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('George%20Orwell'));
  });

  it('returns null if fetch fails', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false
    });

    const result = await fetchAuthorBioFromWikipedia('Failed Author');
    expect(result).toBeNull();
  });

  it('returns null if page ID is -1', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '-1': {
              title: "Unknown Author 123"
            }
          }
        }
      })
    });

    const result = await fetchAuthorBioFromWikipedia('Unknown Author 123');
    expect(result).toBeNull();
  });

  it('returns null if network error happens', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network Error'));

    const result = await fetchAuthorBioFromWikipedia('Error Author');
    expect(result).toBeNull();
  });
});
