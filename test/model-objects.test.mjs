import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { collectModelObjects } from '../src/model-objects.js';
import { MeshOpacityController } from '../src/mesh-opacity.js';
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

test('Transparency and Properties use the same original object names and one row per source node', () => {
  const { root, associations } = fixture();
  const opacity = Object.assign(Object.create(MeshOpacityController.prototype), { root, options: { associations } });
  opacity._collectMeshes();
  const annotation = Object.assign(Object.create(MeshAnnotationController.prototype), {
    root, associations, objectGroups: [], records: [], groupByObject: new Map(), recordByMesh: new Map(),
  });
  annotation._collectMeshes();
  assert.deepEqual(opacity.records.map((record) => record.name), ['Transformer.001', 'MainSupply_Wire']);
  assert.deepEqual(opacity.records.map((record) => record.name), annotation.objectGroups.map((group) => group.name));
  assert.equal(annotation.records.length, 4);
  assert.equal(opacity.records[0].meshes.length, 3);
  assert.ok(opacity.records[0].searchText.includes('transformer.001'));
});

test('one opacity slider changes every material part while preserving object color and neighbors', () => {
  const { root, parts, wire, associations, material } = fixture();
  const appearance = new MeshAppearanceController(root);
  const opacity = Object.assign(Object.create(MeshOpacityController.prototype), { root, options: { associations }, appearance });
  opacity._collectMeshes();
  appearance.setColor(parts, '#00ff00');
  opacity._setOpacity(opacity.records[0], 25);
  for (const part of parts) {
    assert.equal(part.material.opacity, 0.25);
    assert.equal(part.material.color.getHexString(), '00ff00');
  }
  assert.equal(wire.material, material);
  assert.equal(wire.material.opacity, 1);
  opacity.restoreAll();
  for (const part of parts) {
    assert.equal(part.material.opacity, 1);
    assert.equal(part.material.color.getHexString(), '00ff00');
  }
  appearance.dispose();
});

test('distinct source objects are retained even when their display names are identical', () => {
  const { root, associations } = fixture();
  const duplicate = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  duplicate.name = 'MainSupply_Wire'; root.add(duplicate); associations.set(duplicate, { nodes: 2 });
  assert.equal(collectModelObjects(root, associations).length, 3);
});
