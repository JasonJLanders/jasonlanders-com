/* global L */

/**
 * Leaflet divIcon factories for each role.
 * All return L.DivIcon instances suitable for L.marker().
 */

// SE — filled circle, workload-matched color; larger + glowing in rebalance mode
export function seIcon(color, rebalanceMode) {
  const d = rebalanceMode ? 20 : 16;
  const glow = rebalanceMode
    ? `box-shadow:0 0 0 3px ${color}55,0 0 10px ${color}99;cursor:grab;`
    : '';
  return L.divIcon({
    className: '',
    html: `<div style="width:${d}px;height:${d}px;border-radius:50%;background:${color};border:2px solid #fff;${glow}"></div>`,
    iconSize:   [d, d],
    iconAnchor: [d / 2, d / 2]
  });
}

// AE — diamond (rotated square), blue
export function aeIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;display:flex;align-items:center;justify-content:center">
             <div style="width:13px;height:13px;background:#3b82f6;border:2px solid #fff;transform:rotate(45deg)"></div>
           </div>`,
    iconSize:   [18, 18],
    iconAnchor: [9, 9]
  });
}

// RD — circle with amber ring
export function rdIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:rgba(245,158,11,0.2);border:2px solid #f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,0.35)"></div>`,
    iconSize:   [18, 18],
    iconAnchor: [9, 9]
  });
}

// RVP — circle with double purple ring
export function rvpIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:20px;height:20px;border-radius:50%;background:rgba(168,85,247,0.2);border:2px solid #a855f7;outline:2px solid rgba(168,85,247,0.4);outline-offset:2px"></div>`,
    iconSize:   [20, 20],
    iconAnchor: [10, 10]
  });
}

// SE Leader — 5-point star (SVG)
export function seLeaderIcon() {
  // Points computed for a star inscribed in r=10, inner r=4, center (12,12)
  const pts = '12,2 14.4,8.8 21.5,8.9 15.8,13.2 17.9,20.1 12,16 6.1,20.1 8.2,13.2 2.5,8.9 9.7,8.8';
  return L.divIcon({
    className: '',
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
             <polygon points="${pts}" fill="#d946ef" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
           </svg>`,
    iconSize:   [24, 24],
    iconAnchor: [12, 12]
  });
}
