import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, TubeGeometry, Vector3 } from 'three';
import { extractWireRoutes } from '../src/wire-routes.js';
import { collectFlowWires, CurrentFlowParticles, FLOW_DEFAULTS, parseFlowSettings } from '../src/current-flow-particles.js';
import { CurrentFlowController } from '../src/current-flow.js';
import { MeshAppearanceController } from '../src/mesh-appearance.js';
import { MeshAnnotationController } from '../src/mesh-annotations.js';

function fixture() {
  const scene = new Scene(), root = new Group();
  const curve = new CatmullRomCurve3([new Vector3(0, 3, 0), new Vector3(4, 1, 0), new Vector3(9, 3, 0)]);
  const wire = new Mesh(new TubeGeometry(curve, 24, 0.05, 6, false), new MeshStandardMaterial({ color: '#888888' }));
  wire.name = 'Cable'; root.add(wire); root.position.set(-6, 1, 3); scene.add(root);
  const camera = new PerspectiveCamera(60, 1, 0.01, 1000); camera.position.set(0, 10, 20);
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const groups = collectFlowWires(root);
  const particles = new CurrentFlowParticles(scene, groups);
  return { scene, root, wire, curve, groups, particles, camera };
}

test('recovers a sagging tube centerline across the UV seam without changing the wire', () => {
  const { wire, curve, groups, particles } = fixture();
  const before = wire.geometry.attributes.position.array.slice();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].routes.length, 1);
  const route = groups[0].routes[0];
  assert.ok(route.length > 9);
  assert.ok(Math.abs(route.radius - 0.05) < 0.01);
  assert.ok(Math.min(...route.points.map((p) => p.y)) < 1.15);
  assert.ok(route.points[0].distanceTo(curve.getPoint(0)) < 0.01);
  assert.ok(route.points.at(-1).distanceTo(curve.getPoint(1)) < 0.01);
  assert.deepEqual(wire.geometry.attributes.position.array, before);
  const nonIndexed = wire.geometry.toNonIndexed();
  assert.equal(extractWireRoutes(nonIndexed).length, 1);
  assert.equal(extractWireRoutes(new BoxGeometry()).length, 0);
  particles.dispose();
});

test('detects disconnected cable spans independently and skips closed tubes', () => {
  const curve = new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(4, -1, 0), new Vector3(9, 0, 0)]);
  const first = new TubeGeometry(curve, 20, 0.04, 5, false).toNonIndexed();
  const second = first.clone().translate(0, 0, 3);
  const combined = new BufferGeometry();
  combined.setAttribute('position', new Float32BufferAttribute([
    ...first.attributes.position.array, ...second.attributes.position.array,
  ], 3));
  assert.equal(extractWireRoutes(combined).length, 2);
  const loop = new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(3, 0, 0), new Vector3(3, 0, 3), new Vector3(0, 0, 3)], true);
  assert.equal(extractWireRoutes(new TubeGeometry(loop, 32, 0.1, 6, true)).length, 0);
});

test('moves with time, reverses continuously, and freezes while switched off', () => {
  const { particles, camera } = fixture();
  particles.update(0, camera); const original = particles.positions.slice();
  particles.update(0.1, camera);
  assert.notDeepEqual(particles.positions, original);
  assert.equal(particles.distance, 0.1);
  particles.setSettings({ ...FLOW_DEFAULTS, direction: 'reverse' });
  particles.update(0.1, camera);
  assert.ok(Math.abs(particles.distance) < 1e-10);
  for (let i = 0; i < original.length; i++) assert.ok(Math.abs(particles.positions[i] - original[i]) < 1e-5);
  particles.setSettings({ ...FLOW_DEFAULTS, enabled: false });
  particles.update(0.1, camera);
  assert.equal(particles.effectRoot.visible, false);
  assert.ok(Math.abs(particles.distance) < 1e-10);
  particles.dispose();
});

test('speed, color and size update independently of the original material and Properties content', () => {
  const { scene, root, wire, particles, camera } = fixture();
  const original = wire.material;
  particles.setSettings({ ...FLOW_DEFAULTS, speed: 3, color: '#ff2200', size: 11 });
  particles.update(0.1, camera);
  assert.ok(Math.abs(particles.distance - 0.3) < 1e-10);
  assert.equal(particles.material.color.getHexString(), 'ff2200');
  assert.equal(particles.material.size, 11);
  assert.equal(wire.material, original);
  assert.equal(root.children.length, 1);
  assert.equal(particles.effectRoot.parent, scene);
  assert.equal(particles.points.castShadow, false);
  assert.equal(particles.material.depthTest, true);
  const appearance = new MeshAppearanceController(root);
  appearance.setColor([wire], '#00ff00');
  particles.update(0, camera);
  assert.ok(particles.geometry.drawRange.count > 0);
  assert.equal(particles.material.color.getHexString(), 'ff2200');
  appearance.setOpacity(wire, 0);
  particles.update(0, camera);
  assert.equal(particles.geometry.drawRange.count, 0);
  appearance.setOpacity(wire, 100);
  particles.update(0, camera);
  assert.ok(particles.geometry.drawRange.count > 0);
  appearance.dispose(); particles.dispose();
});

test('particle routes follow model transforms and honor wire group selection and visibility', () => {
  const { root, wire, groups, particles, camera } = fixture();
  particles.update(0, camera); const before = particles.routes[0].curve.getPointAt(0.5);
  root.position.x += 20; particles.update(0, camera);
  const after = particles.routes[0].curve.getPointAt(0.5);
  assert.ok(Math.abs(after.x - before.x - 20) < 1e-8);
  particles.setSettings({ ...FLOW_DEFAULTS, groups: { [groups[0].key]: false } });
  particles.update(0, camera); assert.equal(particles.geometry.drawRange.count, 0);
  particles.setSettings(FLOW_DEFAULTS); root.visible = false;
  particles.update(0, camera); assert.equal(particles.geometry.drawRange.count, 0);
  root.visible = true; wire.material.visible = false;
  particles.update(0, camera); assert.equal(particles.geometry.drawRange.count, 0);
  particles.dispose(); assert.equal(particles.effectRoot.parent, null);
});

test('flow settings round-trip and reject invalid imported values', () => {
  const configured = { enabled: false, speed: 2.3, direction: 'reverse', color: '#AABBCC', size: 8, groups: { Cable: false } };
  const parsed = parseFlowSettings(JSON.parse(JSON.stringify(configured)));
  assert.equal(parsed.color, '#aabbcc'); assert.equal(parsed.groups.Cable, false);
  for (const patch of [{ speed: NaN }, { speed: 0 }, { size: 100 }, { color: 'red' }, { direction: 'sideways' }, { enabled: 'yes' }, { groups: { Cable: 1 } }]) {
    assert.throws(() => parseFlowSettings({ ...FLOW_DEFAULTS, ...patch }));
  }
  const writes = new Map();
  globalThis.window = { localStorage: { setItem: (key, value) => writes.set(key, value) } };
  const controller = Object.assign(Object.create(CurrentFlowController.prototype), {
    settings: parsed, storageKey: 'test-flow', message: {},
  });
  controller._save();
  assert.deepEqual(JSON.parse(writes.get('test-flow')), JSON.parse(JSON.stringify(parsed)));
  assert.equal(controller.hasLocalSettings, true);
  controller.loadSharedSettings({ speed: 1 });
  assert.equal(controller.settings.speed, 2.3);
  delete globalThis.window;
});

test('Properties exports flow settings even when no annotations or colors exist', async () => {
  const originalDocument = globalThis.document;
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  let exported;
  globalThis.document = { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) };
  globalThis.window = { setTimeout: (callback) => callback() };
  URL.createObjectURL = (blob) => { exported = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    const controller = Object.assign(Object.create(MeshAnnotationController.prototype), {
      annotations: {}, modelKey: 'model', _setStatus() {},
      flowController: { hasRoutes: true, exportSettings: () => ({ ...FLOW_DEFAULTS, speed: 2.5, density: 1.8 }) },
    });
    controller.exportAnnotations();
    const payload = JSON.parse(await exported.text());
    assert.deepEqual(payload.annotations, []);
    assert.equal(payload.currentFlow.speed, 2.5);
    assert.equal(payload.currentFlow.density, 1.8);
    assert.equal(payload.format, 'three-gltf-viewer-annotations');
  } finally {
    globalThis.document = originalDocument;
    delete globalThis.window;
    URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
  }
});

test('each wire reverses independently without changing another wire or shared appearance settings', () => {
  const { scene, root, wire, particles: first, camera } = fixture();
  first.dispose();
  const second = wire.clone(); second.name = 'Second_Wire'; second.position.z = 3; root.add(second);
  const groups = collectFlowWires(root);
  const particles = new CurrentFlowParticles(scene, groups);
  particles.update(0, camera);
  particles.update(0.1, camera);
  const before = particles.positions.slice();
  particles.setSettings({ ...FLOW_DEFAULTS, color: '#00ccff', size: 9, directions: { Cable: 'reverse', Second_Wire: 'forward' } });
  particles.update(0, camera);
  assert.deepEqual(particles.positions, before, 'changing direction must not jump the particles');
  particles.update(0.1, camera);
  assert.ok(Math.abs(particles.groupDistances.get('Cable')) < 1e-10);
  assert.ok(Math.abs(particles.groupDistances.get('Second_Wire') - 0.2) < 1e-10);
  assert.equal(particles.material.color.getHexString(), '00ccff');
  assert.equal(particles.material.size, 9);
  particles.setSettings({ ...particles.settings, speed: 4 });
  particles.update(0.1, camera);
  assert.ok(Math.abs(particles.groupDistances.get('Cable') + 0.4) < 1e-10);
  assert.ok(Math.abs(particles.groupDistances.get('Second_Wire') - 0.6) < 1e-10);
  particles.dispose();
});

test('per-wire directions survive export/import, honor legacy defaults, and reject malformed values', () => {
  const settings = parseFlowSettings({ ...FLOW_DEFAULTS, direction: 'reverse', directions: { Cable: 'forward', Second_Wire: 'reverse' } });
  const controller = Object.assign(Object.create(CurrentFlowController.prototype), {
    settings, groups: [{ key: 'Cable' }, { key: 'Second_Wire' }, { key: 'Third_Wire' }],
  });
  const exported = controller.exportSettings();
  assert.equal(exported.directions.Cable, 'forward');
  assert.equal(exported.directions.Third_Wire, 'reverse');
  const restored = parseFlowSettings(JSON.parse(JSON.stringify(exported)));
  assert.equal(restored.directions.Second_Wire, 'reverse');
  for (const directions of [null, [], 'reverse', { Cable: true }, { Cable: 'up' }]) {
    assert.throws(() => parseFlowSettings({ ...FLOW_DEFAULTS, directions }));
  }
});

test('wire clamps stay in the object list and are excluded from flow candidates', () => {
  const { root, wire, particles } = fixture();
  const clamp = wire.clone(); clamp.name = 'Wire_Clamps'; root.add(clamp);
  assert.deepEqual(collectFlowWires(root).map((group) => group.name), ['Cable']);
  particles.dispose();
});
