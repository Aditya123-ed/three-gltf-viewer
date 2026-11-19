import { collectModelObjects, isObjectVisible } from './model-objects.js';
import { registerMeshPanel } from './mesh-panel-layout.js';

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

export function collectEnvironmentMeshGroups(root, objects, associations = null) {
  const members = new Set(objects);
  return collectModelObjects(root, associations).filter((group) => {
    for (let object = group.object; object; object = object.parent) {
      if (members.has(object)) return true;
    }
    return false;
  });
}

export class EnvironmentVisibilityController {
  constructor(root, viewer, modelKey, associations = null) {
    this.viewer = viewer;
    this.disposed = false;
    this.storageKey = 'three-gltf-viewer:environment-visible:' + modelKey;
    this.objects = collectEnvironmentObjects(root, modelKey);
    this.groups = collectEnvironmentMeshGroups(root, this.objects, associations);
    this.originalVisibility = new Map([...this.objects, ...this.groups.map((group) => group.object)]
      .map((object) => [object, object.visible]));
    this.objectVisibility = new Map(this.groups.map((group) => [group.object, group.object.visible]));
    this._loadObjectVisibility();
    let enabled = true;
    try {
      const saved = JSON.parse(window.localStorage.getItem(this.storageKey) || 'null');
      if (typeof saved === 'boolean') enabled = saved;
    } catch (error) { console.warn('[Environment] Could not restore visibility.', error); }
    this._createUI();
    this.setEnabled(enabled, false);
  }

  _loadObjectVisibility() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(this.storageKey + ':objects') || '[]');
      if (!Array.isArray(saved)) return;
      for (const group of this.groups) {
        // Duplicate paths are ambiguous after a file update, so keep those
        // objects independent for this session without guessing saved matches.
        if (this.groups.filter((item) => item.displayPath === group.displayPath).length !== 1) continue;
        const entries = saved.filter((entry) => entry?.path === group.displayPath && typeof entry.visible === 'boolean');
        if (entries.length === 1) this.objectVisibility.set(group.object, entries[0].visible);
      }
    } catch (error) { console.warn('[Environment] Could not restore object visibility.', error); }
  }

  _createUI() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style'); style.id = STYLE_ID;
      style.textContent = `
        .environment-toggle,.environment-toggle *,.environment-panel,.environment-panel *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
        .environment-toggle{position:fixed;z-index:100002;left:14px;min-width:132px;height:38px;display:inline-flex;align-items:center;padding:0;color:#f4f8fc;background:rgba(45,56,69,.97);border:1px solid #6486a5;border-radius:8px;box-shadow:0 4px 14px #0007;font:600 11px/1 sans-serif;white-space:nowrap}
        .environment-toggle.is-open{background:#226a9a;border-color:#8bb8d9}
        .environment-switch{display:inline-flex;align-items:center;gap:8px;height:100%;padding:0 10px;cursor:pointer}
        .environment-enabled{width:14px;height:14px;margin:0;accent-color:#69c8ff;cursor:pointer}
        .environment-open{display:grid;place-items:center;align-self:stretch;min-width:32px;margin:0;padding:0 8px;color:inherit;background:transparent;border:0;border-left:1px solid #6486a5;border-radius:0 7px 7px 0;cursor:pointer}
        .environment-open:hover{background:#226a9a}
        .environment-open svg{width:12px;height:8px;transition:transform .15s}
        .environment-open[aria-expanded=true] svg{transform:rotate(180deg)}
        .environment-enabled:focus-visible,.environment-open:focus-visible,.environment-object-input:focus-visible{outline:2px solid #b5e3ff;outline-offset:2px}
        .environment-enabled:disabled{opacity:.4;cursor:default}
        .environment-icon{width:16px;height:16px;flex:0 0 16px}
        .environment-panel{z-index:100001;display:flex;flex-direction:column;overflow:hidden;color:#edf2f7;background:rgba(23,28,36,.98);border:1px solid #526174;border-radius:10px;box-shadow:0 8px 30px #0008;font-size:13px}
        .environment-panel[hidden]{display:none!important}
        .environment-header{flex:none;padding:11px 13px;border-bottom:1px solid #394553}
        .environment-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px;font-weight:700}
        .environment-close{padding:3px 8px;color:#edf2f7;background:#303b49;border:1px solid #526174;border-radius:5px;font-size:16px;cursor:pointer}
        .environment-count,.environment-help{margin-top:6px;color:#aab5c3;font-size:11px;line-height:1.5}
        .environment-help[hidden]{display:none!important}
        .environment-object-list{min-height:0;flex:1;overflow:auto;padding:5px 13px 13px}
        .environment-object{display:flex;align-items:flex-start;gap:9px;padding:12px 0;border-bottom:1px solid #394553;font-size:12px;line-height:1.4;overflow-wrap:anywhere;cursor:pointer}
        .environment-object-input{flex:none;width:14px;height:14px;margin:1px 0 0;accent-color:#69c8ff;cursor:pointer}
      `;
      document.head.appendChild(style); this.injectedStyle = style;
    }
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'environment-toggle';
    this.toolbar.setAttribute('role', 'group');
    this.toolbar.setAttribute('aria-label', 'Environment toolbar');
    this.toolbar.innerHTML = '<label class="environment-switch"><input type="checkbox" class="environment-enabled" aria-label="Show environment"><svg class="environment-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M17 3C8 2 3 5 3 10a6 6 0 0 0 6 6c5 0 8-5 8-13Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="m3 18 9-10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>Environment</span></label>';
    this.enabledInput = this.toolbar.querySelector('.environment-enabled');
    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button'; this.toggleButton.className = 'environment-open';
    this.toggleButton.innerHTML = '<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    this.toggleButton.setAttribute('aria-label', 'Toggle Environment panel');
    this.toggleButton.setAttribute('aria-expanded', 'false');
    this.toggleButton.setAttribute('aria-controls', 'environment-panel');
    this.toggleButton.title = 'Show Environment panel';
    this.toolbar.appendChild(this.toggleButton);
    this.panel = document.createElement('section');
    this.panel.id = 'environment-panel'; this.panel.className = 'environment-panel'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Environment objects');
    this.panel.innerHTML = '<div class="environment-header"><div class="environment-heading"><span>Environment</span><button type="button" class="environment-close" aria-label="Hide Environment panel">×</button></div><div class="environment-count"></div><div class="environment-help" hidden>Environment is off. Your individual object choices are kept.</div></div><div class="environment-object-list"></div>';
    this.count = this.panel.querySelector('.environment-count');
    this.help = this.panel.querySelector('.environment-help');
    this.objectInputs = new Map();
    const list = this.panel.querySelector('.environment-object-list');
    for (const group of this.groups) {
      const label = document.createElement('label'); label.className = 'environment-object';
      const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'environment-object-input';
      input.setAttribute('aria-label', 'Show environment object ' + group.name);
      const name = document.createElement('span'); name.textContent = group.name;
      label.append(input, name); list.appendChild(label);
      this.objectInputs.set(group.object, input);
      input.addEventListener('change', () => this.setObjectEnabled(group.object, input.checked));
    }
    this.toggleButton.addEventListener('click', () => this.toggle());
    this.panel.querySelector('.environment-close').addEventListener('click', () => this.hide());
    this.enabledInput.addEventListener('change', () => this.setEnabled(this.enabledInput.checked));
    document.body.append(this.toolbar, this.panel);
    this.layoutRegistration = registerMeshPanel(this.panel, this.toolbar, 2);
  }

  setEnabled(enabled, save = true) {
    if (this.disposed) return;
    this.enabled = Boolean(enabled);
    this._applyVisibility();
    if (save) {
      try { window.localStorage.setItem(this.storageKey, JSON.stringify(this.enabled)); }
      catch (error) { console.warn('[Environment] Could not save visibility.', error); }
    }
  }

  setObjectEnabled(object, enabled) {
    if (this.disposed || !this.objectVisibility.has(object)) return;
    this.objectVisibility.set(object, Boolean(enabled));
    this._applyVisibility();
    const entries = this.groups
      .filter((group) => this.groups.filter((item) => item.displayPath === group.displayPath).length === 1)
      .map((group) => ({ path: group.displayPath, visible: this.objectVisibility.get(group.object) }));
    try { window.localStorage.setItem(this.storageKey + ':objects', JSON.stringify(entries)); }
    catch (error) { console.warn('[Environment] Could not save object visibility.', error); }
  }

  _applyVisibility() {
    for (const [object, visible] of this.originalVisibility) object.visible = visible;
    for (const [object, visible] of this.objectVisibility) object.visible = visible;
    if (!this.enabled) for (const object of this.objects) object.visible = false;
    this.enabledInput.checked = this.enabled && this.objects.length > 0;
    this.enabledInput.disabled = !this.objects.length;
    this.enabledInput.title = !this.objects.length ? 'No environment objects found in this model'
      : this.enabled ? 'Turn environment off' : 'Turn environment on';
    if (this.viewer.selectedMesh && !isObjectVisible(this.viewer.selectedMesh)) this.viewer.clearSelectedMesh();
    this.viewer.invalidateShadows();
    for (const [object, input] of this.objectInputs) input.checked = this.objectVisibility.get(object);
    this.count.textContent = this.groups.length ? this.groups.length + ' environment objects'
      : 'No environment objects found in this model.';
    this.help.hidden = this.enabled;
  }

  show() {
    if (this.disposed) return;
    this.panel.hidden = false; this.toggleButton.setAttribute('aria-expanded', 'true');
    this.toolbar.classList.add('is-open'); this.toggleButton.title = 'Hide Environment panel';
    this.layoutRegistration.update();
  }

  hide() {
    if (this.disposed) return;
    this.panel.hidden = true; this.toggleButton.setAttribute('aria-expanded', 'false');
    this.toolbar.classList.remove('is-open'); this.toggleButton.title = 'Show Environment panel';
    this.layoutRegistration.update();
  }

  toggle() {
    if (this.panel.hidden) this.show(); else this.hide();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [object, visible] of this.originalVisibility) object.visible = visible;
    this.layoutRegistration.unregister(); this.toolbar.remove(); this.panel.remove(); this.injectedStyle?.remove();
  }
}
