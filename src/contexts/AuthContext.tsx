import React, {createContext, useContext, useEffect, useState} from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  collection,
  getDocs,
} from 'firebase/firestore';
import {auth, db, handleFirestoreError, OperationType} from '../firebase';
import {AlertCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';

interface AuthContextType {
  user: User | null;
  isAuthReady: boolean;
  isAppAllowed: boolean;
  isAdmin: boolean;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({children}: {children: React.ReactNode}) {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAppAllowed, setIsAppAllowed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      setUser(currentUser);
      setAuthError(null);

      if (currentUser) {
        if (!currentUser.emailVerified) {
          await signOut(auth);
          setAuthError('Please verify your email to access this app.');
          setIsAuthReady(true);
          return;
        }

        try {
          // Check global allowlist
          if (currentUser.email) {
            const allowRef = doc(
              db,
              'appSettings/allowlist/users',
              currentUser.email,
            );
            const allowSnap = await getDoc(allowRef);

            if (allowSnap.exists()) {
              setIsAppAllowed(true);
              setIsAdmin(allowSnap.data()?.role === 'admin');
            } else {
              // Bootstrapper: If allowlist is totally empty, make this user the first admin.
              const allUsersSnap = await getDocs(
                // limit is unused here but we should just use empty check
                collection(db, 'appSettings/allowlist/users'),
              );
              if (allUsersSnap.empty) {
                await setDoc(allowRef, {
                  email: currentUser.email,
                  role: 'admin',
                  addedAt: serverTimestamp(),
                });
                setIsAppAllowed(true);
                setIsAdmin(true);
              } else {
                setIsAppAllowed(false);
                setIsAdmin(false);
              }
            }
          }

          // Ensure user document exists
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              createdAt: serverTimestamp(),
            });
          }
        } catch (error) {
          console.error('Error ensuring user document or allowlist:', error);
          handleFirestoreError(
            error,
            OperationType.GET,
            `users/${currentUser.uid}`,
          );
        }
      } else {
        setIsAppAllowed(false);
      }

      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  const signIn = async () => {
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'select_account',
    });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Error signing in with Google', error);
      throw error;
    }
  };

  const logOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out', error);
      throw error;
    }
  };

  if (isAuthReady && user && !isAppAllowed) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center text-on-surface">
        <div className="max-w-md w-full bg-surface-variant/30 border border-outline-variant/30 rounded-2xl p-8 space-y-6">
          <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-serif text-on-surface">Access Denied</h1>
          <p className="text-on-surface-variant leading-relaxed">
            It looks like {user.email} doesn't have access to this application
            yet. Please contact the administrator to be added to the allowlist.
          </p>
          <div className="pt-4">
            <Button onClick={logOut} variant="default" className="w-full">
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isAuthReady && authError) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center text-on-surface">
        <div className="max-w-md w-full bg-surface-variant/30 border border-outline-variant/30 rounded-2xl p-8 space-y-6">
          <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-serif text-on-surface">Access Denied</h1>
          <p className="text-on-surface-variant leading-relaxed">{authError}</p>
          <div className="pt-4">
            <Button onClick={logOut} variant="default" className="w-full">
              Go Back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{user, isAuthReady, isAppAllowed, isAdmin, signIn, logOut}}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
