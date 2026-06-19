import {createTRPCReact} from '@trpc/react-query';
import {createTRPCClient, httpBatchLink} from '@trpc/client';
import type {AppRouter} from '../server/trpc/routers/_app';
import {auth} from '../firebase';

export const trpc = createTRPCReact<AppRouter>();

export const trpcVanilla = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/trpc',
      async headers() {
        const token = await auth.currentUser?.getIdToken();
        return {
          Authorization: token ? `Bearer ${token}` : '',
        };
      },
    }),
  ],
});
