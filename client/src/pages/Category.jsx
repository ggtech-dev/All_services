import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import SmartImage from '../components/SmartImage.jsx';

const formatEta = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} hr` : `${Math.round(m / 1440)} day`);
const formatPrice = (p, unit) => (Number(p) > 0 ? `₹${Number(p).toLocaleString('en-IN')} ${unit}` : unit);

export default function Category() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api(`/categories/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  const services = useMemo(
    () => (data?.services || []).filter((s) => s.name.toLowerCase().includes(search.toLowerCase())),
    [data, search]
  );

  if (error) return <div className="alert">{error} — <Link to="/">back home</Link></div>;
  if (!data) return <div className="center-block"><div className="spinner" /></div>;

  const { category } = data;
  return (
    <>
      <Link to="/" className="back-link">← All categories</Link>
      <section className="category-header" style={{ '--accent': category.color }}>
        <span className="category-header-icon">{category.icon}</span>
        <div>
          <h1>{category.name}</h1>
          <p>{category.description}</p>
        </div>
        <input className="search" placeholder="Search services…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </section>

      <div className="service-grid">
        {services.map((s) => (
          <article key={s.id} className="service-card">
            <div className="service-img">
              <SmartImage src={s.image_url} alt={s.name} credit={s.image_credit} fallbackIcon={category.icon} color={category.color} />
              {s.requires_license && <span className="tag">Licensed partner</span>}
            </div>
            <div className="service-body">
              <h3>{s.name}</h3>
              <div className="service-meta">
                <span className="price">{formatPrice(s.base_price, s.price_unit)}</span>
                <span className="eta">⏱ {formatEta(s.eta_minutes)}</span>
              </div>
              <button className="btn btn-primary btn-sm" style={{ '--accent': category.color }} onClick={() => alert('Booking comes in the next step!')}>
                Book now
              </button>
            </div>
          </article>
        ))}
        {!services.length && <p className="muted">No services match “{search}”.</p>}
      </div>
    </>
  );
}
