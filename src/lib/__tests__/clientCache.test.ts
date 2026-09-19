import {describe, it, expect, vi} from 'vitest';
import {queryClient} from '../queryClient';
import {createOptimisticMutation} from '../optimisticMutation';

describe('queryClient & optimisticMutation - Phase 3', () => {
  it('instantiates queryClient with offlineFirst networkMode and default cache timeouts', () => {
    expect(queryClient).toBeDefined();
    const defaultQueries = queryClient.getDefaultOptions().queries;
    expect(defaultQueries?.networkMode).toBe('offlineFirst');
    expect(defaultQueries?.staleTime).toBe(1000 * 60 * 5); // 5 minutes
    expect(defaultQueries?.gcTime).toBe(1000 * 60 * 60 * 24 * 7); // 7 days
  });

  it('performs optimistic cache update, rollback on error, and cache invalidation on settled', async () => {
    const testKey = ['testQuery', 'sample-id'];
    queryClient.setQueryData(testKey, {count: 10, items: ['item1']});

    const mutationHandlers = createOptimisticMutation<
      {count: number; items: string[]},
      {newItem: string}
    >({
      queryKey: testKey,
      updateCache: (old, variables) => ({
        count: (old?.count || 0) + 1,
        items: [...(old?.items || []), variables.newItem],
      }),
    });

    // 1. Trigger onMutate
    const context = await mutationHandlers.onMutate({newItem: 'item2'});
    expect(context.previousData).toEqual({count: 10, items: ['item1']});

    // Cache should reflect optimistic value immediately
    const optimisticData = queryClient.getQueryData<{
      count: number;
      items: string[];
    }>(testKey);
    expect(optimisticData).toEqual({count: 11, items: ['item1', 'item2']});

    // 2. Trigger onError (rollback)
    mutationHandlers.onError(
      new Error('Network error'),
      {newItem: 'item2'},
      context,
    );
    const rolledBackData = queryClient.getQueryData<{
      count: number;
      items: string[];
    }>(testKey);
    expect(rolledBackData).toEqual({count: 10, items: ['item1']});

    // 3. Trigger onSettled
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mutationHandlers.onSettled();
    expect(invalidateSpy).toHaveBeenCalledWith({queryKey: testKey});
  });
});
