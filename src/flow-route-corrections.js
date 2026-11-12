// These individually marked spans run opposite to the other spans in their
// merged wire meshes. Match both endpoints in mesh coordinates,
// never a traversal index or the whole mesh. Unmatched/future geometry is left
// alone. This only reverses the effect centerline, not the model's geometry.
const REVERSED_SPANS = [
  // Three drops below each of the two entry gantries.
  { name: 'Internal Supply Wire1', start: [-98.82240, 5.23093, 23.97449], end: [-101.96950, 9.36619, 23.38373] },
  { name: 'Internal Supply Wire1', start: [-98.81972, 5.21750, 19.96006], end: [-100.67522, 9.40647, 18.57716] },
  { name: 'Internal Supply Wire1', start: [-98.82240, 5.22019, 22.03038], end: [-101.31967, 9.41452, 20.97508] },
  { name: 'Internal Supply Wire3', start: [-98.82561, 5.20816, -6.05868], end: [-100.32073, 9.38225, -5.52033] },
  { name: 'Internal Supply Wire3', start: [-98.82561, 5.21071, -10.03885], end: [-100.32073, 9.39500, -10.48280] },
  { name: 'Internal Supply Wire3', start: [-98.82561, 5.21071, -8.04877], end: [-100.31563, 9.35163, -8.01305] },
  // One short branch from the horizontal bus in each of the three bays.
  { name: 'Internal Supply Wire1', start: [-83.10371, 5.23361, 23.98388], end: [-83.83073, 7.26365, 23.91742] },
  { name: 'Internal Supply Wire2', start: [-83.10137, 5.23409, 8.98221], end: [-83.83201, 7.26353, 8.91537] },
  { name: 'Internal Supply Wire3', start: [-83.10263, 5.23304, -6.00637], end: [-83.83360, 7.26331, -6.07335] },
];

const near = (point, target) => point &&
  (point.x - target[0]) ** 2 + (point.y - target[1]) ** 2 + (point.z - target[2]) ** 2 < 0.025 ** 2;

export function correctFlowRoute(name, route) {
  const match = REVERSED_SPANS.some((drop) => drop.name === name &&
    near(route.points[0], drop.start) && near(route.points.at(-1), drop.end));
  return match ? { ...route, points: [...route.points].reverse() } : route;
}
