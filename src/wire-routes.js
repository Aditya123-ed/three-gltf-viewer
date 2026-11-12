import { Vector3 } from 'three';

const average = (vertices, positions) => {
  const result = new Vector3();
  vertices.forEach((index) => result.add(positions[index]));
  return result.multiplyScalar(1 / vertices.length);
};

function components(vertices, neighbors) {
  const remaining = new Set(vertices);
  const result = [];
  for (const seed of remaining) {
    const stack = [seed], part = [];
    remaining.delete(seed);
    while (stack.length) {
      const index = stack.pop();
      part.push(index);
      for (const other of neighbors[index]) {
        if (remaining.delete(other)) stack.push(other);
      }
    }
    result.push(part);
  }
  return result;
}

// Recover centerlines from open-ended, triangulated cable tubes. UVs are not
// required, so decimation and texture baking do not change the flow direction.
export function extractWireRoutes(geometry) {
  const attribute = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const triangleCount = (index ? index.count : attribute?.count || 0) / 3;
  if (!attribute || attribute.count > 80000 || triangleCount > 160000) return [];
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const extent = geometry.boundingBox.getSize(new Vector3()).length();
  const epsilon = Math.max(extent * 1e-7, 1e-7);
  const positions = [], welded = [], keys = new Map();
  for (let i = 0; i < attribute.count; i++) {
    const point = new Vector3().fromBufferAttribute(attribute, i);
    const key = [point.x, point.y, point.z].map((value) => Math.round(value / epsilon)).join(',');
    if (!keys.has(key)) { keys.set(key, positions.length); positions.push(point); }
    welded.push(keys.get(key));
  }
  const neighbors = positions.map(() => new Set());
  const edgeCounts = new Map(), faces = [];
  for (let i = 0; i < triangleCount * 3; i += 3) {
    const face = [0, 1, 2].map((offset) => welded[index ? index.getX(i + offset) : i + offset]);
    if (new Set(face).size !== 3) continue;
    faces.push(face);
    for (let j = 0; j < 3; j++) {
      const a = face[j], b = face[(j + 1) % 3];
      neighbors[a].add(b); neighbors[b].add(a);
      const key = a < b ? a + ':' + b : b + ':' + a;
      const edge = edgeCounts.get(key);
      if (edge) edge.count++;
      else edgeCounts.set(key, { a, b, count: 1 });
    }
  }
  const boundary = positions.map(() => new Set());
  for (const { a, b, count } of edgeCounts.values()) {
    if (count === 1) { boundary[a].add(b); boundary[b].add(a); }
  }
  const parts = components(positions.map((_, i) => i), neighbors);
  const partOf = new Int32Array(positions.length);
  parts.forEach((part, i) => part.forEach((vertex) => { partOf[vertex] = i; }));
  const partFaces = parts.map(() => []);
  faces.forEach((face) => partFaces[partOf[face[0]]].push(face));
  const routes = [];
  for (let componentIndex = 0; componentIndex < parts.length; componentIndex++) {
    const part = parts[componentIndex];
    if (part.length < 6 || part.length > 2500) continue;
    const ends = part.filter((vertex) => boundary[vertex].size);
    // Open tubes have two closed end rings. Skip closed, branched, or broken
    // geometry rather than draw a guessed connection through equipment.
    if (!ends.length || ends.some((vertex) => boundary[vertex].size !== 2)) continue;
    const rings = components(ends, boundary);
    if (rings.length !== 2) continue;
    let start = average(rings[0], positions), finish = average(rings[1], positions);
    const axis = finish.clone().sub(start);
    const major = ['x', 'y', 'z'].sort((a, b) => Math.abs(axis[b]) - Math.abs(axis[a]))[0];
    if (axis[major] < 0) { rings.reverse(); [start, finish] = [finish, start]; axis.negate(); }
    const endRadius = Math.max(...rings.flatMap((ring, i) =>
      ring.map((vertex) => positions[vertex].distanceTo(i ? finish : start))));
    const chordLength = start.distanceTo(finish);
    if (chordLength < epsilon * 10 || chordLength < endRadius * 6) continue;

    // Harmonic coordinates run smoothly between the two end rings even after
    // triangles have been decimated. Their cross-sections recover the tube axis.
    const fixed = new Map();
    rings[0].forEach((vertex) => fixed.set(vertex, 0));
    rings[1].forEach((vertex) => fixed.set(vertex, 1));
    const values = new Float64Array(positions.length);
    const lengthSquared = axis.lengthSq();
    part.forEach((vertex) => {
      values[vertex] = fixed.has(vertex) ? fixed.get(vertex)
        : Math.max(0, Math.min(1, positions[vertex].clone().sub(start).dot(axis) / lengthSquared));
    });
    const interior = part.filter((vertex) => !fixed.has(vertex));
    const weighted = new Map(interior.map((vertex) => [vertex, [...neighbors[vertex]].map((other) =>
      [other, 1 / Math.max(epsilon, positions[vertex].distanceTo(positions[other]))])]));
    for (let iteration = 0; iteration < 1200; iteration++) {
      let change = 0;
      for (const vertex of interior) {
        let sum = 0, weightSum = 0;
        for (const [other, weight] of weighted.get(vertex)) { sum += values[other] * weight; weightSum += weight; }
        const next = Math.max(0, Math.min(1, values[vertex] + 1.3 * (sum / weightSum - values[vertex])));
        change = Math.max(change, Math.abs(next - values[vertex]));
        values[vertex] = next;
      }
      if (change < 1e-6) break;
    }
    const points = [start], radii = [];
    const steps = Math.min(64, Math.max(16, Math.round(Math.sqrt(part.length) * 4)));
    for (let step = 1; step < steps; step++) {
      const level = step / steps, center = new Vector3();
      let perimeter = 0;
      for (const face of partFaces[componentIndex]) {
        const intersections = [];
        for (let j = 0; j < 3; j++) {
          const a = face[j], b = face[(j + 1) % 3], va = values[a], vb = values[b];
          if ((va < level && vb >= level) || (vb < level && va >= level)) {
            intersections.push(positions[a].clone().lerp(positions[b], (level - va) / (vb - va)));
          }
        }
        if (intersections.length !== 2) continue;
        const length = intersections[0].distanceTo(intersections[1]);
        center.add(intersections[0].add(intersections[1]).multiplyScalar(length / 2));
        perimeter += length;
      }
      if (perimeter > epsilon) {
        points.push(center.multiplyScalar(1 / perimeter));
        radii.push(perimeter / (2 * Math.PI));
      }
    }
    points.push(finish);
    if (points.length < 4) continue;
    const length = points.slice(1).reduce((sum, point, i) => sum + point.distanceTo(points[i]), 0);
    if (!Number.isFinite(length) || length > chordLength * 4) continue;
    radii.sort((a, b) => a - b);
    routes.push({ points, radius: Math.max(endRadius, radii[Math.floor(radii.length / 2)] || 0), length });
    if (routes.length >= 512) break;
  }
  return routes;
}
