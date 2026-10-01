import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ACTIVE, StatusBadge, rupees, usePoll, when } from '../orderStatus.jsx';
import Skeleton, { EmptyState } from '../components/Skeleton.jsx';

export default function MyOrders() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('/orders').then(setOrders).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);
  usePoll(load, 10000, !!orders?.some((o) => ACTIVE.includes(o.status)));

  if (error) return <div className="alert">{error}</div>;
  if (!orders) return <Skeleton variant="list" />;
  if (!orders.length) {
    return <EmptyState icon="📦" title="No orders yet" text="Your orders and bookings will show up here." action="Browse services" to="/" />;
  }

  return (
    <>
      <h1 className="page-title">My orders</h1>
      <div className="order-list">
        {orders.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className="order-row">
            <div className="order-row-main">
              <div className="order-row-top">
                <b>#{o.id}</b>
                <StatusBadge status={o.status} kind={o.kind} />
              </div>
              <p className="order-summary">{o.summary}</p>
              <small className="muted">
                {when(o.created_at)}
                {o.agent_name && ` · ${o.agent_title || 'Agent'}: ${o.agent_name}`}
              </small>
            </div>
            <div className="order-row-side">
              <b>{rupees(o.total)}</b>
              {o.otp_required && ACTIVE.includes(o.status) && o.status !== 'placed' && <span className="otp-chip">OTP {o.delivery_otp}</span>}
              {o.status === 'delivered' && o.agent_name && (o.rated
                ? <span className="rated-chip" title="Your rating">★ {o.rated}</span>
                : <span className="rate-chip">⭐ Rate</span>)}
              <span className="link">{o.status === 'delivered' ? 'View →' : 'Track →'}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
