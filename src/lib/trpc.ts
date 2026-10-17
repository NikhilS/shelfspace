import {createTRPCReact} from '@trpc/react-query';
import {createTRPCClient, httpBatchLink} from '@trpc/client';
import type {AppRouter} from '../server/trpc/routers/_app';
import {auth} from '../firebase';
import {useAuthStore} from '../stores/authStore';

export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  try {
    if (auth?.currentUser) {
      const token = await auth.currentUser.getIdToken();
      if (token) {
        return {Authorization: `Bearer ${token}`};
      }
    }
    const storeUser = useAuthStore?.getState?.()?.user;
    if (storeUser && typeof storeUser.getIdToken === 'function') {
      const token = await storeUser.getIdToken();
      if (token) {
        return {Authorization: `Bearer ${token}`};
      }
    }
    return {};
  } catch (err) {
    console.warn('[tRPC] Failed to retrieve Firebase ID token:', err);
    return {};
  }
};

const customFetch = async (
  url: URL | RequestInfo,
  options?: RequestInit,
): Promise<Response> => {
  const nativeFn =
    typeof window !== 'undefined'
      ? (window as unknown as {__nativeFetch?: typeof fetch}).__nativeFetch
      : undefined;
  const start = Date.now();
  const urlStr =
    typeof url === 'string'
      ? url
      : url instanceof URL
        ? url.toString()
        : url.url;
  try {
    const response = await (nativeFn || fetch)(url, options);
    const durationMs = Date.now() - start;
    if (!response.ok) {
      console.warn(
        `[tRPC HTTP ${response.status}] ${urlStr} (${durationMs}ms)`,
      );
    }
    return response;
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(
      `[tRPC Network Error] ${urlStr} failed after ${durationMs}ms:`,
      err,
    );
    throw err;
  }
};

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/trpc',
      headers: getAuthHeaders,
      fetch: customFetch,
    }),
  ],
});

export const trpcVanilla = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/trpc',
      headers: getAuthHeaders,
      fetch: customFetch,
    }),
  ],
});
