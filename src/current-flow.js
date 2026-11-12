import { registerMeshPanel } from './mesh-panel-layout.js';
import { collectFlowWires, CurrentFlowParticles, FLOW_DEFAULTS, parseFlowSettings } from './current-flow-particles.js';

const STYLE_ID = 'current-flow-styles';

export class CurrentFlowController {
  constructor(root, viewer, modelKey, associations = null) {
    this.viewer = viewer;
    this.disposed = false;
    this.storageKey = 'three-gltf-viewer:current-flow:' + modelKey;
    this.groups = collectFlowWires(root, associations);
    this.settings = parseFlowSettings(FLOW_DEFAULTS);
    this.hasLocalSettings = false;
    try {
      const saved = window.localStorage.getItem(this.storageKey);
      if (saved) { this.settings = parseFlowSettings(JSON.parse(saved)); this.hasLocalSettings = true; }
    } catch (error) { console.warn('[Current Flow] Could not restore saved settings.', error); }
    this.particles = new CurrentFlowParticles(viewer.scene, this.groups, this.settings);
    this._injectStyles();
    this._createUI();
    this._refreshUI();
    this.removeFrameCallback = viewer.addFrameCallback((dt) => this.particles.update(dt, viewer.activeCamera));
    this.particles.update(0, viewer.activeCamera);
  }

  get hasRoutes() { return this.particles.routes.length > 0; }

  _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
      .current-flow-toggle,.current-flow-panel,.current-flow-panel *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
      .current-flow-toggle{position:fixed;z-index:100002;left:14px;min-width:132px;height:38px;display:inline-flex;align-items:center;gap:9px;padding:0 12px;color:#f4f8fc;background:rgba(45,56,69,.97);border:1px solid #6486a5;border-radius:8px;box-shadow:0 4px 14px #0007;font:600 11px/1 sans-serif;cursor:pointer;white-space:nowrap}
      .current-flow-toggle:hover,.current-flow-toggle[aria-expanded=true]{background:#226a9a;border-color:#8bb8d9}
      .current-flow-icon{width:16px;flex:0 0 16px;font-size:17px;line-height:1}
      .current-flow-panel{z-index:100001;display:flex;flex-direction:column;overflow:hidden;color:#edf2f7;background:rgba(23,28,36,.98);border:1px solid #526174;border-radius:10px;box-shadow:0 8px 30px #0008;font-size:13px}
      .current-flow-panel[hidden]{display:none!important}
      .current-flow-header{flex:none;padding:11px 13px;border-bottom:1px solid #394553}
      .current-flow-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px;font-weight:700}
      .current-flow-close{padding:3px 8px;color:#edf2f7;background:#303b49;border:1px solid #526174;border-radius:5px;font-size:16px;cursor:pointer}
      .current-flow-count,.current-flow-help{margin-top:6px;color:#aab5c3;font-size:11px;line-height:1.5}
      .current-flow-body{min-height:0;flex:1;overflow:auto;padding:12px 13px}
      .current-flow-row{display:block;margin-bottom:15px}
      .current-flow-label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px;font-size:12px}
      .current-flow-panel input[type=range]{width:100%;accent-color:#69c8ff}
      .current-flow-panel input[type=checkbox]{accent-color:#69c8ff;margin:0 7px 0 0;vertical-align:middle}
      .current-flow-panel input:disabled,.current-flow-panel select:disabled{opacity:.4}
      .current-flow-select{width:100%;padding:8px 9px;color:#edf2f7;background:#242c37;border:1px solid #526174;border-radius:5px;font:inherit}
      .current-flow-color-wrap{display:flex;align-items:center;gap:10px}
      .current-flow-color{width:48px;height:34px;padding:2px;background:#242c37;border:1px solid #526174;border-radius:4px;cursor:pointer}
      .current-flow-value{font-variant-numeric:tabular-nums;color:#c5e6ff;font-size:11px}
      .current-flow-wires{margin-top:12px;padding-top:11px;border-top:1px solid #394553}
      .current-flow-wire{display:flex;align-items:flex-start;gap:3px;margin-top:9px;overflow-wrap:anywhere;line-height:1.4;font-size:11px}
      .current-flow-wire input{flex:none;margin-top:2px!important}
      .current-flow-message{margin-top:10px;color:#a9d8f7;font-size:11px;line-height:1.4}
    `;
    document.head.appendChild(style); this.injectedStyle = style;
  }

  _createUI() {
    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button'; this.toggleButton.className = 'current-flow-toggle';
    this.toggleButton.innerHTML = '<span class="current-flow-icon" aria-hidden="true">↝</span><span>Current Flow</span>';
    this.toggleButton.setAttribute('aria-label', 'Toggle Current Flow panel');
    this.toggleButton.setAttribute('aria-expanded', 'false');
    this.toggleButton.title = 'Show Current Flow panel';
    this.panel = document.createElement('section');
    this.panel.className = 'current-flow-panel'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Current Flow controls');
    this.panel.innerHTML = `
      <div class="current-flow-header">
        <div class="current-flow-heading"><span>Current Flow</span><button type="button" class="current-flow-close" aria-label="Hide Current Flow panel">×</button></div>
        <div class="current-flow-count"></div>
      </div>
      <div class="current-flow-body">
        <label class="current-flow-row"><input type="checkbox" class="current-flow-enabled">Show current flow <span class="current-flow-state"></span></label>
        <label class="current-flow-row"><span class="current-flow-label">Speed <output class="current-flow-speed-value current-flow-value"></output></span><input type="range" class="current-flow-speed" aria-label="Current flow speed" min="0.1" max="10" step="0.1"></label>
        <label class="current-flow-row"><span class="current-flow-label">Direction</span><select class="current-flow-select current-flow-direction" aria-label="Current flow direction"><option value="forward">Forward (route start → end)</option><option value="reverse">Reverse (route end → start)</option></select></label>
        <label class="current-flow-row"><span class="current-flow-label">Color</span><span class="current-flow-color-wrap"><input type="color" class="current-flow-color" aria-label="Current flow color"><output class="current-flow-color-value current-flow-value"></output></span></label>
        <label class="current-flow-row"><span class="current-flow-label">Particle size <output class="current-flow-size-value current-flow-value"></output></span><input type="range" class="current-flow-size" aria-label="Current flow particle size" min="2" max="16" step="1"></label>
        <div class="current-flow-help">Schematic power flow. Speed controls the illustration, not actual electron motion.</div>
        <div class="current-flow-wires"><span class="current-flow-label">Wire objects</span><div class="current-flow-wire-list"></div></div>
        <div class="current-flow-help">Settings save in this browser. Properties → Export includes flow settings for sharing.</div>
        <div class="current-flow-message" role="status" aria-live="polite"></div>
      </div>`;
    const query = (selector) => this.panel.querySelector('.current-flow-' + selector);
    this.enabledInput = query('enabled'); this.speedInput = query('speed');
    this.directionInput = query('direction'); this.colorInput = query('color'); this.sizeInput = query('size');
    this.count = query('count'); this.stateLabel = query('state'); this.message = query('message');
    this.speedValue = query('speed-value'); this.colorValue = query('color-value'); this.sizeValue = query('size-value');
    this.wireInputs = new Map();
    const list = query('wire-list');
    for (const group of this.groups) {
      const label = document.createElement('label'); label.className = 'current-flow-wire';
      const input = document.createElement('input'); input.type = 'checkbox';
      input.setAttribute('aria-label', 'Show flow on ' + group.name);
      const text = document.createElement('span'); text.textContent = group.name + ' · ' + group.routes.length + ' spans';
      label.append(input, text); list.appendChild(label); this.wireInputs.set(group.key, input);
      input.addEventListener('change', () => this._change({ groups: { ...this.settings.groups, [group.key]: input.checked } }));
    }
    this.toggleButton.addEventListener('click', () => this.toggle());
    query('close').addEventListener('click', () => this.hide());
    this.enabledInput.addEventListener('change', () => this._change({ enabled: this.enabledInput.checked }));
    this.speedInput.addEventListener('input', () => this._change({ speed: Number(this.speedInput.value) }));
    this.directionInput.addEventListener('change', () => this._change({ direction: this.directionInput.value }));
    this.colorInput.addEventListener('input', () => this._change({ color: this.colorInput.value }));
    this.sizeInput.addEventListener('input', () => this._change({ size: Number(this.sizeInput.value) }));
    document.body.append(this.toggleButton, this.panel);
    this.layoutRegistration = registerMeshPanel(this.panel, this.toggleButton, 2);
  }

  _refreshUI() {
    this.enabledInput.checked = this.settings.enabled;
    this.speedInput.value = String(this.settings.speed); this.directionInput.value = this.settings.direction;
    this.colorInput.value = this.settings.color; this.sizeInput.value = String(this.settings.size);
    this.speedValue.textContent = this.settings.speed.toFixed(1) + ' m/s';
    this.sizeValue.textContent = this.settings.size + ' px'; this.colorValue.textContent = this.settings.color.toUpperCase();
    this.stateLabel.textContent = this.settings.enabled ? '· On' : '· Off';
    const routes = this.particles.routes.length;
    this.count.textContent = routes ? routes + ' cable spans · ' + this.groups.length + ' wire objects' : 'No traceable open cable tubes found in this model.';
    for (const input of [this.enabledInput, this.speedInput, this.directionInput, this.colorInput, this.sizeInput]) input.disabled = !routes;
    for (const [key, input] of this.wireInputs) input.checked = this.settings.groups[key] !== false;
  }

  _change(patch) {
    this.settings = parseFlowSettings({ ...this.settings, ...patch });
    this.particles.setSettings(this.settings); this._refreshUI();
    this._save(); this.particles.update(0, this.viewer.activeCamera);
  }

  _save() {
    this.hasLocalSettings = true;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.exportSettings()));
      this.message.textContent = '';
    } catch (error) { this.message.textContent = 'Browser saving failed. Use Properties → Export to keep your flow settings.'; }
  }

  exportSettings() { return { ...this.settings, groups: { ...this.settings.groups } }; }

  parseSettings(input) { return parseFlowSettings(input); }

  importSettings(parsed) {
    if (this.disposed) return;
    this.settings = parseFlowSettings(parsed);
    this.particles.setSettings(this.settings); this._refreshUI(); this._save();
    this.particles.update(0, this.viewer.activeCamera);
  }

  loadSharedSettings(input) {
    if (input === undefined || this.hasLocalSettings || this.disposed) return;
    this.settings = parseFlowSettings(input);
    this.particles.setSettings(this.settings); this._refreshUI();
    this.particles.update(0, this.viewer.activeCamera);
  }

  show() {
    if (this.disposed) return;
    this.panel.hidden = false; this.toggleButton.setAttribute('aria-expanded', 'true');
    this.toggleButton.title = 'Hide Current Flow panel'; this.layoutRegistration.update();
  }
  hide() {
    if (this.disposed) return;
    this.panel.hidden = true; this.toggleButton.setAttribute('aria-expanded', 'false');
    this.toggleButton.title = 'Show Current Flow panel'; this.layoutRegistration.update();
  }
  toggle() { if (this.panel.hidden) this.show(); else this.hide(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.removeFrameCallback(); this.particles.dispose();
    this.layoutRegistration.unregister(); this.toggleButton.remove(); this.panel.remove(); this.injectedStyle?.remove();
  }
}
