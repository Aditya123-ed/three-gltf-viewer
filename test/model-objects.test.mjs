import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { collectModelObjects } from '../src/model-objects.js';
import { ObjectTransparencyController } from '../src/object-transparency.js';
import { MeshAnnotationController } from '../src/mesh-annotations.js';
import { MeshAppearanceController } from '../src/mesh-appearance.js';

function fixture() {
  const root = new Group(); root.name = 'Scene';
  const object = new Group(); object.name = 'Transformer001'; object.userData.name = 'Transformer.001';
  const material = new MeshStandardMaterial({ color: '#888888' });
  const parts = [0, 1, 2].map((i) => {
    const mesh = new Mesh(new BoxGeometry(), material); mesh.name = 'material_part_' + i; object.add(mesh); return mesh;
  });
  const wire = new Mesh(new BoxGeometry(), material); wire.name = 'MainSupply_Wire';
  root.add(object, wire);
  const associations = new Map([[object, { nodes: 0 }], [wire, { nodes: 1 }]]);
  parts.forEach((part, i) => associations.set(part, { meshes: 0, primitives: i }));
  return { root, object, parts, wire, associations, material };
}

test('Properties keeps original object names and one row per source node for color and transparency', () => {
  const { root, associations } = fixture();
  const annotation = Object.assign(Object.create(MeshAnnotationController.prototype), {
    root, associations, objectGroups: [], records: [], groupByObject: new Map(), recordByMesh: new Map(),
  });
  annotation._collectMeshes();
  assert.deepEqual(annotation.objectGroups.map((group) => group.name), ['Transformer.001', 'MainSupply_Wire']);
  assert.deepEqual(collectModelObjects(root, associations).map((group) => group.name), annotation.objectGroups.map((group) => group.name));
  assert.equal(annotation.records.length, 4);
  assert.equal(annotation.objectGroups[0].meshes.length, 3);
  assert.ok(annotation.objectGroups[0].displayPath.includes('Transformer.001'));
});

function transparencyControls(groups, appearance) {
  return Object.assign(Object.create(ObjectTransparencyController.prototype), {
    groups, appearance, activeGroup: null, input: { setAttribute() {} }, value: {}, hint: {}, resetButton: {}, restoreButton: {},
  });
}

test('the selected transparency slider changes every material part while preserving color and neighbors', () => {
  const { root, parts, wire, associations, material } = fixture();
  const appearance = new MeshAppearanceController(root);
  const groups = collectModelObjects(root, associations);
  const controls = transparencyControls(groups, appearance);
  controls.setSelection(groups[0]);
  appearance.setColor(parts, '#00ff00');
  controls.setTransparency(75);
  for (const part of parts) {
    assert.equal(part.material.opacity, 0.25);
    assert.equal(part.material.color.getHexString(), '00ff00');
  }
  assert.equal(wire.material, material);
  assert.equal(wire.material.opacity, 1);
  controls.restoreAll();
  for (const part of parts) {
    assert.equal(part.material.opacity, 1);
    assert.equal(part.material.color.getHexString(), '00ff00');
  }
  appearance.dispose();
});

test('transparency follows selection, keeps each object value, and resets independently of solid color', () => {
  const { root, parts, wire, associations } = fixture();
  const appearance = new MeshAppearanceController(root);
  const groups = collectModelObjects(root, associations);
  const controls = transparencyControls(groups, appearance);
  controls.setSelection(null);
  assert.equal(controls.input.disabled, true);
  controls.setSelection(groups[0]);
  controls.setTransparency(75);
  appearance.setColor(parts, '#00ff00');
  controls.setSelection(groups[1]);
  assert.equal(controls.input.value, '0');
  controls.setTransparency(50);
  controls.setSelection(groups[0]);
  assert.equal(controls.input.value, '75');
  assert.equal(controls.value.textContent, '75%');
  controls.setTransparency(0);
  assert.equal(parts[0].material.opacity, 1);
  assert.equal(parts[0].material.color.getHexString(), '00ff00');
  assert.equal(wire.material.opacity, 0.5);
  controls.setSelection(null);
  controls.setTransparency(100);
  assert.equal(wire.material.opacity, 0.5);
  assert.equal(controls.input.disabled, true);
  controls.restoreAll();
  assert.equal(wire.material.opacity, 1);
  assert.equal(parts[0].material.color.getHexString(), '00ff00');
  assert.equal(controls.restoreButton.disabled, true);
  appearance.dispose();
});

test('distinct source objects are retained even when their display names are identical', () => {
  const { root, associations } = fixture();
  const duplicate = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  duplicate.name = 'MainSupply_Wire'; root.add(duplicate); associations.set(duplicate, { nodes: 2 });
  assert.equal(collectModelObjects(root, associations).length, 3);
});
