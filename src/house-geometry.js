import { collectCollectionObjects, isObjectVisible } from './model-objects.js';
import { registerMeshToolbar } from './mesh-panel-layout.js';

const STYLE_ID = 'house-geometry-styles';
const CLIENT_MODEL = '/models/client.glb';
const COLLECTION_NAMES = ['House Geo', 'House Geometry', 'House'];
// Verified house objects from the current client export, whose collection
// hierarchy is flattened. Named collections take precedence when retained.
const CLIENT_MEMBERS = [
  'Railling.001', 'Basement', 'Plane', 'Wall', 'Cylinder.008', 'Metal', 'Roof', 'Plane.001',
  'Double Door - Industrial', 'Double Door - Industrial.002', 'Single Door with Window - Industrial',
  'Exterior ladder.007', 'BézierCurve.039', 'Entrance', 'Cube.055', 'Cube.047',
];

export function collectHouseObjects(root, modelKey) {
  return collectCollectionObjects(root, COLLECTION_NAMES, modelKey === CLIENT_MODEL ? CLIENT_MEMBERS : []);
}

export class HouseGeometryController {
  constructor(root, viewer, modelKey) {
    this.viewer = viewer;
    this.disposed = false;
    this.storageKey = 'three-gltf-viewer:house-geometry-visible:' + modelKey;
    this.objects = collectHouseObjects(root, modelKey);
    this.originalVisibility = new Map(this.objects.map((object) => [object, object.visible]));
    let enabled = true;
    try {
      const saved = JSON.parse(window.localStorage.getItem(this.storageKey) || 'null');
      if (typeof saved === 'boolean') enabled = saved;
    } catch (error) { console.warn('[HOUSE GEO] Could not restore visibility.', error); }
    this._createUI();
    this.setEnabled(enabled, false);
  }

  _createUI() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style'); style.id = STYLE_ID;
      style.textContent = `
        .house-geometry-toggle,.house-geometry-toggle *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
        .house-geometry-toggle{position:fixed;z-index:100002;left:14px;min-width:132px;height:38px;display:inline-flex;align-items:center;padding:0;color:#f4f8fc;background:rgba(45,56,69,.97);border:1px solid #6486a5;border-radius:8px;box-shadow:0 4px 14px #0007;font:600 11px/1 sans-serif;white-space:nowrap}
        .house-geometry-switch{display:inline-flex;align-items:center;gap:8px;width:100%;height:100%;padding:0 10px;cursor:pointer}
        .house-geometry-enabled{width:14px;height:14px;margin:0;accent-color:#69c8ff;cursor:pointer}
        .house-geometry-enabled:focus-visible{outline:2px solid #b5e3ff;outline-offset:2px}
        .house-geometry-enabled:disabled{opacity:.4;cursor:default}
        .house-geometry-icon{width:16px;height:16px;flex:0 0 16px}
      `;
      document.head.appendChild(style); this.injectedStyle = style;
    }
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'house-geometry-toggle';
    this.toolbar.setAttribute('role', 'group');
    this.toolbar.setAttribute('aria-label', 'HOUSE GEO toolbar');
    this.toolbar.innerHTML = '<label class="house-geometry-switch"><input type="checkbox" class="house-geometry-enabled" aria-label="Show house geometry"><svg class="house-geometry-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m2 9 8-7 8 7M4 8v10h12V8M8 18v-6h4v6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>HOUSE GEO</span></label>';
    this.enabledInput = this.toolbar.querySelector('.house-geometry-enabled');
    this.enabledInput.addEventListener('change', () => this.setEnabled(this.enabledInput.checked));
    document.body.appendChild(this.toolbar);
    this.layoutRegistration = registerMeshToolbar(this.toolbar, 3);
  }

  setEnabled(enabled, save = true) {
    if (this.disposed) return;
    this.enabled = Boolean(enabled);
    for (const [object, visible] of this.originalVisibility) object.visible = this.enabled && visible;
    this.enabledInput.checked = this.enabled && this.objects.length > 0;
    this.enabledInput.disabled = !this.objects.length;
    this.enabledInput.title = !this.objects.length ? 'No house geometry found in this model'
      : this.enabled ? 'Turn house geometry off' : 'Turn house geometry on';
    if (this.viewer.selectedMesh && !isObjectVisible(this.viewer.selectedMesh)) this.viewer.clearSelectedMesh();
    this.viewer.invalidateShadows();
    if (save) {
      try { window.localStorage.setItem(this.storageKey, JSON.stringify(this.enabled)); }
      catch (error) { console.warn('[HOUSE GEO] Could not save visibility.', error); }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [object, visible] of this.originalVisibility) object.visible = visible;
    this.layoutRegistration.unregister(); this.toolbar.remove(); this.injectedStyle?.remove();
  }
}
