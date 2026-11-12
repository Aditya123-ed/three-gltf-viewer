import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { correctFlowRoute } from '../src/flow-route-corrections.js';
import { CurrentFlowParticles, FLOW_DEFAULTS, parseFlowSettings } from '../src/current-flow-particles.js';

// Samples from all 87 actual spans of the revised GLB, including their exact
// endpoint centroids. Keep the earlier gantry corrections when adding the
// three newly marked branches from the horizontal bus.
const spans = JSON.parse(fs.readFileSync(new URL('./fixtures/substation-wire-spans.json', import.meta.url)));
const previousMarks = new Set([
  'Internal Supply Wire1:27', 'Internal Supply Wire1:28', 'Internal Supply Wire1:29',
  'Internal Supply Wire3:28', 'Internal Supply Wire3:29', 'Internal Supply Wire3:30',
]);
const newMarks = new Set(['Internal Supply Wire1:9', 'Internal Supply Wire2:12', 'Internal Supply Wire3:15']);
const marked = new Set([...previousMarks, ...newMarks]);
const routeOf = (span) => ({ ...span, points: span.points.map((point) => new Vector3(...point)) });

test('the nine individually marked spans reverse; the other 78 source paths and all source points stay unchanged', () => {
  const correctedIds = [];
  // Reversing the traversal order demonstrates that matching does not use indices.
  for (const span of [...spans].reverse()) {
    const route = routeOf(span), before = route.points.map((point) => point.toArray());
    const corrected = correctFlowRoute(span.mesh, route);
    const id = span.mesh + ':' + span.span;
    if (marked.has(id)) {
      correctedIds.push(id);
      assert.deepEqual(corrected.points.map((point) => point.toArray()), [...before].reverse());
      assert.equal(corrected.length, route.length);
      assert.equal(corrected.radius, route.radius);
      assert.equal(correctFlowRoute(span.mesh, corrected), corrected, 'an already corrected path must not flip again');
      assert.equal(correctFlowRoute('Another Wire', route), route, 'coordinates alone must not match another mesh');
    } else {
      assert.equal(corrected, route, id);
    }
    assert.deepEqual(route.points.map((point) => point.toArray()), before, 'source points must not be mutated');
  }
  assert.deepEqual(new Set(correctedIds), marked);
});

test('only the three new branches change motion, preserving earlier corrections and saved mesh directions', () => {
  const scene = new Scene(), camera = new PerspectiveCamera(); camera.position.set(-70, 40, 50);
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); scene.add(mesh);
  const groups = new Map();
  for (const span of spans) {
    if (!groups.has(span.mesh)) groups.set(span.mesh, { key: span.mesh, name: span.mesh, routes: [] });
    groups.get(span.mesh).routes.push({ ...routeOf(span), mesh });
  }
  const originals = [...groups.values()];
  const previous = originals.map((group) => ({ ...group, routes: group.routes.map((route) =>
    previousMarks.has(group.name + ':' + route.span) ? { ...route, points: [...route.points].reverse() } : route,
  ) }));
  const corrections = originals.map((group) => ({ ...group, routes: group.routes.map((route) => correctFlowRoute(group.name, route)) }));
  const settings = { ...FLOW_DEFAULTS, directions: { 'Internal Supply Wire1': 'reverse' } };
  const before = new CurrentFlowParticles(scene, previous, settings);
  const after = new CurrentFlowParticles(scene, corrections, settings);
  for (const effect of [before, after]) {
    effect.routes.forEach((route) => { route.phase = 0.5; });
    effect.update(0, camera);
  }
  const startBefore = before.positions.slice(), startAfter = after.positions.slice();
  before.update(0.01, camera); after.update(0.01, camera);
  let offset = 0;
  for (const route of before.routes) {
    const id = route.group.name + ':' + route.span;
    const deltaBefore = new Vector3().fromArray(before.positions, offset).sub(new Vector3().fromArray(startBefore, offset));
    const deltaAfter = new Vector3().fromArray(after.positions, offset).sub(new Vector3().fromArray(startAfter, offset));
    if (newMarks.has(id)) assert.ok(deltaBefore.dot(deltaAfter) < 0, id);
    else assert.ok(deltaBefore.distanceTo(deltaAfter) < 1e-8, id);
    offset += route.count * 3;
  }
  assert.deepEqual(after.settings.directions, before.settings.directions);
  before.dispose(); after.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

test('density changes the dot count on every actual wire without changing speed, direction, color, size, or buffers', () => {
  const scene = new Scene(), camera = new PerspectiveCamera(); camera.position.set(100, 100, 100);
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); scene.add(mesh);
  const groups = [...new Set(spans.map((span) => span.mesh))].map((name) => ({ key: name, name,
    routes: spans.filter((span) => span.mesh === name).map((span) => ({ ...routeOf(span), mesh })),
  }));
  const particles = new CurrentFlowParticles(scene, groups);
  particles.update(0.1, camera);
  const baseline = particles.geometry.drawRange.count, distances = new Map(particles.groupDistances);
  const buffer = particles.geometry.attributes.position;
  const counts = () => groups.map((group) => particles.routes.filter((route) => route.group === group).reduce((sum, route) => sum + route.count, 0));
  particles.setSettings({ ...particles.settings, density: 0.1 }); particles.update(0, camera);
  const low = counts(); assert.ok(particles.geometry.drawRange.count < baseline);
  particles.setSettings({ ...particles.settings, density: 3 }); particles.update(0, camera);
  const high = counts(); assert.ok(particles.geometry.drawRange.count > baseline);
  assert.equal(particles.geometry.drawRange.count, baseline * 3);
  assert.ok(high.every((count, index) => count > low[index]));
  assert.ok(particles.geometry.drawRange.count <= 4096);
  assert.equal(particles.geometry.attributes.position, buffer);
  assert.deepEqual(particles.groupDistances, distances);
  for (const key of ['speed', 'size', 'color', 'direction']) assert.equal(particles.settings[key], FLOW_DEFAULTS[key]);
  particles.setSettings(FLOW_DEFAULTS); particles.update(0, camera);
  assert.equal(particles.geometry.drawRange.count, baseline);
  particles.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

test('density migrates older settings, round-trips, validates limits, and respects the particle budget', () => {
  assert.equal(parseFlowSettings({ speed: 2 }).density, 1);
  assert.equal(parseFlowSettings(JSON.parse(JSON.stringify({ ...FLOW_DEFAULTS, density: 2.4 }))).density, 2.4);
  for (const density of [0, -1, 3.1, NaN, Infinity, null, '2']) {
    assert.throws(() => parseFlowSettings({ ...FLOW_DEFAULTS, density }));
  }
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const route = { ...routeOf(spans[0]), mesh };
  const effect = new CurrentFlowParticles(new Scene(), [{ key: 'Many Wires', routes: Array(5000).fill(route) }], { ...FLOW_DEFAULTS, density: 3 });
  assert.equal(effect.routes.length, 4096);
  assert.ok(effect.routes.reduce((sum, span) => sum + span.count, 0) <= 4096);
  assert.ok(effect.positions.length <= 4096 * 3);
  effect.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});
