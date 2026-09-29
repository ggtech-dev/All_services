import { useEffect, useRef } from 'react';

// Order status labels, colours and tracking steps, shared by customer, agent and admin screens.
export const STATUS = {
  placed: { label: 'Waiting for agent', short: 'Placed', color: '#f59e0b' },
  assigned: { label: 'Agent assigned', short: 'Assigned', color: '#3b82f6' },
  picked_up: { label: 'On the way', short: 'On the way', color: '#8b5cf6' },
  delivered: { label: 'Delivered', short: 'Delivered', color: '#16a34a' },
  cancelled: { label: 'Cancelled', short: 'Cancelled', color: '#dc2626' },
};

// Services have a "partner" and are "completed" rather than "delivered".
const SERVICE_LABELS = { placed: 'Waiting for partner', assigned: 'Partner assigned', delivered: 'Completed' };
export const statusLabel = (status, kind) =>
  (kind === 'service' && SERVICE_LABELS[status]) || STATUS[status]?.label || status;

export const STEPS = ['placed', 'assigned', 'picked_up', 'delivered'];
export const stepLabels = (kind) =>
  kind === 'service'
    ? ['Booked', 'Partner assigned', 'On the way', 'Completed']
    : ['Order placed', 'Agent assigned', 'Picked up', 'Delivered'];

export const ACTIVE = ['placed', 'assigned', 'picked_up'];

export const AGENT_STATE = {
  free: { label: 'Free', color: '#16a34a' },
  busy: { label: 'On delivery', color: '#3b82f6' },
  offline: { label: 'Offline', color: '#94a3b8' },
  pending: { label: 'Awaiting approval', color: '#f59e0b' },
  rejected: { label: 'Rejected', color: '#dc2626' },
  suspended: { label: 'Suspended', color: '#7c3aed' },
};

export const VEHICLES = { bike: '🏍️ Bike', scooter: '🛵 Scooter', bicycle: '🚲 Bicycle', auto: '🛺 Auto', van: '🚐 Van' };

export const rupees = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
export const when = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
export const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

export function StatusBadge({ status, kind }) {
  const s = STATUS[status] || {};
  return (
    <span className="status-badge" style={{ '--c': s.color }}>
      {statusLabel(status, kind)}
    </span>
  );
}

export function StateBadge({ state }) {
  const s = AGENT_STATE[state] || {};
  return (
    <span className="status-badge" style={{ '--c': s.color }}>
      <span className="dot-live" /> {s.label || state}
    </span>
  );
}

// Calls fn every `ms` milliseconds while `active` is true (live tracking / new-order refresh).
export function usePoll(fn, ms, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

// "just now", "40 s ago", "3 min ago" for location freshness.
export const secondsAgo = (s) =>
  s == null ? '' : s < 15 ? 'just now' : s < 90 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
