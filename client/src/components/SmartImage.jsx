import { useState } from 'react';

// Shows the photo, or a colored tile with an emoji if the image can't load (offline, blocked, etc.).
export default function SmartImage({ src, alt, credit, fallbackIcon, color }) {
  const [failed, setFailed] = useState(!src);
  if (failed) {
    return (
      <div className="img-fallback" style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}>
        <span>{fallbackIcon}</span>
      </div>
    );
  }
  return (
    <>
      <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      {credit && <span className="img-credit" title={credit}>ⓘ</span>}
    </>
  );
}
