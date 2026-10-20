import {describe, it, expect} from 'vitest';
import {queryClient} from './queryClient';

describe('queryClient configuration', () => {
  it('instantiates queryClient with offlineFirst networkMode and default cache timeouts', () => {
    expect(queryClient).toBeDefined();
    const defaultQueries = queryClient.getDefaultOptions().queries;
    expect(defaultQueries?.networkMode).toBe('offlineFirst');
    expect(defaultQueries?.staleTime).toBe(1000 * 60 * 5); // 5 minutes
    expect(defaultQueries?.gcTime).toBe(1000 * 60 * 60 * 24 * 7); // 7 days
  });
});
