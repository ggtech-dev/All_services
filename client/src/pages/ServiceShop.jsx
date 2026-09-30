import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatEta } from '../api.js';
import SmartImage from '../components/SmartImage.jsx';
import { useCart } from '../cart.jsx';
import { qtyLabel, windowLabel } from '../qty.js';

const rupees = (v) => `₹${Number(v).toLocaleString('en-IN')}`;

// Customer page listing the products inside one service (e.g. Milk Delivery, Fresh Vegetables).
export default function ServiceShop() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const cart = useCart();

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
  const onBill = service.price_on_bill;
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
          {(service.window_from != null || onBill) && (
            <div className="shop-facts">
              {service.window_from != null && <span className="fact-chip">🕕 Delivery {windowLabel(service.window_from, service.window_to)}</span>}
              {onBill && <span className="fact-chip">🧾 Pay as per the shop bill</span>}
            </div>
          )}
        </div>
        <input className="search" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </section>

      {onBill && (
        <p className="market-note">
          Prices change every day at the market, so there are no fixed prices here. Choose what you need — your delivery partner
          buys it fresh, shares a <b>photo of the shop bill</b> in your order, and you pay exactly that.
        </p>
      )}

      <div className="product-grid" style={{ '--accent': service.category_color }}>
        {products.map((p) => {
          const off = !onBill && p.mrp && Number(p.mrp) > Number(p.price) ? Math.round((1 - p.price / p.mrp) * 100) : 0;
          const item = cart.itemOf(p.id);
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
                    {onBill ? (
                      <span className="market-price">Market price</span>
                    ) : (
                      <>
                        <b className="product-price">{rupees(p.price)}</b>
                        {off > 0 && <s className="product-mrp">{rupees(p.mrp)}</s>}
                      </>
                    )}
                  </div>
                  {item ? (
                    <div className={`stepper ${p.sell_by === 'kg' || p.sell_by === 'litre' ? 'stepper-wide' : ''}`}>
                      <button onClick={() => cart.less(p.id)} aria-label={`Less ${p.name}`}>−</button>
                      <span>{p.sell_by === 'pack' ? item.qty : qtyLabel(item.qty, p.sell_by)}</span>
                      <button onClick={() => cart.more(p.id)} aria-label={`More ${p.name}`}>+</button>
                    </div>
                  ) : (
                    <button className="btn btn-sm add-btn" disabled={!p.in_stock} onClick={() => cart.add(p, service)}>
                      {p.in_stock ? 'ADD' : 'Sold out'}
                    </button>
                  )}
                </div>
                {item && p.note_options?.length > 0 && <CutChooser product={p} item={item} cart={cart} />}
              </div>
            </article>
          );
        })}
        {!products.length && <p className="muted">No items match “{search}”.</p>}
      </div>

      {cart.count > 0 && (
        <Link to="/checkout" className="cart-bar" style={{ '--accent': service.category_color }}>
          <span>
            🛒 {cart.count} item{cart.count > 1 ? 's' : ''} ·{' '}
            {cart.subtotal > 0 && <b>₹{cart.subtotal.toLocaleString('en-IN')}</b>}
            {cart.hasBillItems && <>{cart.subtotal > 0 ? ' + ' : ''}<b>shop bill</b></>}
          </span>
          <span>View cart →</span>
        </Link>
      )}
    </>
  );
}

// "How should we cut it?" — tap one or more choices, or type your own.
function CutChooser({ product, item, cart }) {
  return (
    <div className="cut-chooser">
      <small>✂️ How should we cut it?</small>
      <div className="cut-chips">
        {product.note_options.map((c) => (
          <button key={c} type="button" className={item.cuts?.includes(c) ? 'active' : ''} aria-pressed={!!item.cuts?.includes(c)} onClick={() => cart.toggleCut(product.id, c)}>
            {c}
          </button>
        ))}
      </div>
      <input value={item.extra || ''} onChange={(e) => cart.setExtra(product.id, e.target.value)} placeholder="Other instructions (optional)" maxLength={120} />
    </div>
  );
}
