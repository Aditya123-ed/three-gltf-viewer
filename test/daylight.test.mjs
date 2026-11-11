import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BoxGeometry, FloatType, Group, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { DAYLIGHT, createDaylightLights, fitDaylightShadow } from '../src/daylight.js';
import { MeshAppearanceController } from '../src/mesh-appearance.js';

function fixture(scale = 1) {
  const scene = new Scene();
  const content = new Group();
  const mesh = new Mesh(new BoxGeometry(100 * scale, 30 * scale, 60 * scale), new MeshStandardMaterial());
  mesh.position.set(7 * scale, 15 * scale, -12 * scale);
  content.add(mesh);
  scene.add(content);
  return { scene, content, mesh };
}

test('sky records the supplied Blender 5.1 settings and glTF sun-axis conversion', () => {
  assert.equal(DAYLIGHT.skyModel, 'MULTIPLE_SCATTERING');
  assert.equal(DAYLIGHT.sunElevation, 30);
  assert.equal(DAYLIGHT.sunRotation, -30);
  assert.equal(DAYLIGHT.sunAngularDiameter, 10);
  assert.equal(DAYLIGHT.ozone, 5);
  assert.equal(DAYLIGHT.gamma, 0.9);
  assert.equal(DAYLIGHT.worldStrength, 1);
  const direction = new Vector3(...DAYLIGHT.sunDirection);
  assert.ok(Math.abs(direction.length() - 1) < 1e-8);
  assert.ok(Math.abs(direction.y - 0.5) < 1e-8);
  assert.ok(direction.angleTo(new Vector3(...DAYLIGHT.measuredSunDirection)) < Math.PI / 180);
});

test('baked EXR decodes with the installed three.js loader and contains finite HDR radiance', () => {
  const buffer = fs.readFileSync(new URL('../public/environments/substation-daylight.exr', import.meta.url));
  const data = new EXRLoader().setDataType(FloatType).parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  assert.equal(data.width, 1024);
  assert.equal(data.height, 512);
  let maximum = 0;
  for (const value of data.data) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0);
    maximum = Math.max(maximum, value);
  }
  assert.ok(maximum > 1, 'HDR intensity should not be clipped to the display range');
});

test('fixed world sun and fitted shadow frustum cover all model corners at different scales', () => {
  for (const scale of [0.001, 1, 1000]) {
    const { scene, content, mesh } = fixture(scale);
    const lights = createDaylightLights(scene, content, {
      ambientColor: '#ffffff', ambientIntensity: 0.02,
      directColor: '#ffffff', directIntensity: DAYLIGHT.sunIntensity, shadows: true,
    }, { capabilities: { maxTextureSize: 1024 } });
    const sun = lights[1];
    assert.equal(sun.parent, scene);
    assert.equal(sun.target.parent, scene);
    assert.equal(sun.shadow.mapSize.x, 1024);
    assert.equal(sun.castShadow, true);
    const direction = sun.position.clone().sub(sun.target.position).normalize();
    assert.ok(direction.distanceTo(new Vector3(...DAYLIGHT.sunDirection)) < 1e-8);
    const camera = sun.shadow.camera;
    for (const x of [-50, 50]) for (const y of [-15, 15]) for (const z of [-30, 30]) {
      const projected = mesh.localToWorld(new Vector3(x * scale, y * scale, z * scale)).project(camera);
      assert.ok(Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1);
    }
    mesh.position.x += 500 * scale;
    fitDaylightShadow(sun, content);
    assert.ok(sun.target.position.x > 400 * scale);
    lights.forEach((light) => light.dispose());
  }
});

test('transparency updates shadows and restores the original caster state', () => {
  const { content, mesh } = fixture();
  mesh.castShadow = true;
  let invalidations = 0;
  const appearance = new MeshAppearanceController(content, () => invalidations++);
  appearance.setOpacity(mesh, 40);
  assert.equal(mesh.castShadow, false);
  assert.equal(invalidations, 1);
  appearance.setColor([mesh], '#00ff00');
  assert.equal(mesh.castShadow, false);
  appearance.setOpacity(mesh, 100);
  assert.equal(mesh.castShadow, true);
  appearance.setOpacity(mesh, 0);
  appearance.dispose();
  assert.equal(mesh.castShadow, true);
});
