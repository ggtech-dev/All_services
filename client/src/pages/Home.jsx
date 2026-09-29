import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import SmartImage from '../components/SmartImage.jsx';
import Promotions from '../components/Promotions.jsx';

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api('/categories'), api('/settings')])
      .then(([cats, s]) => {
        setCategories(cats);
        setSettings(s);
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

      <Promotions />

      {error && <div className="alert">{error}</div>}
      {loading ? (
        <div className="center-block"><div className="spinner" /></div>
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
