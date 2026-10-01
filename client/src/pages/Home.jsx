import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import SmartImage from '../components/SmartImage.jsx';
import Promotions from '../components/Promotions.jsx';
import { InstallBanner } from '../components/InstallApp.jsx';
import { windowLabel } from '../qty.js';
import Skeleton from '../components/Skeleton.jsx';

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [settings, setSettings] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api('/categories'), api('/settings'), api('/featured-services').catch(() => [])])
      .then(([cats, s, f]) => {
        setCategories(cats);
        setSettings(s);
        setFeatured(f);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {settings.announcement && <div className="announcement">{settings.announcement}</div>}
      <section className="banner">
        <div>
          <h1>{settings.banner_title || 'What do you need today?'}</h1>
          <p>{settings.banner_subtitle || 'Pick a category to see its services.'}</p>
        </div>
        <div className="banner-meta">
          {settings.service_city && <span>📍 {settings.service_city}</span>}
          {settings.support_phone && <a href={`tel:${settings.support_phone.replace(/\s/g, '')}`}>📞 {settings.support_phone}</a>}
        </div>
      </section>

      <InstallBanner />
      <Promotions />

      {featured.length > 0 && <DailyFresh services={featured} />}

      {error && <div className="alert">{error}</div>}
      {loading ? (
        <Skeleton variant="grid" />
      ) : (
        <div className="category-grid">
          {categories.map((c) => (
            <Link key={c.id} to={`/category/${c.slug}`} className="category-card" style={{ '--accent': c.color }}>
              <div className="category-img">
                <SmartImage src={c.image_url} alt={c.name} credit={c.image_credit} fallbackIcon={c.icon} color={c.color} />
                <span className="category-icon">{c.icon}</span>
              </div>
              <div className="category-body">
                <h3>{c.name}</h3>
                <p>{c.description}</p>
                <span className="category-count">{c.service_count} services →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

// The daily services (fresh vegetables, meat & fish, milk), highlighted above the categories.
function DailyFresh({ services }) {
  return (
    <section className="daily-fresh" aria-labelledby="daily-fresh-title">
      <div className="daily-fresh-head">
        <h2 id="daily-fresh-title">🌅 Daily fresh</h2>
        <span className="muted small">Every morning, from the market to your door</span>
      </div>
      <div className="daily-fresh-grid">
        {services.map((s) => (
          <Link key={s.id} to={s.product_count > 0 ? `/service/${s.slug}` : `/checkout?service=${s.slug}`} className="fresh-card" style={{ '--accent': s.category_color }}>
            <div className="fresh-img">
              <SmartImage src={s.image_url} alt={s.name} credit={s.image_credit} fallbackIcon={s.category_icon} color={s.category_color} />
            </div>
            <div className="fresh-body">
              <h3>{s.name}</h3>
              <div className="fresh-chips">
                {s.window_from != null && <span>🕕 {windowLabel(s.window_from, s.window_to)}</span>}
                {s.price_on_bill ? <span>🧾 Market price</span> : s.price_unit && <span>{s.price_unit}</span>}
              </div>
              <span className="fresh-cta">Order now →</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
