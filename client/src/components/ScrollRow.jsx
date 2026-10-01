import { useCallback, useEffect, useRef, useState } from 'react';

// A row that scrolls sideways (filter chips…). Phones swipe; on laptops there are ‹ › buttons and the mouse wheel
// scrolls it. A button only shows when there is more to see on that side.
export default function ScrollRow({ children, className = '', style, label, activeKey }) {
  const row = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = row.current;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // mouse wheel (up/down) scrolls the row sideways while the pointer is over it
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      // only take the wheel while the row can still move that way; at either end the page scrolls normally
      const canMove = e.deltaY > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0;
      if (!canMove) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY, behavior: 'auto' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, [measure]);

  // keep the selected chip in view (only when the selection changes, so the page never jumps by itself)
  useEffect(() => {
    const el = row.current;
    const chip = el?.querySelector('.active');
    if (!chip) return;
    const left = chip.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + chip.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollTo({ left: left - 40, behavior: 'smooth' });
  }, [activeKey]);

  const go = (dir) => row.current.scrollBy({ left: dir * row.current.clientWidth * 0.7, behavior: 'smooth' });

  return (
    <div className={`scroll-row ${edges.left ? 'more-left' : ''} ${edges.right ? 'more-right' : ''} ${className}`} style={style}>
      {edges.left && <button type="button" className="scroll-btn scroll-left" onClick={() => go(-1)} aria-label="Scroll left"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg></button>}
      <div className="scroll-track" ref={row} onScroll={measure} role="group" aria-label={label}>
        {children}
      </div>
      {edges.right && <button type="button" className="scroll-btn scroll-right" onClick={() => go(1)} aria-label="Scroll right"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg></button>}
    </div>
  );
}
