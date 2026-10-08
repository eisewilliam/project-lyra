import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Two routes do not justify a router dependency: history API plus a context.
const RouterContext = createContext({ path: '/', navigate: () => {} });

function scrollToHash(hash) {
  if (!hash) {
    window.scrollTo(0, 0);
    return;
  }
  // Two frames: the target may only exist once the new route has rendered.
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()));
}

export function RouterProvider({ children }) {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    if (window.location.hash) scrollToHash(window.location.hash);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigate = useCallback(to => {
    const url = new URL(to, window.location.href);
    const samePage = url.pathname === window.location.pathname;
    window.history.pushState({}, '', url.pathname + url.search + url.hash);
    setPath(url.pathname);
    if (samePage && url.hash) scrollToHash(url.hash);
    else if (!samePage) {
      scrollToHash(url.hash);
      // Move focus to the new page's heading so assistive technology announces it.
      requestAnimationFrame(() => document.querySelector('main h1')?.focus({ preventScroll: true }));
    }
  }, []);
  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
}

export const useRouter = () => useContext(RouterContext);

export function Link({ to, onClick, children, ...props }) {
  const { navigate } = useRouter();
  return <a href={to} {...props} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }}>{children}</a>;
}

export function ExternalLink({ href, children, ...props }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
}
