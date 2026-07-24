import {useQuery} from '@tanstack/react-query';
import {
  doc,
  getDoc,
  collection,
  getDocs,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {db} from '../firebase';
import {useAuth} from '../stores/authStore';

export function useAppPermissions() {
  const {user, isAuthReady} = useAuth();
  const email = user?.email?.toLowerCase();

  const {data, isLoading} = useQuery({
    queryKey: ['appPermissions', email],
    queryFn: async () => {
      if (!email) return {isAppAllowed: false, isAdmin: false};

      if (email === 'nikhil.singhal@gmail.com') {
        return {isAppAllowed: true, isAdmin: true};
      }

      try {
        const allowRef = doc(db, 'appSettings/allowlist/users', email);
        const allowSnap = await getDoc(allowRef);

        if (allowSnap.exists()) {
          return {
            isAppAllowed: true,
            isAdmin: allowSnap.data()?.role === 'admin',
          };
        } else {
          // Bootstrapper: If allowlist is totally empty, make this user the first admin.
          const allUsersSnap = await getDocs(
            collection(db, 'appSettings/allowlist/users'),
          );
          if (allUsersSnap.empty) {
            await setDoc(allowRef, {
              email: email,
              role: 'admin',
              addedAt: serverTimestamp(),
            });
            return {
              isAppAllowed: true,
              isAdmin: true,
            };
          } else {
            return {
              isAppAllowed: false,
              isAdmin: false,
            };
          }
        }
      } catch (error) {
        console.error('Error fetching admin allowlist', error);
        return {isAppAllowed: false, isAdmin: false};
      }
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
