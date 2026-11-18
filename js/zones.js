// Speed zones and water body names. Boundaries follow WA Department of Transport rules for the
// Swan Canning Riverpark as described in their public guidance (approximated to polygons for the game).
import { toXZ, oceanAt } from './world.js';
import { Obs } from './static.js';

const P = (pts) => pts.map(([lon, lat]) => toXZ(lon, lat));

export const ZONES = [
  { id: 'pwc', name: 'Narrows PWC Freestyle Area', limit: null, freestyle: true, color: '#1d8f3a',
    rule: 'Gazetted jet ski freestyle area downstream of the Narrows Bridge. Keep 30 m from other PWCs.',
    poly: P([[115.8355, -31.9676], [115.8458, -31.9648], [115.8460, -31.9724], [115.8400, -31.9762], [115.8352, -31.9741]]) },
  { id: 'freo', name: 'Fremantle Port to Mosman Bay', limit: 8, color: '#d81e1e',
    rule: '8 knot limit from the Fremantle Inner Harbour up to Mosman Bay.',
    poly: P([[115.7252, -32.0546], [115.7332, -32.0572], [115.7600, -32.0480], [115.7700, -32.0335], [115.7885, -32.0255], [115.7905, -32.0125],
      [115.7868, -32.0085], [115.7800, -32.0040], [115.7650, -32.0040], [115.7500, -32.0250], [115.7350, -32.0440]]) },
  { id: 'matilda', name: 'Matilda Bay', limit: 8, color: '#d81e1e',
    rule: '8 knot area off Crawley, east to the PWC area and south to Pelican Point.',
    poly: P([[115.8175, -31.9700], [115.8350, -31.9675], [115.8352, -31.9741], [115.8290, -31.9880], [115.8175, -31.9880]]) },
  { id: 'perth', name: 'Perth Water', limit: 8, color: '#d81e1e',
    rule: '8 knot limit on Perth Water, Narrows Bridge to the Causeway and on to the Windan Bridge.',
    poly: P([[115.8462, -31.9585], [115.8462, -31.9735], [115.8700, -31.9790], [115.8980, -31.9720], [115.8990, -31.9476], [115.8700, -31.9476]]) },
  { id: 'upper', name: 'Swan River above the Windan Bridge', limit: 8, color: '#d81e1e',
    rule: 'Upper reaches upstream of the Windan Bridge: 8 knots.',
    poly: P([[115.8700, -31.9476], [115.8990, -31.9476], [115.8990, -31.9650], [115.9700, -31.9650], [115.9700, -31.8700], [115.8700, -31.8700]]) },
  { id: 'shelley', name: 'Shelley Water ski area', limit: null, color: '#1f6fd1',
    rule: 'Open water ski area on the Canning (daytime only).',
    poly: P([[115.8735, -32.0300], [115.8760, -32.0190], [115.8990, -32.0170], [115.9010, -32.0300]]) },
  { id: 'canning', name: 'Canning River above Mount Henry Bridge', limit: 8, color: '#d81e1e',
    rule: '8 knots on the upper Canning outside the ski area.',
    poly: P([[115.8540, -32.0360], [115.8620, -32.0330], [115.8660, -32.0200], [115.9700, -32.0100], [115.9700, -32.0600], [115.8540, -32.0600]]) },
];

function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

// returns {name, limit (knots or null), freestyle, rule, kind}
export function zoneAt(x, z, night, nearSwimmer) {
  let zone = null;
  for (const zn of ZONES) if (inPoly(x, z, zn.poly)) { zone = zn; break; }
  const deck = Obs.deckAt(x, z);
  if (deck) return { name: `Under the ${deck.name || 'bridge'}`, limit: 8, rule: '8 knots through any bridge arch unless signed otherwise.', kind: 'bridge' };
  if (nearSwimmer) return { name: 'Swimmers nearby', limit: 8, rule: '8 knots within 50 m of a person in the water.', kind: 'swimmer' };
  if (zone && zone.limit) return { name: zone.name, limit: zone.limit, rule: zone.rule, kind: 'zone' };
  if (zone && zone.id === 'shelley' && night) return { name: zone.name, limit: 10, rule: 'Ski area is closed at night: 10 knots.', kind: 'night' };
  if (zone && zone.freestyle) return { name: zone.name, limit: night ? 10 : null, freestyle: true, rule: zone.rule, kind: 'pwc' };
  const ocean = oceanAt(x, z) > 0.5;
  if (night && !ocean) return { name: 'Night time', limit: 10, rule: '10 knots between sunset and sunrise outside restricted areas.', kind: 'night' };
  return { name: ocean ? 'Open ocean' : (zone ? zone.name : 'Open water'), limit: null, rule: ocean ? 'No river speed limit. Watch the swell.' : 'No speed limit in daylight. Stay 50 m clear of swimmers.', kind: 'open' };
}

// Water body names for the location banner
const REGIONS = [
  ['Elizabeth Quay', 115.8573, -31.9585, 170], ['Barrack Square', 115.8590, -31.9605, 160], ['Claisebrook Cove', 115.8790, -31.9518, 220],
  ['Crawley Edge Boatshed', 115.8266, -31.9733, 120], ['Mends Street Jetty', 115.8539, -31.9706, 150],
  ['Matilda Bay', 115.8252, -31.9790, 650], ['Pelican Point', 115.8272, -31.9876, 350], ['Mounts Bay', 115.8380, -31.9660, 520],
  ['The Narrows', 115.8466, -31.9640, 260], ['Heirisson Island', 115.8770, -31.9670, 420], ['Perth Water', 115.8650, -31.9660, 1700],
  ['Fremantle Inner Harbour', 115.7420, -32.0470, 950], ['Fremantle Bridges', 115.7560, -32.0405, 300], ['Rocky Bay', 115.7578, -32.0265, 420],
  ['Blackwall Reach', 115.7740, -32.0215, 650], ['Mosman Bay', 115.7737, -32.0073, 450], ['Point Walter', 115.7880, -32.0100, 480],
  ['Freshwater Bay', 115.7793, -31.9946, 900], ['Point Resolution', 115.7918, -32.0047, 350], ['Alfred Cove', 115.8142, -32.0276, 650],
  ['Point Heathcote', 115.8422, -32.0022, 380], ['Waylen Bay', 115.8370, -32.0038, 450], ['Como Beach', 115.8600, -31.9930, 500],
  ['Canning Bridge', 115.8533, -32.0110, 350], ['Mount Henry', 115.8580, -32.0320, 500], ['Deep Water Point', 115.8550, -32.0236, 380],
  ['Salter Point', 115.8735, -32.0307, 420], ['Shelley Water', 115.8880, -32.0240, 900], ['Canning River', 115.9200, -32.0250, 4000],
  ['Melville Water', 115.8250, -31.9980, 2800], ['Burswood', 115.8920, -31.9540, 700], ['Maylands', 115.8950, -31.9380, 1100],
  ['Swan River', 115.9300, -31.9300, 5000], ['Cottesloe', 115.7480, -31.9950, 1600], ['Port Beach', 115.7440, -32.0300, 1200],
  ['Rottnest Island', 115.5100, -32.0050, 7000], ['Bathers Beach', 115.7425, -32.0590, 350],
];
const REG = REGIONS.map(([n, lon, lat, r]) => { const [x, z] = toXZ(lon, lat); return { n, x, z, r }; }).sort((a, b) => a.r - b.r);
export function placeName(x, z) {
  for (const r of REG) if (Math.hypot(x - r.x, z - r.z) < r.r) return r.n;
  if (oceanAt(x, z) > 0.5) return x > toXZ(115.70, 0)[0] ? 'Gage Roads' : 'Indian Ocean';
  return 'Swan River';
}
