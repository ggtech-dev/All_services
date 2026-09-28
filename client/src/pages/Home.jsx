import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import SmartImage from '../components/SmartImage.jsx';

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/categories').then(setCategories).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <section className="banner">
        <div>
          <h1>What do you need today?</h1>
          <p>Pick a category to see its services. Trusted local partners, quick turnaround.</p>
        </div>
      </section>

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
