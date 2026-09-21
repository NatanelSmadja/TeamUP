import {useLayoutEffect, useRef} from 'react';
import gsap from 'gsap';

export default function RouteMotion({routeKey, children}: {routeKey: string; children: React.ReactNode}) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!root.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = Array.from(root.current.children);
    const animation = gsap.fromTo(items,
      {autoAlpha: 0, y: 14},
      {autoAlpha: 1, y: 0, duration: .48, stagger: .045, ease: 'power3.out', clearProps: 'transform,opacity,visibility'},
    );
    return () => {
      animation.kill();
    };
  }, [routeKey]);

  return <div ref={root} className="route-motion">{children}</div>;
}
