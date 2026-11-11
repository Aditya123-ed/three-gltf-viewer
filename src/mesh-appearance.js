import { MeshStandardMaterial } from 'three';

export const isObjectColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

// One owner for color and opacity, so either control can be reset independently.
export class MeshAppearanceController {
  constructor(root, onChange = () => {}) {
	this.onChange = onChange;
    this.records = new Map();
    root.traverse((mesh) => {
      if (mesh.isMesh && mesh.material) {
        this.records.set(mesh, { mesh, original: mesh.material, working: null, color: null, opacity: 1, castShadow: mesh.castShadow });
      }
    });
  }

  setColor(meshes, color) {
    if (color !== null && !isObjectColor(color)) throw new Error('Enter a color such as #3498DB.');
    for (const mesh of meshes) {
      const record = this.records.get(mesh);
      if (!record) continue;
      record.color = color?.toLowerCase() || null;
      this._apply(record);
    }
  }

  setOpacity(mesh, percentage) {
    const record = this.records.get(mesh);
    if (!record || !Number.isFinite(percentage)) return;
    record.opacity = Math.max(0, Math.min(1, percentage / 100));
	// A client hiding equipment must not leave an opaque shadow behind it.
	record.mesh.castShadow = record.castShadow && record.opacity >= 0.999;
    this._apply(record);
  }

  _apply(record) {
    const originals = Array.isArray(record.original) ? record.original : [record.original];
    const current = Array.isArray(record.mesh.material) ? record.mesh.material : [record.mesh.material];
    const oldWorking = record.working;
    record.working = null;
    if (record.color === null && record.opacity === 1) {
      // Keep display settings changed by the viewer while this object was painted.
      originals.forEach((material, index) => { material.wireframe = current[index]?.wireframe || false; });
      record.mesh.material = record.original;
    } else {
      record.working = originals.map((original, index) => {
        const material = record.color === null ? original.clone() : new MeshStandardMaterial({
          color: record.color,
          metalness: 0,
          roughness: 0.8,
          side: original.side,
          flatShading: Boolean(original.flatShading),
          depthTest: original.depthTest,
          depthWrite: original.depthWrite,
          polygonOffset: original.polygonOffset,
          polygonOffsetFactor: original.polygonOffsetFactor,
          polygonOffsetUnits: original.polygonOffsetUnits,
        });
        material.wireframe = current[index]?.wireframe || false;
        material.opacity *= record.opacity;
        material.transparent ||= record.opacity < 0.999;
        if (record.opacity < 0.999) material.depthWrite = false;
        return material;
      });
      record.mesh.material = Array.isArray(record.original) ? record.working : record.working[0];
    }
    // Textures belong to the original model and must never be disposed here.
    oldWorking?.forEach((material) => material.dispose());
	this.onChange();
  }

  dispose() {
    for (const record of this.records.values()) {
      record.mesh.material = record.original;
	  record.mesh.castShadow = record.castShadow;
      record.working?.forEach((material) => material.dispose());
    }
    this.records.clear();
  }
}
