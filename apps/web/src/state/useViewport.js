import React from 'react';

// Tracks viewport width with sensible breakpoints. Use the `isMobile` flag
// to branch on layout (drawer vs sidebar, modal vs overlay, etc.). For
// purely visual style differences, prefer CSS @media — see index.html / a
// future global stylesheet — to avoid re-renders.
//
// Breakpoints follow Tailwind's defaults: sm=640, md=768, lg=1024.

const QUERY = '(max-width: 767px)';

export function useIsMobile() {
  const get = () => typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia(QUERY).matches;
  const [isMobile, setIsMobile] = React.useState(get);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
