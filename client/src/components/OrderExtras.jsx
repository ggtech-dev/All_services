import { PrivateImage } from './ShopBill.jsx';

// The shop the customer chose, and the photo of their handwritten list — on the agent, customer and admin pages.
//   filesBase: where this viewer reads the order's private photos, e.g. /agent/orders/12/files
export default function OrderExtras({ order, filesBase, who = 'customer' }) {
  if (!order.preferred_shop && !order.has_list_photo) return null;
  return (
    <div className="order-extras">
      {order.preferred_shop && (
        <div className={`shop-pref ${who === 'agent' ? 'shop-pref-strong' : ''}`}>
          <span>
            🏪 {who === 'agent' ? 'Buy only from' : who === 'admin' ? 'Customer chose' : 'Your shop'}: <b>{order.preferred_shop}</b>
            {order.preferred_shop_area && <span className="muted"> · {order.preferred_shop_area}</span>}
          </span>
          {who !== 'customer' && order.preferred_shop_phone && <a className="btn btn-ghost btn-sm" href={`tel:${order.preferred_shop_phone}`}>📞 Call shop</a>}
        </div>
      )}
      {order.has_list_photo && (
        <div className="list-photo">
          <PrivateImage path={`${filesBase}/list`} alt="Photo of the shopping list" className="thumb-md" />
          <small className="muted">📷 {who === 'customer' ? 'Your list photo' : "Customer's list photo"} — tap to open</small>
        </div>
      )}
    </div>
  );
}
