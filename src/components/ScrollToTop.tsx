import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';

export default function ScrollToTop() {
  const {pathname} = useLocation();

  useEffect(() => {
    // Logic: Scroll to top on every route change
    // If the next page has its own scroll restoration logic, it will override this after its own layout is ready.
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
