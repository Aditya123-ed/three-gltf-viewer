import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { collectMeshVideoBindings, MeshVideoController, TRANSFORMER_VIDEO, vimeoEmbedUrl } from '../src/mesh-videos.js';

function fixture() {
  const root = new Group(), transformer = new Group(), original = new MeshStandardMaterial({ color: '#123456' });
  transformer.name = 'Loader_sanitized_name'; transformer.userData.name = TRANSFORMER_VIDEO.objectName;
  const parts = [0, 1, 2].map((i) => {
    const mesh = new Mesh(new BoxGeometry(), original); mesh.name = 'primitive_' + i; transformer.add(mesh); return mesh;
  });
  const neighbor = new Mesh(new BoxGeometry(), original); neighbor.name = TRANSFORMER_VIDEO.objectName + '.002';
  root.add(transformer, neighbor);
  const associations = new Map([[transformer, { nodes: 12 }], [neighbor, { nodes: 22 }]]);
  parts.forEach((mesh, primitives) => associations.set(mesh, { meshes: 12, primitives }));
  return { root, transformer, parts, neighbor, associations, original };
}

test('the video binds only to the exact transformer source object in the client model', () => {
  const { root, transformer, parts, neighbor, associations, original } = fixture();
  const bindings = collectMeshVideoBindings(root, '/models/client.glb', associations);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].object, transformer);
  assert.deepEqual(bindings[0].meshes, parts);
  assert.equal(bindings[0].video.videoId, '814735677');
  assert.deepEqual(collectMeshVideoBindings(root, 'unrelated.glb', associations), []);
  for (const mesh of [...parts, neighbor]) assert.equal(mesh.material, original);
  const duplicate = new Mesh(new BoxGeometry(), original); duplicate.name = TRANSFORMER_VIDEO.objectName;
  root.add(duplicate); associations.set(duplicate, { nodes: 40 });
  assert.deepEqual(collectMeshVideoBindings(root, '/models/client.glb', associations), []);
});

test('every transformer material part opens the popup, while other and hidden meshes do not', () => {
  const { root, transformer, parts, neighbor, associations, original } = fixture();
  const bindings = collectMeshVideoBindings(root, '/models/client.glb', associations);
  let opens = 0;
  const controller = Object.assign(Object.create(MeshVideoController.prototype), {
    bindings, open(binding) { assert.equal(binding, bindings[0]); opens++; },
  });
  for (const part of parts) assert.equal(controller.selectFromViewport(part), true);
  assert.equal(opens, 3);
  assert.equal(controller.selectFromViewport(neighbor), false);
  assert.equal(controller.selectFromViewport(null), false);
  transformer.visible = false;
  assert.equal(controller.selectFromViewport(parts[0]), false);
  transformer.visible = true; original.opacity = 0;
  assert.equal(controller.selectFromViewport(parts[0]), false);
  original.opacity = 1; original.visible = false;
  assert.equal(controller.selectFromViewport(parts[0]), false);
  original.visible = true; controller.disposed = true;
  assert.equal(controller.selectFromViewport(parts[0]), false);
  assert.equal(opens, 3);
});

test('the embed URL keeps manual playback controls and never accepts a non-Vimeo source', () => {
  const url = new URL(vimeoEmbedUrl('814735677'));
  assert.equal(url.origin, 'https://player.vimeo.com');
  assert.equal(url.pathname, '/video/814735677');
  assert.equal(url.searchParams.get('autoplay'), '0');
  assert.equal(url.searchParams.get('controls'), '1');
  assert.equal(url.searchParams.get('playsinline'), '1');
  assert.equal(url.searchParams.get('dnt'), '1');
  assert.equal(url.searchParams.has('utm_source'), false);
  for (const invalid of ['https://example.com/movie', '../814735677', '814735677?autoplay=1', '', null]) {
    assert.throws(() => vimeoEmbedUrl(invalid), TypeError);
  }
});

test('closing or disposing unloads the player so playback cannot continue behind a closed popup', () => {
  let frames = 1, closes = 0, removed = 0;
  const controller = Object.assign(Object.create(MeshVideoController.prototype), {
    activeBinding: {},
    playerSlot: { replaceChildren() { frames = 0; } },
    dialog: { open: true, close() { this.open = false; closes++; }, remove() { removed++; } },
    injectedStyle: { remove() { removed++; } },
  });
  controller.close();
  assert.equal(frames, 0); assert.equal(controller.activeBinding, null);
  assert.equal(controller.dialog.open, false); assert.equal(closes, 1);
  controller.dispose(); controller.dispose();
  assert.equal(removed, 2); assert.equal(closes, 1);
});
