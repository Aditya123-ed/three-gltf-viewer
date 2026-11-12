import {
  BufferGeometry, CatmullRomCurve3, DataTexture, DynamicDrawUsage,
  Float32BufferAttribute, Group, Points, PointsMaterial, RGBAFormat, Vector3,
} from 'three';
import { extractWireRoutes } from './wire-routes.js';
import { sourceObject, objectName } from './model-objects.js';
import { correctFlowRoute } from './flow-route-corrections.js';

export const FLOW_DEFAULTS = Object.freeze({ enabled: true, speed: 1, direction: 'forward', color: '#35d9ff', size: 6, density: 1 });
const MAX_PARTICLES = 4096;
const MAX_DENSITY = 3;

export function parseFlowSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid current flow settings.');
  const settings = { ...FLOW_DEFAULTS, groups: Object.create(null), directions: Object.create(null) };
  for (const key of Object.keys(FLOW_DEFAULTS)) if (Object.hasOwn(input, key)) settings[key] = input[key];
  if (typeof settings.enabled !== 'boolean' || !Number.isFinite(settings.speed) || settings.speed < 0.1 || settings.speed > 10 ||
      !Number.isFinite(settings.size) || settings.size < 2 || settings.size > 16 ||
      !Number.isFinite(settings.density) || settings.density < 0.1 || settings.density > MAX_DENSITY ||
      !['forward', 'reverse'].includes(settings.direction) || !/^#[0-9a-f]{6}$/i.test(settings.color)) {
    throw new Error('Invalid current flow speed, direction, color, size, density, or On/Off value.');
  }
  settings.color = settings.color.toLowerCase();
  if (input.groups !== undefined) {
    if (!input.groups || typeof input.groups !== 'object' || Array.isArray(input.groups) || Object.keys(input.groups).length > 512) {
      throw new Error('Invalid current flow wire selection.');
    }
    for (const [key, value] of Object.entries(input.groups)) {
      if (key.length > 512 || typeof value !== 'boolean') throw new Error('Invalid current flow wire selection.');
      settings.groups[key] = value;
    }
  }
  if (input.directions !== undefined) {
    if (!input.directions || typeof input.directions !== 'object' || Array.isArray(input.directions) || Object.keys(input.directions).length > 512) {
      throw new Error('Invalid per-wire flow directions.');
    }
    for (const [key, value] of Object.entries(input.directions)) {
      if (key.length > 512 || !['forward', 'reverse'].includes(value)) throw new Error('Invalid per-wire flow direction.');
      settings.directions[key] = value;
    }
  }
  return settings;
}

export function collectFlowWires(root, associations = null) {
  const groups = new Map(), cache = new Map();
  root.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isInstancedMesh || !mesh.geometry) return;
    const object = sourceObject(mesh, root, associations);
    const name = objectName(object);
    if (!/(?:wire|cable|conductor|curve|b[eé]zier)/i.test(name)) return;
    // Mechanical wire accessories remain in the object panels, not flow routes.
    if (/(?:^|[\s_.-])(?:clamps?|insulators?|brackets?|terminals?)(?:$|[\s_.-])/i.test(name)) return;
    const names = [];
    for (let current = object; current && current !== root; current = current.parent) {
      names.unshift(current.userData.name || current.name || current.type);
    }
    const key = names.join(' / ');
    try {
      if (!cache.has(mesh.geometry)) cache.set(mesh.geometry, extractWireRoutes(mesh.geometry));
      const paths = cache.get(mesh.geometry);
      if (!paths.length) return;
      if (!groups.has(key)) groups.set(key, { key, name, object, routes: [] });
      groups.get(key).routes.push(...paths.map((path) => ({ ...correctFlowRoute(name, path), mesh })));
    } catch (error) {
      console.warn('[Current Flow] Unable to trace wire object:', name, error);
    }
  });
  return [...groups.values()];
}

function createDotTexture() {
  const dimension = 32, data = new Uint8Array(dimension * dimension * 4);
  for (let y = 0; y < dimension; y++) for (let x = 0; x < dimension; x++) {
    const distance = Math.hypot((x + 0.5) / dimension * 2 - 1, (y + 0.5) / dimension * 2 - 1);
    const offset = (y * dimension + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = 255;
    data[offset + 3] = Math.round(Math.max(0, Math.min(1, (1 - distance) / 0.22)) * 255);
  }
  const texture = new DataTexture(data, dimension, dimension, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export class CurrentFlowParticles {
  constructor(scene, groups, initial = FLOW_DEFAULTS) {
    this.groups = groups;
    this.settings = parseFlowSettings(initial);
    this.distance = 0;
    this.groupDistances = new Map(groups.map((group) => [group.key, 0]));
    this.disposed = false;
    this.transformCache = new Map();
    const all = groups.flatMap((group) => group.routes.map((route) => ({ ...route, group })));
    const perRouteBudget = Math.max(1, Math.floor(MAX_PARTICLES / Math.max(all.length, 1)));
    const selected = all.slice(0, MAX_PARTICLES);
    const baseCounts = selected.map((route) => Math.min(perRouteBudget, 24, Math.max(3, Math.ceil(route.length / 1.5))));
    const baselineTotal = baseCounts.reduce((sum, count) => sum + count, 0);
    const extraScale = Math.min(1, (MAX_PARTICLES - baselineTotal) / Math.max(1, baselineTotal * (MAX_DENSITY - 1)));
    this.routes = selected.map((route, index) => {
      const baseCount = baseCounts[index];
      const maxCount = baseCount + Math.floor(baseCount * (MAX_DENSITY - 1) * extraScale);
      return {
        ...route, baseCount, maxCount,
        count: Math.min(maxCount, Math.max(1, Math.round(baseCount * this.settings.density))),
        phase: (index * 0.38196601125) % 1, curve: null, worldRadius: 0,
      };
    });
    // Reserve the slider's maximum once; changing density reuses the buffer.
    const capacity = this.routes.reduce((sum, route) => sum + route.maxCount, 0);
    this.positions = new Float32Array(capacity * 3);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.texture = createDotTexture();
    this.material = new PointsMaterial({
      color: this.settings.color, size: this.settings.size, sizeAttenuation: false,
      map: this.texture, alphaTest: 0.01, transparent: true,
      depthTest: true, depthWrite: false, toneMapped: false,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.name = 'Current flow particles';
    this.points.renderOrder = 10;
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.effectRoot = new Group();
    this.effectRoot.name = 'Current flow effects';
    this.effectRoot.add(this.points);
    scene.add(this.effectRoot);
    this.cameraPosition = new Vector3();
    this.cameraDirection = new Vector3();
    this.position = new Vector3();
    this.offset = new Vector3();
  }

  setSettings(settings) {
    this.settings = parseFlowSettings(settings);
    this.material.color.set(this.settings.color);
    this.material.size = this.settings.size;
    for (const route of this.routes) {
      route.count = Math.min(route.maxCount, Math.max(1, Math.round(route.baseCount * this.settings.density)));
    }
    this.effectRoot.visible = this.settings.enabled;
  }

  _updateTransforms() {
    const changed = new Set(), checked = new Set();
    for (const route of this.routes) {
      const mesh = route.mesh;
      if (checked.has(mesh)) continue;
      checked.add(mesh);
      mesh.updateWorldMatrix(true, false);
      const saved = this.transformCache.get(mesh);
      if (!saved || !saved.equals(mesh.matrixWorld)) {
        this.transformCache.set(mesh, mesh.matrixWorld.clone());
        changed.add(mesh);
      }
    }
    for (const route of this.routes) {
      if (route.curve && !changed.has(route.mesh)) continue;
      route.curve = new CatmullRomCurve3(route.points.map((point) => point.clone().applyMatrix4(route.mesh.matrixWorld)), false, 'centripetal');
      route.curve.arcLengthDivisions = 256;
      route.worldLength = route.curve.getLength();
      route.worldRadius = route.radius * route.mesh.matrixWorld.getMaxScaleOnAxis();
    }
  }

  _visible(mesh) {
    for (let object = mesh; object; object = object.parent) if (!object.visible) return false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.some((material) => material.visible !== false && material.opacity > 0.001);
  }

  update(dt, camera) {
    if (this.disposed) return;
    this.effectRoot.visible = this.settings.enabled && this.routes.length > 0;
    if (!this.effectRoot.visible || !camera) return;
    const step = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)) * this.settings.speed;
    for (const group of this.groups) {
      const direction = this.settings.directions[group.key] || this.settings.direction;
      this.groupDistances.set(group.key, this.groupDistances.get(group.key) + step * (direction === 'reverse' ? -1 : 1));
    }
    // Retain the first route's distance for existing debugging integrations.
    this.distance = this.groupDistances.get(this.groups[0]?.key) || 0;
    this._updateTransforms();
    camera.getWorldPosition(this.cameraPosition);
    if (camera.isOrthographicCamera) camera.getWorldDirection(this.cameraDirection).negate();
    let written = 0;
    for (const route of this.routes) {
      if (this.settings.groups[route.group.key] === false || !this._visible(route.mesh) || route.worldLength <= 0) continue;
      for (let i = 0; i < route.count; i++) {
        const distance = this.groupDistances.get(route.group.key);
        const progress = ((i / route.count + route.phase + distance / route.worldLength) % 1 + 1) % 1;
        route.curve.getPointAt(progress, this.position);
        // Lift dots just in front of the cable surface, while still depth-testing
        // against other equipment. They remain visible without drawing through it.
        if (camera.isOrthographicCamera) this.offset.copy(this.cameraDirection);
        else this.offset.copy(this.cameraPosition).sub(this.position).normalize();
        this.position.addScaledVector(this.offset, route.worldRadius * 1.35 + 0.0001);
        this.position.toArray(this.positions, written * 3);
        written++;
      }
    }
    this.geometry.attributes.position.array.set(this.positions);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.setDrawRange(0, written);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.effectRoot.removeFromParent();
    this.geometry.dispose(); this.material.dispose(); this.texture.dispose();
    this.routes.length = 0;
    this.transformCache.clear();
    this.groupDistances.clear();
  }
}
