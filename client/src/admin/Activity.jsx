import { api } from '../api.js';
import { timeAgo, useLoad } from './ui.jsx';

const ENTITY = { promotions: 'promotion', services: 'service', products: 'product', categories: 'category', site_settings: 'site settings', localities: 'area', shops: 'shop' };
const FIELD = {
  base_price: 'price', price_unit: 'price unit', is_active: 'visibility', image_url: 'image',
  eta_minutes: 'time', delivery_fee: 'delivery charge', price_on_bill: 'price as per shop bill', window_from: 'delivery from', window_to: 'delivery until',
  is_featured: 'home page highlight', allows_list: 'own list', service_ids: 'sells for', phone: 'phone', address: 'address', locality_id: 'area', sell_by: 'sold by', note_options: 'cutting options', pincode: 'pincode', lat: 'map location', lng: 'map location', skill_code: 'agent type', price: 'price', mrp: 'MRP', in_stock: 'stock', brand: 'brand', unit: 'pack size', service_id: 'service', requires_license: 'licence flag', category_id: 'category', name: 'name',
  description: 'description', icon: 'icon', color: 'colour', image_credit: 'image credit', sort_order: 'order',
};

// Turns an audit row into a readable sentence.
export function describeActivity(a) {
  const d = a.details || {};
  const what = ENTITY[a.entity] || a.entity;
  if (a.entity === 'site_settings') return `Updated site settings (${Object.keys(d).join(', ').replaceAll('_', ' ')})`;
  if (a.action === 'create') return `Added ${what} “${d.name}”`;
  if (a.action === 'delete') return `Deleted ${what} “${d.name}”`;

  const changes = Object.keys(d).filter((k) => k !== 'name' && k !== 'slug');
  if (changes.length === 1 && changes[0] === 'base_price')
    return `Changed price of “${d.name}”: ₹${d.base_price.from} → ₹${d.base_price.to}`;
  if (changes.length === 1 && changes[0] === 'price')
    return `Changed price of “${d.name}”: ₹${d.price.from} → ₹${d.price.to}`;
  if (changes.length === 1 && changes[0] === 'in_stock')
    return `Marked “${d.name}” ${d.in_stock.to ? 'in stock' : 'out of stock'}`;
  if (changes.length === 1 && changes[0] === 'is_active')
    return `${d.is_active.to ? 'Showed' : 'Hid'} ${what} “${d.name}”`;
  return `Edited ${what} “${d.name}” (${changes.map((k) => FIELD[k] || k).join(', ')})`;
}

export default function Activity() {
  const log = useLoad(() => api('/admin/activity?limit=200'));
  if (log.loading && !log.data) return <div className="center-block"><div className="spinner" /></div>;
  if (log.error) return <div className="alert">{log.error}</div>;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Everything changed in the admin panel</h3>
        <button className="btn btn-ghost btn-sm" onClick={log.reload}>↻ Refresh</button>
      </div>
      {log.data.length ? (
        <ul className="activity-list">
          {log.data.map((a) => (
            <li key={a.id}>
              <span className={`dot dot-${a.action}`} />
              <div>
                <div>{describeActivity(a)}</div>
                <small className="muted">{a.actor || 'system'} · {timeAgo(a.created_at)} · {new Date(a.created_at).toLocaleString('en-IN')}</small>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing yet.</p>
      )}
    </section>
  );
}
