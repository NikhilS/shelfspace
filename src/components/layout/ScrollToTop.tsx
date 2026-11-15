import {useLayoutEffect, useRef} from 'react';
import {useLocation} from 'react-router-dom';
import {useCoverTransitionStore} from '../../stores/coverTransitionStore';

const BOOK_ROUTE_REGEX = /^(\/library\/[^/]+\/book)\/[^/]+/;

export function getRouteBoundaryKey(pathname: string): string {
  const bookDetailMatch = pathname.match(BOOK_ROUTE_REGEX);
  if (bookDetailMatch) {
    return bookDetailMatch[1];
  }
  return pathname;
}

export function ScrollToTop() {
  const {pathname, search} = useLocation();
  const fullRouteKey = `${pathname}${search}`;
  const prevRouteKeyRef = useRef<string>(getRouteBoundaryKey(pathname));
  const prevPathnameRef = useRef<string>(pathname);
  const prevFullRouteKeyRef = useRef<string>(fullRouteKey);

  useLayoutEffect(() => {
    const nextRouteKey = getRouteBoundaryKey(pathname);
    const prevRouteKey = prevRouteKeyRef.current;
    const prevPathname = prevPathnameRef.current;
    const prevFullRouteKey = prevFullRouteKeyRef.current;

    prevRouteKeyRef.current = nextRouteKey;
    prevPathnameRef.current = pathname;
    prevFullRouteKeyRef.current = fullRouteKey;

    const prevWasBookRoute = BOOK_ROUTE_REGEX.test(prevPathname);
    const nextIsBookRoute = BOOK_ROUTE_REGEX.test(pathname);

    // Skip window scroll reset when swiping between books in the same library
    if (prevRouteKey === nextRouteKey && nextIsBookRoute) {
      return undefined;
    }

    const store = useCoverTransitionStore.getState();

    // Forward transition to Book Details: preserve originating shelf scroll if not yet saved
    if (!prevWasBookRoute && nextIsBookRoute) {
      if (store.peekRouteScrollOffset(prevFullRouteKey) === undefined) {
        store.saveRouteScrollOffset(prevFullRouteKey, window.scrollY || 0);
      }
      window.scrollTo(0, 0);
      return undefined;
    }

    // Reverse return from Book Details back to a shelf route: restore saved scroll offset pre-paint
    if (prevWasBookRoute && !nextIsBookRoute) {
      if (store.activeTransition) {
        store.beginReturnToShelf();
      }
      const savedScrollY = store.consumeRouteScrollOffset(fullRouteKey);
      window.scrollTo(0, savedScrollY ?? 0);

      // Safety cleanup in case the target shelf card is filtered out or reduced motion is active
      const timer = window.setTimeout(() => {
        const current = useCoverTransitionStore.getState().activeTransition;
        if (current?.phase === 'to-shelf') {
          useCoverTransitionStore.getState().completeCoverTransition();
        }
      }, 480);
      return () => window.clearTimeout(timer);
    }

    // Standard route change between non-book routes
    if (store.activeTransition) {
      store.completeCoverTransition();
    }
    window.scrollTo(0, 0);
    return undefined;
  }, [pathname, search, fullRouteKey]);

  return null;
}
