import { lazy, Suspense } from 'react';

// The map library (Leaflet) is only downloaded when a map is actually shown.
const MapView = lazy(() => import('./MapView.jsx'));

export default function LazyMap(props) {
  return (
    <Suspense fallback={<div className="map-view" style={{ height: props.height || 320 }} />}>
      <MapView {...props} />
    </Suspense>
  );
}
