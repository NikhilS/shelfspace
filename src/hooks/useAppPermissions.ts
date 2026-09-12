import {useQuery} from '@tanstack/react-query';
import {doc, getDoc} from 'firebase/firestore';
import {db} from '../firebase';
import {useAuth} from '../stores/authStore';
import {SUPERADMIN_EMAIL} from '../constants/auth';

export function useAppPermissions() {
  const {user, isAuthReady} = useAuth();
  const email = user?.email?.toLowerCase();

  const {data, isLoading} = useQuery({
    queryKey: ['appPermissions', email],
    queryFn: async () => {
      if (!email) return {isAppAllowed: false, isAdmin: false};

      if (email === SUPERADMIN_EMAIL) {
        return {isAppAllowed: true, isAdmin: true};
      }

      try {
        const allowRef = doc(db, 'appSettings/allowlist/users', email);
        const allowSnap = await getDoc(allowRef);

        if (allowSnap.exists()) {
          const res = {
            isAppAllowed: true,
            isAdmin: allowSnap.data()?.role === 'admin',
          };
          try {
            localStorage.setItem(`app_perm_${email}`, JSON.stringify(res));
          } catch {
            // ignore
          }
          return res;
        } else {
          const res = {
            isAppAllowed: false,
            isAdmin: false,
          };
          try {
            localStorage.setItem(`app_perm_${email}`, JSON.stringify(res));
          } catch {
            // ignore
          }
          return res;
        }
      } catch (error) {
        console.error('Error fetching admin allowlist', error);
        return {isAppAllowed: false, isAdmin: false};
      }
    },
    initialData: () => {
      if (!email) return undefined;
      if (email === SUPERADMIN_EMAIL) {
        return {isAppAllowed: true, isAdmin: true};
      }
      try {
        const cached = localStorage.getItem(`app_perm_${email}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch {
        // ignore
      }
      return undefined;
    },
    enabled: isAuthReady && !!email,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  return {
    isAppAllowed: data?.isAppAllowed ?? false,
    isAdmin: data?.isAdmin ?? false,
    isLoadingPermissions: isLoading,
  };
}
