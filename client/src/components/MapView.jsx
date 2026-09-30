import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const SIDDIPET = [18.1018, 78.852]; // launch city; maps zoom to their markers anyway

// Free OpenStreetMap tiles. For heavy traffic, swap TILE_URL for a free-tier provider (MapTiler, Stadia).
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const emojiIcon = (emoji, color, pulse) =>
  L.divIcon({
    className: '',
    html: `<div class="map-pin ${pulse ? 'map-pin-pulse' : ''}" style="--pin:${color || '#4f46e5'}"><span>${emoji}</span></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -34],
  });

/**
 * Small wrapper around Leaflet.
 *  markers: [{ id, lat, lng, emoji, color, pulse, label (tooltip), popup (html), onClick, accuracy_m }]
 *  path:    [[lat, lng], ...] drawn as a line (e.g. the agent's trail)
 *  fitKey:  when this value changes the map zooms to show all markers + path (so polling doesn't fight the user's panning)
 *  focus:   { lat, lng, zoom } to fly to
 *  onMapClick: ({ lat, lng }) => … when the map itself is tapped (e.g. to place a pin)
 */
export default function MapView({ markers = [], path = [], fitKey, focus, height = 320, className = '', onMapClick }) {
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);

  useEffect(() => {
    map.current = L.map(box.current, { zoomControl: true, attributionControl: true }).setView(SIDDIPET, 13);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    map.current.on('click', (e) => clickRef.current?.({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }));
    // The map may be created inside a modal/panel that is still animating: re-measure shortly after.
    const t = setTimeout(() => map.current?.invalidateSize(), 250);
    return () => {
      clearTimeout(t);
      // Stop any pan/zoom first: removing a map mid-animation makes Leaflet throw (_leaflet_pos).
      map.current.off();
      map.current.stop();
      map.current.remove();
      map.current = null;
    };
  }, []);

  // Redraw markers and the path whenever they change.
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    if (path.length > 1) {
      L.polyline(path, { color: '#4f46e5', weight: 4, opacity: 0.6, dashArray: '6 6' }).addTo(group);
    }
    for (const m of markers) {
      if (m.lat == null || m.lng == null) continue;
      if (m.accuracy_m && m.accuracy_m > 30) {
        L.circle([m.lat, m.lng], { radius: m.accuracy_m, color: m.color, weight: 1, fillOpacity: 0.08 }).addTo(group);
      }
      const mk = L.marker([m.lat, m.lng], { icon: emojiIcon(m.emoji, m.color, m.pulse), zIndexOffset: m.pulse ? 1000 : 0 }).addTo(group);
      if (m.label) mk.bindTooltip(m.label, { direction: 'top', offset: [0, -34] });
      if (m.popup) mk.bindPopup(m.popup);
      if (m.onClick) mk.on('click', m.onClick);
    }
  }, [markers, path]);

  // Zoom to fit everything when fitKey changes.
  useEffect(() => {
    if (!map.current) return;
    const pts = [...markers.filter((m) => m.lat != null).map((m) => [m.lat, m.lng]), ...path];
    // No animation: the map may close right after (e.g. admin taps a pin and saves at once).
    if (pts.length === 1) map.current.setView(pts[0], 15, { animate: false });
    else if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (map.current && focus) map.current.flyTo([focus.lat, focus.lng], focus.zoom || 15, { duration: 0.6 });
  }, [focus]);

  return <div ref={box} className={`map-view ${className}`} style={{ height }} />;
}

export { secondsAgo } from '../orderStatus.jsx';
