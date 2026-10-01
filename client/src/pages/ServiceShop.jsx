import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatEta } from '../api.js';
import SmartImage from '../components/SmartImage.jsx';
import { useCart } from '../cart.jsx';
import { qtyLabel, windowLabel } from '../qty.js';
import PhotoPicker from '../components/PhotoPicker.jsx';
import ScrollRow from '../components/ScrollRow.jsx';
import Skeleton from '../components/Skeleton.jsx';

const rupees = (v) => `₹${Number(v).toLocaleString('en-IN')}`;

// Customer page listing the products inside one service (e.g. Milk Delivery, Fresh Vegetables).
export default function ServiceShop() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('pick');
  const [section, setSection] = useState('');
  const cart = useCart();

  useEffect(() => {
    setData(null);
    setError('');
    api(`/services/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  const products = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.products || []).filter((p) => `${p.name} ${p.brand || ''} ${p.section || ''}`.toLowerCase().includes(q));
  }, [data, search]);
  // sections (kirana: Rice & Grains, Dals & Pulses…) in catalog order, shown as chips and headings
  const sections = useMemo(() => [...new Set((data?.products || []).map((p) => p.section).filter(Boolean))], [data]);
  const groups = useMemo(() => {
    const shown = section ? products.filter((p) => p.section === section) : products;
    const out = [];
    for (const p of shown) {
      const name = p.section || '';
      let g = out.find((x) => x.name === name);
      if (!g) out.push((g = { name, items: [] }));
      g.items.push(p);
    }
    return out;
  }, [products, section]);

  if (error) return <div className="alert">{error} — <Link to="/">back home</Link></div>;
  if (!data) return <Skeleton variant="shop" />;

  const { service } = data;
  const onBill = service.price_on_bill;
  const card = (p) => {
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
  };
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

      {service.allows_list && (
        <div className="shop-tabs" role="tablist" style={{ '--accent': service.category_color }}>
          <button type="button" role="tab" aria-selected={tab === 'pick'} className={tab === 'pick' ? 'active' : ''} onClick={() => setTab('pick')}>
            🛒 Pick items
          </button>
          <button type="button" role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            ✍️ Write your list{cart.lines.filter((l) => l.service_id === service.id && l.name.trim()).length > 0 && ` (${cart.lines.filter((l) => l.service_id === service.id && l.name.trim()).length})`}
          </button>
        </div>
      )}

      {tab === 'list' && service.allows_list ? (
        <OwnList service={service} cart={cart} />
      ) : (
      <>
        {sections.length > 1 && (
          <ScrollRow className="section-chips" label="Sections" activeKey={section} style={{ '--accent': service.category_color }}>
            <button type="button" className={!section ? 'active' : ''} aria-pressed={!section} onClick={() => setSection('')}>All</button>
            {sections.map((name) => (
              <button type="button" key={name} className={section === name ? 'active' : ''} aria-pressed={section === name} onClick={() => setSection(section === name ? '' : name)}>{name}</button>
            ))}
          </ScrollRow>
        )}
        {groups.map((g) => (
          <section key={g.name || 'all'} className="shop-section">
            {g.name && sections.length > 1 && <h2 className="shop-section-title">{g.name} <span className="muted">{g.items.length}</span></h2>}
            <div className="product-grid" style={{ '--accent': service.category_color }}>
              {g.items.map(card)}
            </div>
          </section>
        ))}
        {!products.length && <p className="muted">No items match “{search}”.</p>}
      </>
      )}

      {cart.count > 0 && <div className="cart-bar-space" aria-hidden="true" />}
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

// "Write your list": item + quantity lines, and/or a photo of a handwritten list. Priced by the shop bill.
function OwnList({ service, cart }) {
  const [photoError, setPhotoError] = useState('');
  const mine = cart.lines.filter((l) => l.service_id === service.id);
  const photo = cart.photo?.service_id === service.id ? cart.photo.file : null;
  // always one empty line to type into
  useEffect(() => {
    if (!mine.length) cart.ensureLine(service);
  }, [mine.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="own-list panel" style={{ '--accent': service.category_color }}>
      <p className="muted small">Write what you need, like you would on paper. Your delivery partner buys it and shares the shop bill.</p>
      <div className="own-lines">
        {mine.map((l, i) => (
          <div className="own-line" key={l.key}>
            <span className="own-no">{i + 1}.</span>
            <input value={l.name} onChange={(e) => cart.updateLine(l.key, { name: e.target.value.slice(0, 80) })} placeholder={i === 0 ? 'Item, e.g. Sugar' : 'Item'} aria-label={`Item ${i + 1}`} />
            <input className="own-qty" value={l.qty_text} onChange={(e) => cart.updateLine(l.key, { qty_text: e.target.value.slice(0, 30) })} placeholder={i === 0 ? 'e.g. 2 kg' : 'Qty'} aria-label={`Quantity of item ${i + 1}`} />
            <button type="button" className="own-remove" onClick={() => cart.removeLine(l.key)} aria-label={`Remove item ${i + 1}`}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-ghost btn-sm own-add" onClick={() => cart.addLine(service)} disabled={mine.length >= 40}>➕ Add another item</button>
      <div className="own-photo">
        <PhotoPicker label="📷 Or send a photo of your list" file={photo} onFile={(f) => cart.setPhoto(f, service).catch((e) => setPhotoError(e.message))} cameraFirst={false} />
        {photoError && <small className="danger-text">{photoError}</small>}
        {photo && <small className="muted">✓ Your delivery partner will see this photo with your order.</small>}
      </div>
    </section>
  );
}
