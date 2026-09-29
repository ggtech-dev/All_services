import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import MapView, { secondsAgo } from '../components/MapView.jsx';
import { AGENT_STATE, StateBadge, VEHICLES, statusLabel, usePoll } from '../orderStatus.jsx';
import { useLoad } from './ui.jsx';

const STALE_SECONDS = 180; // older than 3 minutes = grey "last known" pin

// Colour for an agent pin: state colour while fresh, grey when the position is old.
const pinColor = (a) => (a.age_seconds > STALE_SECONDS ? '#94a3b8' : AGENT_STATE[a.state]?.color || '#4f46e5');

// Live map of every agent that has shared GPS. Click an agent to see their trail and current order.
export default function LiveMap() {
  const [agents, setAgents] = useState(null);
  const [filter, setFilter] = useState({ state: '', skill: '' });
  const [selected, setSelected] = useState(null);
  const [track, setTrack] = useState(null);
  const [focus, setFocus] = useState(null);
  const types = useLoad(() => api('/service-types'));
  const typeOf = (c) => types.data?.find((t) => t.code === c);

  const load = useCallback(() => api('/admin/live').then(setAgents).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 10000);

  const loadTrack = useCallback(() => {
    if (selected) api(`/admin/agents/${selected}/track`).then(setTrack).catch(() => {});
  }, [selected]);
  useEffect(() => {
    setTrack(null);
    loadTrack();
  }, [loadTrack]);
  usePoll(loadTrack, 10000, !!selected);

  const shown = useMemo(
    () => (agents || []).filter((a) => (!filter.state || a.state === filter.state) && (!filter.skill || a.skills.includes(filter.skill))),
    [agents, filter]
  );
  const current = agents?.find((a) => a.user_id === selected);

  const markers = shown.map((a) => ({
    id: a.user_id,
    lat: a.lat,
    lng: a.lng,
    emoji: typeOf(a.skills[0])?.icon || '🛵',
    color: pinColor(a),
    pulse: a.user_id === selected,
    accuracy_m: a.user_id === selected ? a.accuracy_m : null,
    label: `${a.full_name} · ${AGENT_STATE[a.state]?.label} · ${secondsAgo(a.age_seconds)}`,
    onClick: () => choose(a),
  }));
  if (track?.order) {
    markers.push({ id: 'dest', lat: track.order.dest_lat, lng: track.order.dest_lng, emoji: '🏠', color: '#16a34a', label: `Order #${track.order.id} destination` });
  }
  const path = (track?.trail || []).map((p) => [p.lat, p.lng]);

  function choose(a) {
    setSelected(a.user_id);
    setFocus({ lat: a.lat, lng: a.lng, zoom: 15 });
  }

  const counts = (agents || []).reduce((acc, a) => ({ ...acc, [a.state]: (acc[a.state] || 0) + 1 }), {});

  return (
    <div className="live-layout">
      <section className="panel live-map-panel">
        <div className="live-legend">
          <span><i style={{ background: AGENT_STATE.free.color }} /> Free {counts.free || 0}</span>
          <span><i style={{ background: AGENT_STATE.busy.color }} /> On delivery {counts.busy || 0}</span>
          <span><i style={{ background: AGENT_STATE.offline.color }} /> Offline / old position {(counts.offline || 0)}</span>
          <span className="muted">Updates every 10 s</span>
        </div>
        <MapView markers={markers} path={path} fitKey={agents ? `${agents.length}` : 'none'} focus={focus} height="calc(100vh - 210px)" />
      </section>

      <aside className="live-side">
        <div className="live-filters">
          <select value={filter.state} onChange={(e) => setFilter({ ...filter, state: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            <option value="free">🟢 Free</option>
            <option value="busy">🔵 On delivery</option>
            <option value="offline">⚪ Offline</option>
          </select>
          <select value={filter.skill} onChange={(e) => setFilter({ ...filter, skill: e.target.value })} aria-label="Type of work">
            <option value="">All types</option>
            {types.data?.map((t) => <option key={t.code} value={t.code}>{t.icon} {t.name}</option>)}
          </select>
        </div>

        {current && (
          <div className="panel live-detail">
            <div className="live-detail-head">
              <div className="agent-avatar small">{current.full_name[0]}</div>
              <div>
                <b>{current.full_name}</b>
                <div><StateBadge state={current.state} /></div>
              </div>
              <button className="icon-btn" onClick={() => { setSelected(null); setTrack(null); }} aria-label="Close">✕</button>
            </div>
            <dl className="kv small">
              <dt>Phone</dt><dd><a href={`tel:${current.phone}`}>{current.phone}</a></dd>
              <dt>Vehicle</dt><dd>{VEHICLES[current.vehicle_type]} {current.vehicle_number}</dd>
              <dt>Types</dt><dd>{current.skills.map((c) => typeOf(c)?.name || c).join(', ')}</dd>
              <dt>Location</dt><dd>{secondsAgo(current.age_seconds)}{current.accuracy_m ? ` · ±${current.accuracy_m} m` : ''}</dd>
              <dt>Trail</dt><dd>{track ? `${track.trail.length} points in last 12 h` : '…'}</dd>
            </dl>
            {track?.order ? (
              <div className="live-order">
                <b>Order #{track.order.id}</b> · {statusLabel(track.order.status)}<br />
                <span className="small">To {current.contact_name} ({current.order_locality}) · {track.order.distance_km} km away · ~{track.order.eta_minutes} min</span>
              </div>
            ) : (
              <p className="muted small">No active order.</p>
            )}
            <div className="live-links">
              {track?.order && <Link className="link" to={`/admin/orders?open=${track.order.id}`}>Open order →</Link>}
              <Link className="link" to={`/admin/agents?open=${current.user_id}`}>Agent profile →</Link>
              <a className="link" href={`https://www.google.com/maps?q=${current.lat},${current.lng}`} target="_blank" rel="noreferrer">Google Maps ↗</a>
            </div>
          </div>
        )}

        <div className="live-list">
          {agents && !shown.length && <p className="muted small">No agents have shared their location yet. Agents share GPS automatically while they are online in the agent app.</p>}
          {shown.map((a) => (
            <button key={a.user_id} className={`live-row ${a.user_id === selected ? 'active' : ''}`} onClick={() => choose(a)}>
              <span className="live-dot" style={{ background: pinColor(a) }} />
              <span className="live-row-main">
                <b>{a.full_name}</b>
                <small className="muted">
                  {a.order_id ? `#${a.order_id} → ${a.order_locality}` : AGENT_STATE[a.state]?.label} · {secondsAgo(a.age_seconds)}
                </small>
              </span>
              <span>{a.skills.map((c) => typeOf(c)?.icon).join('')}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
