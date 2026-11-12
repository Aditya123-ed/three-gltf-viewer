import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Group, Mesh, BoxGeometry, MeshStandardMaterial, MeshPhysicalMaterial, Texture } from 'three';
import { MeshAppearanceController } from '../src/mesh-appearance.js';
import { ObjectColorController } from '../src/object-colors.js';
import { MeshAnnotationController } from '../src/mesh-annotations.js';

function fixture() {
  const root = new Scene();
  const a = new Group(); a.name = 'Transformer';
  const b = new Group(); b.name = 'Pillar';
  const material = new MeshPhysicalMaterial({ color: '#123456', map: new Texture(), vertexColors: true,
    transmission: 0.8, transparent: true, opacity: 0.6, metalness: 1 });
  const parts = [new Mesh(new BoxGeometry(), material), new Mesh(new BoxGeometry(), [material, material])];
  a.add(...parts);
  const neighbor = new Mesh(new BoxGeometry(), material); b.add(neighbor);
  root.add(a, b);
  return { root, a, b, parts, neighbor, material, appearance: new MeshAppearanceController(root) };
}

test('solid color covers every material slot, removes textures, and isolates shared materials', () => {
  const { parts, neighbor, material, appearance } = fixture();
  appearance.setColor(parts, '#00FF88');
  for (const mesh of parts) {
    for (const paint of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      assert.equal(paint.color.getHexString(), '00ff88');
      assert.equal(paint.map, null);
      assert.equal(paint.vertexColors, false);
      assert.equal(paint.metalness, 0);
      assert.equal(paint.opacity, 1);
      assert.notEqual(paint, material);
    }
  }
  assert.equal(neighbor.material, material);
  assert.equal(material.color.getHexString(), '123456');
  assert.notEqual(material.map, null);
});

test('color and transparency survive independent resets in either order', () => {
  const { parts: [mesh], material, appearance } = fixture();
  appearance.setOpacity(mesh, 40);
  assert.equal(mesh.material.opacity, 0.24);
  appearance.setColor([mesh], '#ff0000');
  assert.equal(mesh.material.opacity, 0.4);
  appearance.setOpacity(mesh, 100);
  assert.equal(mesh.material.color.getHexString(), 'ff0000');
  assert.equal(mesh.material.opacity, 1);
  appearance.setOpacity(mesh, 40);
  appearance.setColor([mesh], null);
  assert.equal(mesh.material.color.getHexString(), '123456');
  assert.equal(mesh.material.map, material.map);
  assert.equal(mesh.material.opacity, 0.24);
  appearance.setOpacity(mesh, 100);
  assert.equal(mesh.material, material);
});

test('repeated painting and model disposal release temporary materials without disposing textures', () => {
  const { parts, material, appearance } = fixture();
  let disposed = 0;
  let textureDisposed = 0;
  material.map.addEventListener('dispose', () => textureDisposed++);
  appearance.setColor(parts, '#ff0000');
  parts[0].material.addEventListener('dispose', () => disposed++);
  appearance.setColor(parts, '#0000ff');
  assert.equal(disposed, 1);
  appearance.dispose();
  assert.equal(parts[0].material, material);
  assert.deepEqual(parts[1].material, [material, material]);
  assert.equal(textureDisposed, 0);
  assert.throws(() => appearance.setColor([], 'invalid'));
});

test('JSON colors remap after object order changes and do not guess duplicate names', () => {
  const a = { name: 'Transformer', object: { path: 'Transformer[24]' } };
  const b = { name: 'Pillar', object: { path: 'Pillar[2]' } };
  const c = { name: 'Pillar', object: { path: 'Pillar[3]' } };
  const colors = Object.assign(Object.create(ObjectColorController.prototype), {
    groups: [a, b, c], pathOf: (object) => object.path,
  });
  const parsed = colors.parse([
    { objectName: 'Transformer', path: 'Transformer[31]', color: '#AABBCC' },
    { objectName: 'Pillar', path: 'Pillar[99]', color: '#112233' },
    { objectName: 'Missing', path: 'Missing[0]', color: null },
  ]);
  assert.equal(parsed.colors.get(a), '#aabbcc');
  assert.equal(parsed.colors.size, 1);
  assert.equal(parsed.unmatched, 2);
  assert.throws(() => colors.parse([{ objectName: 'Transformer', path: 'Transformer[24]', color: 'red' }]));
});

test('browser color choices and original resets override asynchronously loaded shared colors', () => {
  const { a, parts, appearance } = fixture();
  const group = { name: a.name, object: a, records: parts.map((mesh) => ({ mesh })) };
  const colors = Object.assign(Object.create(ObjectColorController.prototype), {
    groups: [group], pathOf: () => 'Transformer[0]', appearance,
    local: new Map([[group, '#0000ff']]), shared: new Map(),
    setSelection() {}, onChange() {},
  });
  colors.loadShared([{ objectName: 'Transformer', path: 'Transformer[0]', color: '#ff0000' }]);
  assert.equal(parts[0].material.color.getHexString(), '0000ff');
  colors.local.set(group, null);
  colors._applyAll();
  assert.equal(parts[0].material.color.getHexString(), '123456');
  assert.equal(colors.exportEntries()[0].color, null);
});

test('Restore All restores all original material colours, preserves transparency, and persists across shared loads', () => {
  const { a, b, parts, neighbor, material, appearance } = fixture();
  const first = { name: a.name, object: a, records: parts.map((mesh) => ({ mesh })) };
  const second = { name: b.name, object: b, records: [{ mesh: neighbor }] };
  const writes = new Map(), oldWindow = globalThis.window;
  globalThis.window = { localStorage: { setItem: (key, value) => writes.set(key, value) } };
  let changes = 0;
  const colors = Object.assign(Object.create(ObjectColorController.prototype), {
    groups: [first, second], pathOf: (object) => object.name + '[0]', appearance,
    local: new Map([[first, '#ff0000']]), shared: new Map([[second, '#00ff00']]), activeGroup: null,
    storageKey: 'test-restore-all-colours', message: {}, setSelection() {}, onChange() { changes++; },
  });
  try {
    colors._applyAll();
    parts.forEach((mesh) => appearance.setOpacity(mesh, 40));
    appearance.setOpacity(neighbor, 70);
    colors.restoreAll();
    assert.equal(changes, 1);
    const checkOriginal = () => {
      for (const mesh of [...parts, neighbor]) {
        for (const restored of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          assert.equal(restored.color.getHexString(), '123456');
          assert.equal(restored.map, material.map);
          assert.equal(restored.metalness, 1);
          assert.equal(restored.opacity, mesh === neighbor ? 0.42 : 0.24);
        }
        assert.equal(appearance.getOpacity(mesh), mesh === neighbor ? 70 : 40);
      }
    };
    checkOriginal();
    const saved = JSON.parse(writes.get(colors.storageKey));
    assert.equal(saved.length, 2);
    assert.ok(saved.every((entry) => entry.color === null));
    assert.ok(colors.exportEntries().every((entry) => entry.color === null));
    colors.loadShared([{ objectName: 'Pillar', path: 'Pillar[0]', color: '#aabbcc' }]);
    checkOriginal();
    // Read the saved reset entries just as a fresh controller does on reload.
    colors.local = colors.parse(saved).colors;
    colors._applyAll();
    checkOriginal();
    assert.equal(material.opacity, 0.6);
    assert.equal(material.color.getHexString(), '123456');
  } finally {
    appearance.dispose();
    globalThis.window = oldWindow;
  }
});

test('color-only exports are enabled without creating annotation labels', () => {
  const controller = Object.assign(Object.create(MeshAnnotationController.prototype), {
    objectGroups: [], annotatedRecords: [], annotations: {}, countLabel: {}, exportButton: {},
    colorController: { exportEntries: () => [{ color: '#112233' }] },
  });
  controller._updateCounts();
  assert.equal(controller.exportButton.disabled, false);
  assert.deepEqual(controller.annotations, {});
});
