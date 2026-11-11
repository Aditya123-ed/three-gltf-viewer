import { AmbientLight, Box3, Color, DirectionalLight, Vector3 } from 'three';
import sky from './daylight-settings.json' with { type: 'json' };

export const DAYLIGHT = sky;
export const DAYLIGHT_NAME = 'Substation daylight (Blender sky)';

export function createDaylightLights(scene, content, state, renderer) {
  const ambient = new AmbientLight(state.ambientColor, state.ambientIntensity);
  ambient.name = 'daylight_fill';
  const sun = new DirectionalLight(state.directColor, state.directIntensity);
  sun.name = 'daylight_sun';
  sun.userData.daylight = true;
  const maximum = renderer.capabilities.maxTextureSize;
  sun.shadow.mapSize.setScalar(Math.min(2048, maximum));
  sun.shadow.bias = -0.00015;
  sun.shadow.radius = 4;
  scene.add(ambient, sun, sun.target);
  fitDaylightShadow(sun, content);
  sun.castShadow = state.shadows;
  return [ambient, sun];
}

export function fitDaylightShadow(sun, content) {
  const box = content ? new Box3().setFromObject(content) : new Box3();
  if (box.isEmpty()) box.set(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  const center = box.getCenter(new Vector3());
  const diameter = Math.max(box.getSize(new Vector3()).length(), 0.01);
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(new Vector3(...DAYLIGHT.sunDirection), diameter * 1.5);
  sun.target.updateMatrixWorld(true);
  sun.updateMatrixWorld(true);
  const camera = sun.shadow.camera;
  camera.position.copy(sun.position);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const lightBox = new Box3();
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        lightBox.expandByPoint(new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
      }
    }
  }
  const margin = diameter * 0.025;
  camera.left = lightBox.min.x - margin;
  camera.right = lightBox.max.x + margin;
  camera.bottom = lightBox.min.y - margin;
  camera.top = lightBox.max.y + margin;
  camera.near = Math.max(diameter * 0.001, -lightBox.max.z - margin);
  camera.far = -lightBox.min.z + margin;
  camera.updateProjectionMatrix();
  sun.shadow.normalBias = diameter * 0.00015;
  sun.shadow.needsUpdate = true;
}

export function daylightSunColor() {
  return new Color().setRGB(...DAYLIGHT.sunColorLinear).getHexString();
}
