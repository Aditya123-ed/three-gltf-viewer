import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { collectHouseObjects, HouseGeometryController } from '../src/house-geometry.js';
import { collectEnvironmentObjects, collectEnvironmentMeshGroups, EnvironmentVisibilityController } from '../src/environment-visibility.js';
import { collectModelObjects, isObjectVisible } from '../src/model-objects.js';
import { MeshAppearanceController } from '../src/mesh-appearance.js';
import { collectMeshVideoBindings } from '../src/mesh-videos.js';

const currentExport = JSON.parse(fs.readFileSync(new URL('./fixtures/client-collection-objects.json', import.meta.url)));

function exportedFixture() {
  const root = new Group(), associations = new Map(), material = new MeshStandardMaterial({ color: '#123456' });
  root.name = 'Scene';
  currentExport.objects.forEach((source, nodes) => {
    const object = new Group(); object.name = source.name.replace(/[ .]/g, '_'); object.userData.name = source.name;
    root.add(object); associations.set(object, { nodes });
    for (let primitives = 0; primitives < source.parts; primitives++) {
      const mesh = new Mesh(new BoxGeometry(), material); object.add(mesh); associations.set(mesh, { meshes: nodes, primitives });
    }
  });
  return { root, associations, material };
}

function houseControls(root, modelKey = '/models/client.glb', viewer = {}) {
  const objects = collectHouseObjects(root, modelKey);
  return Object.assign(Object.create(HouseGeometryController.prototype), {
    viewer: { invalidateShadows() {}, ...viewer }, objects,
    originalVisibility: new Map(objects.map((object) => [object, object.visible])), enabledInput: {}, storageKey: 'test-house-visible',
  });
}

function environmentControls(root, associations) {
  const objects = collectEnvironmentObjects(root, '/models/client.glb');
  const groups = collectEnvironmentMeshGroups(root, objects, associations);
  return Object.assign(Object.create(EnvironmentVisibilityController.prototype), {
    viewer: { invalidateShadows() {} }, objects, groups,
    originalVisibility: new Map([...objects, ...groups.map((group) => group.object)].map((object) => [object, object.visible])),
    objectVisibility: new Map(groups.map((group) => [group.object, true])), objectInputs: new Map(),
    count: {}, help: {}, enabledInput: {},
  });
}

test('the revised Drive export has four Environment rows and a separate whole-house group', () => {
  const { root, associations } = exportedFixture();
  const environment = collectEnvironmentObjects(root, '/models/client.glb');
  const houses = collectHouseObjects(root, '/models/client.glb');
  assert.equal(collectModelObjects(root, associations).length, 54);
  assert.equal(root.children.reduce((sum, object) => sum + object.children.length, 0), 241);
  assert.deepEqual(collectEnvironmentMeshGroups(root, environment, associations).map((group) => group.name), ['Railling', 'Base_Grass', 'Base_Sand', 'Road']);
  assert.equal(houses.length, 13);
  assert.equal(houses.reduce((sum, object) => sum + object.children.length, 0), 18);
  assert.ok(houses.every((object) => !environment.includes(object)));
  assert.equal(root.children.filter((object) => !houses.includes(object) && !environment.includes(object)).length, 37);
  const videos = collectMeshVideoBindings(root, '/models/client.glb', associations);
  assert.equal(videos.length, 1); assert.equal(videos[0].meshes.length, 13);
  assert.deepEqual(collectHouseObjects(root, 'unrelated.glb'), []);
});

test('HOUSE GEO and Environment switch independently, preserving materials, source grouping, and selection behavior', () => {
  const { root, associations } = exportedFixture();
  const appearance = new MeshAppearanceController(root), environment = environmentControls(root, associations);
  let clearCount = 0, invalidations = 0;
  const house = houseControls(root, '/models/client.glb', {
    invalidateShadows() { invalidations++; }, clearSelectedMesh() { clearCount++; this.selectedMesh = null; },
  });
  const part = house.objects[0].children[0], originalParent = part.parent;
  house.viewer.selectedMesh = part;
  appearance.setColor([part], '#ff0000'); appearance.setOpacity(part, 35);
  environment.setEnabled(false, false); house.setEnabled(true, false);
  assert.ok(house.objects.every(isObjectVisible));
  assert.ok(environment.objects.every((object) => !isObjectVisible(object)));
  house.setEnabled(false, false);
  assert.ok(house.objects.every((object) => !isObjectVisible(object)));
  assert.equal(clearCount, 1);
  environment.setEnabled(true, false);
  assert.ok(environment.objects.every(isObjectVisible));
  assert.ok(house.objects.every((object) => !isObjectVisible(object)));
  house.setEnabled(true, false);
  assert.ok(house.objects.every(isObjectVisible));
  const station = root.children.filter((object) => !house.objects.includes(object) && !environment.objects.includes(object));
  assert.ok(station.every(isObjectVisible));
  assert.equal(part.material.color.getHexString(), 'ff0000'); assert.equal(part.material.opacity, 0.35);
  assert.equal(part.parent, originalParent); assert.equal(invalidations, 3);
  assert.equal(collectModelObjects(root, associations).length, 54);
  appearance.dispose();
});

test('named house collections retain nested membership and take precedence over flattened-file names', () => {
  const root = new Group(), house = new Group(), nested = new Group(), environment = new Group();
  house.name = 'HOUSE_GEO'; nested.name = 'House Geometry'; environment.name = 'Enviroenment';
  const roof = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); roof.name = 'New roof';
  const hidden = roof.clone(); hidden.name = 'Hidden detail'; hidden.visible = false;
  nested.add(roof, hidden); house.add(nested); root.add(house, environment);
  const road = roof.clone(); road.name = 'Future Road'; environment.add(road);
  const outsider = roof.clone(); outsider.name = 'Wall'; root.add(outsider);
  assert.deepEqual(collectHouseObjects(root, '/models/client.glb'), [house]);
  assert.deepEqual(collectEnvironmentObjects(root, 'dropped.glb'), [environment]);
  const controls = houseControls(root, 'dropped.glb');
  controls.setEnabled(false, false);
  assert.equal(isObjectVisible(roof), false); assert.equal(isObjectVisible(road), true); assert.equal(outsider.visible, true);
  controls.setEnabled(true, false);
  assert.equal(isObjectVisible(roof), true); assert.equal(isObjectVisible(hidden), false);
  assert.equal(roof.parent, nested);
});

test('HOUSE GEO saves its switch, restores original flags on disposal, and safely disables when absent', () => {
  const { root } = exportedFixture(), controls = houseControls(root), writes = new Map(), oldWindow = globalThis.window;
  globalThis.window = { localStorage: { setItem: (key, value) => writes.set(key, value) } };
  try {
    controls.setEnabled(false); assert.equal(writes.get('test-house-visible'), 'false');
    assert.equal(controls.enabledInput.checked, false);
    let removed = 0;
    controls.layoutRegistration = { unregister() { removed++; } }; controls.toolbar = { remove() { removed++; } };
    controls.dispose(); controls.dispose();
    assert.ok(controls.objects.every((object) => object.visible)); assert.equal(removed, 2);
    const missing = houseControls(new Group(), 'empty.glb'); missing.setEnabled(true, false);
    assert.equal(missing.enabledInput.disabled, true); assert.equal(missing.enabledInput.checked, false);
  } finally { globalThis.window = oldWindow; }
});

test('old per-object Environment choices keep working and the newly added Road defaults to visible', () => {
  const { root, associations } = exportedFixture(), controls = environmentControls(root, associations);
  controls.storageKey = 'test-environment';
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => JSON.stringify([{ path: 'Scene / Base_Grass', visible: false }]) } };
  try {
    controls._loadObjectVisibility(); controls.setEnabled(true, false);
    const road = controls.groups.find((group) => group.name === 'Road');
    const grass = controls.groups.find((group) => group.name === 'Base_Grass');
    assert.equal(isObjectVisible(road.object), true); assert.equal(isObjectVisible(grass.object), false);
    controls.setEnabled(false, false); controls.setEnabled(true, false);
    assert.equal(isObjectVisible(road.object), true); assert.equal(isObjectVisible(grass.object), false);
  } finally { globalThis.window = oldWindow; }
});
