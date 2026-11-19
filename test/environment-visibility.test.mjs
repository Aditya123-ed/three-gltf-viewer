import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { collectEnvironmentObjects, EnvironmentVisibilityController } from '../src/environment-visibility.js';
import { collectModelObjects, isObjectVisible } from '../src/model-objects.js';
import { MeshAppearanceController } from '../src/mesh-appearance.js';

function mesh(name) {
  const object = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: '#123456' }));
  object.name = name;
  return object;
}

test('a named environment collection controls all descendants and keeps their hierarchy and hidden state', () => {
  const root = new Group(), collection = new Group(), nested = new Group();
  collection.userData.name = 'Enviroenment'; nested.name = 'Environment';
  const grass = mesh('Ground'), railing = mesh('Fence'), station = mesh('Transformer');
  railing.visible = false;
  nested.add(railing); collection.add(grass, nested); root.add(collection, station);
  assert.deepEqual(collectEnvironmentObjects(root, 'uploaded.glb'), [collection]);
  const controls = controlsFor(root, 'uploaded.glb');
  controls.setEnabled(false, false);
  assert.equal(isObjectVisible(grass), false);
  assert.equal(isObjectVisible(railing), false);
  assert.equal(isObjectVisible(station), true);
  controls.setEnabled(true, false);
  assert.equal(isObjectVisible(grass), true);
  assert.equal(isObjectVisible(railing), false);
  assert.equal(grass.parent, collection);
  assert.equal(railing.parent, nested);
});

function controlsFor(root, key, viewer = {}) {
  const objects = collectEnvironmentObjects(root, key);
  return Object.assign(Object.create(EnvironmentVisibilityController.prototype), {
    viewer: { invalidateShadows() {}, ...viewer }, objects,
    originalVisibility: new Map(objects.map((object) => [object, object.visible])),
    enabledInput: {}, storageKey: 'test-environment',
  });
}

test('the current flattened client GLB uses only its three verified environment source objects', () => {
  const root = new Group();
  const railing = new Group(); railing.name = 'Railling'; railing.add(mesh('material_part_0'), mesh('material_part_1'));
  const grass = mesh('Base_Grass'), sand = mesh('Base_Sand'), station = mesh('Support Pillar.007_baked');
  const wire = mesh('MainSupply_Wire');
  root.add(railing, grass, sand, station, wire);
  const associations = new Map(root.children.map((object, nodes) => [object, { nodes }]));
  const groupsBefore = collectModelObjects(root, associations);
  assert.deepEqual(collectEnvironmentObjects(root, '/models/client.glb'), [railing, grass, sand]);
  // Similar object names in an unrelated upload do not establish collection membership.
  assert.deepEqual(collectEnvironmentObjects(root, 'other.glb'), []);
  const appearance = new MeshAppearanceController(root);
  appearance.setColor([grass], '#ff0000'); appearance.setOpacity(grass, 40);
  let invalidations = 0, cleared = 0;
  const controls = controlsFor(root, '/models/client.glb', {
    selectedMesh: railing.children[0], invalidateShadows() { invalidations++; },
    clearSelectedMesh() { cleared++; this.selectedMesh = null; },
  });
  const grassMaterial = grass.material, grassGeometry = grass.geometry;
  controls.setEnabled(false, false);
  assert.equal(controls.enabledInput.checked, false);
  assert.equal(cleared, 1);
  for (const object of [railing.children[0], railing.children[1], grass, sand]) assert.equal(isObjectVisible(object), false);
  assert.equal(isObjectVisible(station), true);
  assert.equal(isObjectVisible(wire), true);
  controls.setEnabled(true, false);
  assert.equal(invalidations, 2);
  assert.equal(controls.enabledInput.checked, true);
  assert.equal(grass.material, grassMaterial);
  assert.equal(grass.geometry, grassGeometry);
  assert.equal(grass.material.color.getHexString(), 'ff0000');
  assert.equal(appearance.getOpacity(grass), 40);
  assert.equal(grass.material.opacity, 0.4);
  assert.deepEqual(collectModelObjects(root, associations), groupsBefore);
  appearance.dispose();
});

test('visibility saves per model and restores original flags on disposal', () => {
  const root = new Group(), collection = new Group(); collection.name = 'Environment';
  root.add(collection);
  const controls = controlsFor(root, 'drop.glb'), writes = new Map(), oldWindow = globalThis.window;
  globalThis.window = { localStorage: { setItem(key, value) { writes.set(key, value); } } };
  try {
    controls.setEnabled(false);
    assert.equal(writes.get('test-environment'), 'false');
    controls.setEnabled(true);
    assert.equal(writes.get('test-environment'), 'true');
    controls.setEnabled(false, false);
    let removed = 0;
    controls.layoutRegistration = { unregister() { removed++; } };
    controls.toolbar = { remove() { removed++; } };
    controls.dispose(); controls.dispose();
    assert.equal(collection.visible, true);
    assert.equal(removed, 2);
    controls.setEnabled(false);
    assert.equal(collection.visible, true);
  } finally { globalThis.window = oldWindow; }
});

test('missing collections disable the checkbox without hiding any unrelated content', () => {
  const root = new Group(), station = mesh('Transformer'); root.add(station);
  const controls = controlsFor(root, '/models/client.glb');
  controls.setEnabled(false, false);
  assert.equal(controls.enabledInput.disabled, true);
  assert.equal(controls.enabledInput.checked, false);
  assert.equal(isObjectVisible(station), true);
  assert.equal(isObjectVisible(null), false);
});
