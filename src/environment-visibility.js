import { isObjectVisible } from './model-objects.js';
import { registerMeshToolbar } from './mesh-panel-layout.js';

const STYLE_ID = 'environment-visibility-styles';
const CLIENT_MODEL = '/models/client.glb';
// The client's Blender collection is flattened by the current GLB export.
// Keep its verified members explicit; never guess from materials or bounds.
const CLIENT_MEMBERS = new Set(['Railling', 'Base_Grass', 'Base_Sand']);
const COLLECTION_NAMES = new Set(['enviroenment', 'environment']);

export function collectEnvironmentObjects(root, modelKey) {
  const collections = [];
  root.traverse((object) => {
    const name = String(object.userData.name || object.name || '').trim().toLowerCase();
    if (COLLECTION_NAMES.has(name)) collections.push(object);
  });
  if (collections.length) {
    // A nested collection is already controlled by its named parent.
    return collections.filter((object) => {
      for (let parent = object.parent; parent; parent = parent.parent) {
        if (collections.includes(parent)) return false;
      }
      return true;
    });
  }
  if (modelKey !== CLIENT_MODEL) return [];
  const members = [];
  root.traverse((object) => {
    if (CLIENT_MEMBERS.has(object.userData.name || object.name)) members.push(object);
  });
  return members;
}

export class EnvironmentVisibilityController {
  constructor(root, viewer, modelKey) {
    this.viewer = viewer;
    this.disposed = false;
    this.storageKey = 'three-gltf-viewer:environment-visible:' + modelKey;
    this.objects = collectEnvironmentObjects(root, modelKey);
    this.originalVisibility = new Map(this.objects.map((object) => [object, object.visible]));
    let enabled = true;
    try {
      const saved = JSON.parse(window.localStorage.getItem(this.storageKey) || 'null');
      if (typeof saved === 'boolean') enabled = saved;
    } catch (error) { console.warn('[Environment] Could not restore visibility.', error); }
    this._createUI();
    this.setEnabled(enabled, false);
  }

  _createUI() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style'); style.id = STYLE_ID;
      style.textContent = `
        .environment-toggle,.environment-toggle *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
        .environment-toggle{position:fixed;z-index:100002;left:14px;min-width:132px;height:38px;display:inline-flex;align-items:center;padding:0;color:#f4f8fc;background:rgba(45,56,69,.97);border:1px solid #6486a5;border-radius:8px;box-shadow:0 4px 14px #0007;font:600 11px/1 sans-serif;white-space:nowrap}
        .environment-switch{display:inline-flex;align-items:center;gap:8px;width:100%;height:100%;padding:0 10px;cursor:pointer}
        .environment-enabled{width:14px;height:14px;margin:0;accent-color:#69c8ff;cursor:pointer}
        .environment-enabled:focus-visible{outline:2px solid #b5e3ff;outline-offset:2px}
        .environment-enabled:disabled{opacity:.4;cursor:default}
        .environment-icon{width:16px;height:16px;flex:0 0 16px}
      `;
      document.head.appendChild(style); this.injectedStyle = style;
    }
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'environment-toggle';
    this.toolbar.setAttribute('role', 'group');
    this.toolbar.setAttribute('aria-label', 'Environment toolbar');
    this.toolbar.innerHTML = '<label class="environment-switch"><input type="checkbox" class="environment-enabled" aria-label="Show environment"><svg class="environment-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M17 3C8 2 3 5 3 10a6 6 0 0 0 6 6c5 0 8-5 8-13Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m3 18 9-10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>Environment</span></label>';
    this.enabledInput = this.toolbar.querySelector('.environment-enabled');
    this.enabledInput.addEventListener('change', () => this.setEnabled(this.enabledInput.checked));
    document.body.appendChild(this.toolbar);
    this.layoutRegistration = registerMeshToolbar(this.toolbar, 2);
  }

  setEnabled(enabled, save = true) {
    if (this.disposed) return;
    this.enabled = Boolean(enabled);
    for (const [object, visible] of this.originalVisibility) object.visible = this.enabled && visible;
    this.enabledInput.checked = this.enabled && this.objects.length > 0;
    this.enabledInput.disabled = !this.objects.length;
    this.enabledInput.title = !this.objects.length ? 'No environment objects found in this model'
      : this.enabled ? 'Turn environment off' : 'Turn environment on';
    if (this.viewer.selectedMesh && !isObjectVisible(this.viewer.selectedMesh)) this.viewer.clearSelectedMesh();
    this.viewer.invalidateShadows();
    if (save) {
      try { window.localStorage.setItem(this.storageKey, JSON.stringify(this.enabled)); }
      catch (error) { console.warn('[Environment] Could not save visibility.', error); }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [object, visible] of this.originalVisibility) object.visible = visible;
    this.layoutRegistration.unregister(); this.toolbar.remove(); this.injectedStyle?.remove();
  }
}
