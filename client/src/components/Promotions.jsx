import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Opens a promotion's link and counts the click (keepalive so it survives the navigation).
function useOpenPromotion() {
  const navigate = useNavigate();
  return (p, preview) => {
    if (preview || !p.href) return;
    fetch(`/api/promotions/${p.id}/click`, { method: 'POST', keepalive: true }).catch(() => {});
    if (p.link_type === 'url') window.open(p.href, '_blank', 'noopener');
    else navigate(p.href);
  };
}

// One slide / tile. Also used by the admin editor as a live preview (preview = true: no navigation).
export function PromoCard({ p, variant = 'slide', preview = false, onOpen }) {
  const clickable = Boolean(p.href || p.link_type !== 'none') && !preview;
  const textOnly = !p.image_url;
  const imageOnly = p.image_url && !p.title && !p.subtitle;
  return (
    <div
      className={`promo promo-${variant} ${textOnly ? 'promo-text-only' : ''} ${imageOnly ? 'promo-image-only' : ''} ${clickable ? 'promo-clickable' : ''}`}
      style={{ '--promo-bg': p.bg_color || '#4f46e5', '--promo-fg': p.text_color || '#ffffff' }}
      onClick={() => onOpen?.(p)}
      role={clickable ? 'link' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => e.key === 'Enter' && onOpen?.(p)}
    >
      {!imageOnly && (
        <div className="promo-text">
          {p.title && <h3>{p.title}</h3>}
          {p.subtitle && <p>{p.subtitle}</p>}
          {p.cta_text && p.link_type !== 'none' && <span className="promo-cta">{p.cta_text} →</span>}
        </div>
      )}
      {p.image_url && (
        <div className="promo-img">
          <img src={p.image_url} alt={p.title || ''} loading="lazy" />
        </div>
      )}
    </div>
  );
}

// Big auto-sliding banner + a row of smaller tiles, on the customer home page.
export default function Promotions() {
  const [data, setData] = useState(null);
  const open = useOpenPromotion();

  useEffect(() => {
    api('/promotions')
      .then((d) => {
        setData(d);
        const ids = [...d.carousel, ...d.tiles].map((p) => p.id);
        // keepalive: the view still counts if the customer taps away straight after the page opens
        if (ids.length) fetch('/api/promotions/seen', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).catch(() => {});
      })
      .catch(() => setData({ carousel: [], tiles: [] }));
  }, []);

  if (!data || (!data.carousel.length && !data.tiles.length)) return null;
  return (
    <section className="promotions" aria-label="Offers">
      {data.carousel.length > 0 && <Carousel slides={data.carousel} onOpen={open} />}
      {data.tiles.length > 0 && (
        <div className="promo-tiles">
          {data.tiles.map((p) => <PromoCard key={p.id} p={p} variant="tile" onOpen={open} />)}
        </div>
      )}
    </section>
  );
}

function Carousel({ slides, onOpen }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef(null);
  const count = slides.length;
  const go = (i) => setIndex((i + count) % count);

  useEffect(() => {
    if (paused || count < 2) return undefined;
    const t = setTimeout(() => go(index + 1), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, count]);

  return (
    <div
      className="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; setPaused(true); }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touchX.current ?? 0);
        if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
        setPaused(false);
      }}
      aria-roledescription="carousel"
    >
      <div className="carousel-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {slides.map((p, i) => (
          <div className="carousel-slide" key={p.id} aria-hidden={i !== index}>
            <PromoCard p={p} onOpen={onOpen} />
          </div>
        ))}
      </div>
      {count > 1 && (
        <>
          <button className="carousel-arrow prev" onClick={() => go(index - 1)} aria-label="Previous offer">‹</button>
          <button className="carousel-arrow next" onClick={() => go(index + 1)} aria-label="Next offer">›</button>
          <div className="carousel-dots">
            {slides.map((p, i) => (
              <button key={p.id} className={i === index ? 'active' : ''} onClick={() => go(i)} aria-label={`Offer ${i + 1}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
