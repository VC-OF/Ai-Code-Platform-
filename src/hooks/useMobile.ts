import { useState, useEffect } from 'react';

const BREAKPOINTS = {
  sm:  640,
  md:  768,
  lg:  1024,
  xl:  1280,
} as const;

export function useIsMobile(breakpoint: keyof typeof BREAKPOINTS = 'md') {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < BREAKPOINTS[breakpoint]);
    };

    check();
    const mq = window.matchMedia(
      `(max-width: ${BREAKPOINTS[breakpoint] - 1}px)`
    );
    mq.addEventListener('change', check);
    return () => mq.removeEventListener('change', check);
  }, [breakpoint]);

  return isMobile;
}

export function useBreakpoint() {
  const [bp, setBp] = useState<'xs' | 'sm' | 'md' | 'lg' | 'xl'>('lg');

  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      if (w < 640)  setBp('xs');
      else if (w < 768)  setBp('sm');
      else if (w < 1024) setBp('md');
      else if (w < 1280) setBp('lg');
      else               setBp('xl');
    };

    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return bp;
}

export function useOrientation() {
  const [landscape, setLandscape] = useState(false);

  useEffect(() => {
    const check = () => {
      setLandscape(window.innerWidth > window.innerHeight);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return landscape;
}
