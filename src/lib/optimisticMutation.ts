import {queryClient} from './queryClient';

export function createOptimisticMutation<TData, TVariables>({
  queryKey,
  updateCache,
}: {
  queryKey: unknown[];
  updateCache: (oldData: TData | undefined, variables: TVariables) => TData;
}) {
  return {
    onMutate: async (variables: TVariables) => {
      // 1. Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({queryKey});

      // 2. Snapshot the previous cache value for rollback
      const previousData = queryClient.getQueryData<TData>(queryKey);

      // 3. Optimistically update TanStack Query cache (and trigger IndexedDB write)
      queryClient.setQueryData<TData>(queryKey, old =>
        updateCache(old, variables),
      );

      return {previousData};
    },
    onError: (
      _err: unknown,
      _newVal: TVariables,
      context?: {previousData?: TData},
    ) => {
      // 4. Roll back on error
      if (context?.previousData) {
        queryClient.setQueryData<TData>(queryKey, context.previousData);
      }
    },
    onSettled: () => {
      // 5. Invalidate to refetch authoritative state from server
      void queryClient.invalidateQueries({queryKey});
    },
  };
}
