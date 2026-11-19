import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
import { collectMeshVideoBindings, MeshVideoController, placeMeshVideoPopup, projectMeshVideoAnchor, TRANSFORMER_VIDEO, vimeoEmbedUrl } from '../src/mesh-videos.js';

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
  let frames = 1, removed = 0, callbacksRemoved = 0;
  const controller = Object.assign(Object.create(MeshVideoController.prototype), {
    activeBinding: {},
    playerSlot: { replaceChildren() { frames = 0; } },
    popup: { hidden: false }, overlay: { remove() { removed++; } },
    removeFrameCallback() { callbacksRemoved++; },
    injectedStyle: { remove() { removed++; } },
  });
  controller.close();
  assert.equal(frames, 0); assert.equal(controller.activeBinding, null);
  assert.equal(controller.popup.hidden, true);
  controller.dispose(); controller.dispose();
  assert.equal(removed, 2); assert.equal(callbacksRemoved, 1);
});

test('video anchor follows the whole object and active camera, and rejects off-screen or behind-camera objects', () => {
  const { root, transformer } = fixture();
  const camera = new PerspectiveCamera(60, 2, 0.1, 1000); camera.position.set(0, 0, 20); camera.lookAt(0, 0, 0);
  const initial = projectMeshVideoAnchor(transformer, camera, 800, 400);
  assert.equal(initial.x, 400); assert.equal(initial.y, 200);
  assert.ok(initial.left < 400 && initial.right > 400);
  root.position.x = 2;
  const moved = projectMeshVideoAnchor(transformer, camera, 800, 400);
  assert.ok(moved.x > initial.x);
  camera.position.x = 2; camera.lookAt(new Vector3(2, 0, 0));
  assert.ok(Math.abs(projectMeshVideoAnchor(transformer, camera, 800, 400).x - initial.x) < 1e-8);
  root.position.x = 1000;
  assert.equal(projectMeshVideoAnchor(transformer, camera, 800, 400), null);
  root.position.x = 2; camera.lookAt(2, 0, 40);
  assert.equal(projectMeshVideoAnchor(transformer, camera, 800, 400), null);
  assert.equal(projectMeshVideoAnchor(transformer, camera, 0, 0), null);
});

test('compact video placement stays beside the object, flips at the right edge, and fits small viewports', () => {
  const popup = { width: 280, height: 250 }, viewport = { width: 1000, height: 700 };
  assert.deepEqual(placeMeshVideoPopup({ x: 400, y: 250, left: 350, right: 450 }, popup, viewport), { left: 464, top: 242 });
  assert.deepEqual(placeMeshVideoPopup({ x: 900, y: 690, left: 850, right: 950 }, popup, viewport), { left: 556, top: 440 });
  assert.deepEqual(placeMeshVideoPopup({ x: 150, y: 120, left: 40, right: 260 }, { width: 280, height: 220 }, { width: 300, height: 240 }), { left: 10, top: 10 });
});

test('following the camera keeps the same playing iframe and closes it when the selected object disappears', () => {
  const { root, parts, associations } = fixture();
  const binding = collectMeshVideoBindings(root, '/models/client.glb', associations)[0];
  const camera = new PerspectiveCamera(60, 2, 0.1, 1000); camera.position.z = 20; camera.lookAt(0, 0, 0);
  const rect = { left: 14, top: 64, width: 1000, height: 700 };
  let unloads = 0;
  const controller = Object.assign(Object.create(MeshVideoController.prototype), {
    activeBinding: binding,
    viewer: { activeCamera: camera, renderer: { domElement: { getBoundingClientRect: () => rect } } },
    overlay: { getBoundingClientRect: () => rect },
    popup: { offsetWidth: 280, offsetHeight: 250, style: {}, hidden: false },
    playerSlot: { replaceChildren() { unloads++; } },
  });
  controller._updatePosition(); const firstLeft = controller.popup.style.left;
  camera.position.x = 2; controller._updatePosition();
  assert.notEqual(controller.popup.style.left, firstLeft);
  assert.equal(controller.activeBinding, binding); assert.equal(unloads, 0);
  parts.forEach((part) => { part.visible = false; }); controller._updatePosition();
  assert.equal(controller.popup.hidden, true); assert.equal(unloads, 1);
});
