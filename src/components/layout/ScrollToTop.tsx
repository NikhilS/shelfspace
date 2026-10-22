import {useEffect, useRef} from 'react';
import {useLocation} from 'react-router-dom';

const BOOK_ROUTE_REGEX = /^(\/library\/[^/]+\/book)\/[^/]+/;

export function getRouteBoundaryKey(pathname: string): string {
  const bookDetailMatch = pathname.match(BOOK_ROUTE_REGEX);
  if (bookDetailMatch) {
    return bookDetailMatch[1];
  }
  return pathname;
}

export function ScrollToTop() {
  const {pathname} = useLocation();
  const prevRouteKeyRef = useRef<string>(getRouteBoundaryKey(pathname));

  useEffect(() => {
    const nextRouteKey = getRouteBoundaryKey(pathname);
    const prevRouteKey = prevRouteKeyRef.current;
    prevRouteKeyRef.current = nextRouteKey;

    // Skip window scroll reset when swiping between books in the same library
    if (prevRouteKey === nextRouteKey && BOOK_ROUTE_REGEX.test(pathname)) {
      return;
    }

    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
