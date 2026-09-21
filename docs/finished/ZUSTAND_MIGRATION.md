# Migrating to Zustand

## Overview

Currently, our application relies on React Contexts (`AuthContext`, `DebugContext`, `LibraryAccessContext`) and localized `useState` / prop-drilling to manage global application state. While React Context works well for dependency injection, it has performance drawbacks: whenever a Context value changes, *every* component that consumes that Context is forced to re-render, even if the component only cares about a small part of the updated data.

Migrating to **Zustand** would replace our heavy Context providers with a lightweight, fast, and unopinionated global state manager. It solves the performance issues of Context with precise state selection and removes the need for deeply nested Provider trees in our application root.

## What it Means for Our Codebase

### 1. Removing the Provider Hell
We wrap our application in multiple layers of Providers to make global state accessible.
*   **Before:**
    ```tsx
    <AuthProvider>
      <DebugProvider>
        <LibraryAccessProvider>
          <AppRouter />
        </LibraryAccessProvider>
      </DebugProvider>
    </AuthProvider>
    ```
*   **After:** Zustand doesn't require Context Providers. Stores are just hooks. We can delete these wrapper components completely, flattening our `App.tsx` and making the component tree much easier to read.

### 2. Precise Re-rendering
If `AuthContext` updates (e.g., refreshing a token), any component calling `useAuth()` re-renders. Zustand allows components to selectively subscribe to only the exact slice of state they need.
*   **Before:** `const { user, isSigningIn } = useAuth();` (re-renders if anything in the Auth state changes).
*   **After:** `const user = useAuthStore(state => state.user);` (only re-renders if `user` specifically changes).

### 3. State Access Outside of React
Currently, if a utility function like `bookApi.ts` needs the current user's ID or the active `libraryId` to make a network request, we have to pass it down from a React component. 
Zustand stores can be accessed outside of the React lifecycle.
```typescript
import { useLibraryStore } from '../stores/libraryStore';

export async function fetchBooks() {
  // Grab standard state straight from the store anywhere in a non-UI file
  const libraryId = useLibraryStore.getState().activeLibraryId;
  return await fetch(`/api/libraries/${libraryId}/books`);
}
```

## How It Would Work (Migration Plan)

### Phase 1: Setup & Initialization
1.  **Install:** `npm install zustand`
2.  Identify domains of state. For our app, we likely need:
    *   `useAuthStore` (Replaces `AuthContext`)
    *   `useLibraryStore` (Replaces `LibraryAccessContext`)
    *   `useAppStore` or `useUIStore` (Replaces `DebugContext` / local global UI flags)

### Phase 2: Migrating Contexts to Stores (e.g., Auth)
We will convert the complex logic residing inside `AuthContext.tsx` into a Zustand hook.

*   **Before (Context):**
    ```tsx
    const [user, setUser] = useState(null);
    useEffect(() => {
      return onAuthStateChanged(auth, u => setUser(u));
    }, []);
    return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>
    ```

*   **After (Zustand):**
    ```tsx
    import { create } from 'zustand';

    interface AuthState {
      user: User | null;
      setUser: (user: User | null) => void;
      initialize: () => void;
    }

    export const useAuthStore = create<AuthState>((set) => ({
      user: null,
      setUser: (user) => set({ user }),
      initialize: () => onAuthStateChanged(auth, (u) => set({ user: u }))
    }));
    ```
    Then, we just call `useAuthStore.getState().initialize()` once centrally (e.g., in `App.tsx`).

### Phase 3: Migrating Ephemeral Global UI State
For UI states that need to be shared deeply (e.g., "is the bulk edit drawer open?" or "what are the selected book IDs?"), we currently likely prop-drill these down or shove them in contexts. Creating a lightweight `useUIStore` makes this trivial and eliminates massive prop chains.

### Phase 4: Integration with TanStack Query (Optional but Recommended)
Zustand and TanStack Query are the perfect pairing.
*   **TanStack Query** handles **Server State** (data fetching, caching, db sync).
*   **Zustand** handles **Client State** (currently selected UI tab, auth sessions, dark mode, modal visibility).
By moving to both, our app becomes perfectly separated between backend data flows and frontend UI state.

## Key Takeaways
By migrating to Zustand, we would:
1.  **Eliminate React Context boilerplate and Provider nesting.**
2.  **Optimize rendering speeds** with granular hook selectors.
3.  **Allow seamless state access** in our pure utility/API files outside of React hooks.
