import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatEta } from '../api.js';
import SmartImage from '../components/SmartImage.jsx';

const rupees = (v) => `₹${Number(v).toLocaleString('en-IN')}`;

// Customer page listing the products inside one service (e.g. Milk Delivery).
export default function ServiceShop() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api(`/services/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  const products = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.products || []).filter((p) => `${p.name} ${p.brand || ''}`.toLowerCase().includes(q));
  }, [data, search]);

  if (error) return <div className="alert">{error} — <Link to="/">back home</Link></div>;
  if (!data) return <div className="center-block"><div className="spinner" /></div>;

  const { service } = data;
  return (
    <>
      <Link to={`/category/${service.category_slug}`} className="back-link">← {service.category_name}</Link>
      <section className="shop-header" style={{ '--accent': service.category_color }}>
        <div className="shop-header-img">
          <SmartImage src={service.image_url} alt={service.name} fallbackIcon={service.category_icon} color={service.category_color} />
        </div>
        <div className="shop-header-body">
          <h1>{service.name}</h1>
          <p>{service.description || `${data.products.length} items · delivered in about ${formatEta(service.eta_minutes)}`}</p>
        </div>
        <input className="search" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </section>

      <div className="product-grid" style={{ '--accent': service.category_color }}>
        {products.map((p) => {
          const off = p.mrp && Number(p.mrp) > Number(p.price) ? Math.round((1 - p.price / p.mrp) * 100) : 0;
          return (
            <article key={p.id} className={`product-card ${p.in_stock ? '' : 'sold-out'}`}>
              <div className="product-img">
                <SmartImage src={p.image_url} alt={p.name} credit={p.image_credit} fallbackIcon={p.icon || service.category_icon} color={service.category_color} />
                {off > 0 && <span className="off-badge">{off}% OFF</span>}
                {!p.in_stock && <span className="stock-badge">Out of stock</span>}
              </div>
              <div className="product-body">
                {p.brand && <span className="product-brand">{p.brand}</span>}
                <h3>{p.name}</h3>
                <span className="product-unit">{p.unit}</span>
                <div className="product-foot">
                  <div>
                    <b className="product-price">{rupees(p.price)}</b>
                    {off > 0 && <s className="product-mrp">{rupees(p.mrp)}</s>}
                  </div>
                  <button
                    className="btn btn-sm add-btn"
                    style={{ '--accent': service.category_color }}
                    disabled={!p.in_stock}
                    onClick={() => alert('Cart & checkout come in the next step!')}
                  >
                    {p.in_stock ? 'ADD' : 'Sold out'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {!products.length && <p className="muted">No items match “{search}”.</p>}
      </div>
    </>
  );
}
