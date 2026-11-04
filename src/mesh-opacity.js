import { registerMeshPanel } from './mesh-panel-layout.js';

/**
 * Per-mesh opacity controller for donmccurdy/three-gltf-viewer.
 * Creates independent material clones per mesh so editing one mesh does not
 * change other meshes that shared the same glTF material.
 */

const STYLE_ID = 'mesh-opacity-controller-styles';

export class MeshOpacityController {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.records = [];
    this.disposed = false;

    this._collectMeshes();
    this._injectStyles();
    this._createUI();
    this._renderRows();
  }

  _collectMeshes() {
    this.root.traverse((object) => {
      if (!object.isMesh || !object.material) return;

      this.records.push({
        mesh: object,
        originalMaterial: object.material,
        workingMaterials: null,
        originalProperties: null,
        row: null,
        searchText: '',
      });
    });
  }

  _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .mesh-opacity-panel, .mesh-opacity-toggle {
        font-family: Arial, Helvetica, sans-serif;
        box-sizing: border-box;
      }
      .mesh-opacity-panel *, .mesh-opacity-toggle * { box-sizing: border-box; }
      .mesh-opacity-panel[hidden] { display: none; }
      .mesh-opacity-panel {
        position: fixed;
        z-index: 100001;
        left: 14px;
        top: 120px;
        width: 350px;
        max-width: calc(100vw - 28px);
        max-height: calc(100vh - 145px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: #edf2f7;
        background: rgba(23, 28, 36, .97);
        border: 1px solid #526174;
        border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,.55);
        font-size: 13px;
      }
      .mesh-opacity-header {
        flex: 0 0 auto;
        padding: 13px;
        border-bottom: 1px solid #394553;
      }
      .mesh-opacity-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        font-size: 15px;
        font-weight: 700;
      }
      .mesh-opacity-count {
        margin-top: 6px;
        color: #aab5c3;
        font-size: 11px;
      }
      .mesh-opacity-search {
        display: block;
        width: 100%;
        margin-top: 10px;
        padding: 9px 10px;
        color: #fff;
        background: #242c37;
        border: 1px solid #526174;
        border-radius: 5px;
        outline: none;
        font: inherit;
      }
      .mesh-opacity-search:focus { border-color: #78bdf0; }
      .mesh-opacity-actions { display: flex; gap: 7px; margin-top: 9px; }
      .mesh-opacity-button {
        padding: 6px 10px;
        color: #eaf2fa;
        background: #303b49;
        border: 1px solid #526174;
        border-radius: 5px;
        cursor: pointer;
        font: inherit;
      }
      .mesh-opacity-button:hover { background: #405064; }
      .mesh-opacity-close { padding: 4px 8px; font-size: 15px; }
      .mesh-opacity-list {
        min-height: 0;
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 5px 10px 10px;
        overscroll-behavior: contain;
      }
      .mesh-opacity-row {
        padding: 10px 4px;
        border-bottom: 1px solid #303945;
      }
      .mesh-opacity-name {
        color: #f2f6fa;
        font-weight: 700;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .mesh-opacity-path {
        margin: 4px 0 7px;
        color: #94a3b4;
        font-size: 10px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .mesh-opacity-control { display: flex; align-items: center; gap: 9px; }
      .mesh-opacity-range {
        flex: 1;
        min-width: 0;
        accent-color: #65b8f0;
        cursor: pointer;
      }
      .mesh-opacity-value {
        flex: 0 0 43px;
        color: #9dd4ff;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .mesh-opacity-empty {
        padding: 14px 5px;
        color: #aab5c3;
        line-height: 1.5;
      }
      .mesh-opacity-toggle {
        position: fixed;
        z-index: 100002;
        left: 14px;
        top: 72px;
        min-width: 132px;
        height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        gap: 9px;
        padding: 0 12px;
        color: #f4f8fc;
        background: rgba(23, 43, 61, .97);
        border: 1px solid #6486a5;
        border-radius: 8px;
        box-shadow: 0 4px 14px rgba(0,0,0,.46);
        font-family: sans-serif;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: .15px;
        white-space: nowrap;
        cursor: pointer;
        transition: background .16s ease, border-color .16s ease, box-shadow .16s ease;
      }
      .mesh-opacity-toggle-icon {
        display: inline-grid;
        width: 16px;
        flex: 0 0 16px;
        place-items: center;
        font-size: 16px;
        line-height: 1;
      }
      .mesh-opacity-toggle-label {
        display: inline-block;
        font: 600 11px/1 sans-serif;
      }
      .mesh-opacity-toggle:hover {
        background: #226a9a;
        border-color: #8bb8d9;
        box-shadow: 0 5px 16px rgba(0,0,0,.52);
      }
      .mesh-opacity-toggle.is-closed { background: rgba(45, 56, 69, .97); }
      @media (max-width: 600px) {
        .mesh-opacity-panel { left: 8px; top: 105px; width: min(350px, calc(100vw - 16px)); max-height: calc(100vh - 120px); }
        .mesh-opacity-toggle { left: 8px; top: 58px; }
      }
    `;
    document.head.appendChild(style);
    this.injectedStyle = style;
  }

  _createUI() {
    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button';
    this.toggleButton.className = 'mesh-opacity-toggle';
    this.toggleButton.innerHTML = '<span class="mesh-opacity-toggle-icon" aria-hidden="true">◉</span><span class="mesh-opacity-toggle-label">Transparency</span>';
    this.toggleButton.title = 'Hide Transparency panel';
    this.toggleButton.setAttribute('aria-label', 'Toggle Transparency panel');

    this.panel = document.createElement('section');
    this.panel.className = 'mesh-opacity-panel';
    this.panel.setAttribute('aria-label', 'Mesh transparency controls');
    this.panel.innerHTML = `
      <div class="mesh-opacity-header">
        <div class="mesh-opacity-title">
          <span>Mesh Transparency</span>
          <button type="button" class="mesh-opacity-button mesh-opacity-close" aria-label="Hide panel" title="Hide panel">×</button>
        </div>
        <div class="mesh-opacity-count">${this.records.length} individual mesh${this.records.length === 1 ? '' : 'es'} detected</div>
        <input class="mesh-opacity-search" type="search" placeholder="Search mesh names…" aria-label="Search mesh names">
        <div class="mesh-opacity-actions">
          <button type="button" class="mesh-opacity-button mesh-opacity-reset">Restore all</button>
        </div>
      </div>
      <div class="mesh-opacity-list"></div>
    `;

    this.list = this.panel.querySelector('.mesh-opacity-list');
    this.searchInput = this.panel.querySelector('.mesh-opacity-search');

    this.toggleButton.addEventListener('click', () => this.toggle());
    this.panel.querySelector('.mesh-opacity-close').addEventListener('click', () => this.hide());
    this.panel.querySelector('.mesh-opacity-reset').addEventListener('click', () => this.restoreAll());
    this.searchInput.addEventListener('input', () => this._filterRows());

    document.body.append(this.toggleButton, this.panel);
    this.layoutRegistration = registerMeshPanel(this.panel, this.toggleButton, 0);
  }

  _meshPath(mesh) {
    const names = [];
    let current = mesh;
    while (current) {
      if (current.name) names.unshift(current.name);
      current = current.parent;
    }
    return names.join(' / ') || mesh.type || 'Mesh';
  }

  _renderRows() {
    this.list.innerHTML = '';

    if (!this.records.length) {
      this.list.innerHTML = '<div class="mesh-opacity-empty">No renderable meshes were found in this model.</div>';
      return;
    }

    this.records.forEach((record, index) => {
      const row = document.createElement('div');
      row.className = 'mesh-opacity-row';

      const name = document.createElement('div');
      name.className = 'mesh-opacity-name';
      name.textContent = `${index + 1}. ${record.mesh.name || 'Unnamed mesh'}`;

      const path = document.createElement('div');
      path.className = 'mesh-opacity-path';
      path.textContent = this._meshPath(record.mesh);

      const control = document.createElement('div');
      control.className = 'mesh-opacity-control';

      const slider = document.createElement('input');
      slider.className = 'mesh-opacity-range';
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.step = '1';
      slider.value = '100';
      slider.setAttribute('aria-label', `Opacity for ${record.mesh.name || 'unnamed mesh'}`);

      const value = document.createElement('span');
      value.className = 'mesh-opacity-value';
      value.textContent = '100%';

      slider.addEventListener('input', () => {
        this._setOpacity(record, Number(slider.value));
        value.textContent = `${slider.value}%`;
      });

      control.append(slider, value);
      row.append(name, path, control);
      this.list.appendChild(row);

      record.row = row;
      record.searchText = `${record.mesh.name || ''} ${this._meshPath(record)}`.toLowerCase();
    });
  }

  _filterRows() {
    const query = this.searchInput.value.trim().toLowerCase();
    this.records.forEach((record) => {
      record.row.hidden = !record.searchText.includes(query);
    });
  }

  _ensureIndependentMaterials(record) {
    if (record.workingMaterials) return;

    const originals = Array.isArray(record.originalMaterial)
      ? record.originalMaterial
      : [record.originalMaterial];

    record.workingMaterials = originals.map((material) => material.clone());
    record.originalProperties = record.workingMaterials.map((material) => ({
      opacity: material.opacity,
      transparent: material.transparent,
      depthWrite: material.depthWrite,
    }));

    record.mesh.material = Array.isArray(record.originalMaterial)
      ? record.workingMaterials
      : record.workingMaterials[0];
  }

  _setOpacity(record, percentage) {
    this._ensureIndependentMaterials(record);
    const factor = Math.max(0, Math.min(1, percentage / 100));

    record.workingMaterials.forEach((material, index) => {
      const original = record.originalProperties[index];
      material.opacity = original.opacity * factor;
      material.transparent = original.transparent || factor < 0.999;
      material.depthWrite = factor < 0.999 ? false : original.depthWrite;
      material.needsUpdate = true;
    });
  }

  restoreAll() {
    this.records.forEach((record) => {
      if (record.workingMaterials) {
        record.mesh.material = record.originalMaterial;
        record.workingMaterials.forEach((material) => material.dispose());
        record.workingMaterials = null;
        record.originalProperties = null;
      }
      if (record.row) {
        const slider = record.row.querySelector('.mesh-opacity-range');
        const value = record.row.querySelector('.mesh-opacity-value');
        if (slider) slider.value = '100';
        if (value) value.textContent = '100%';
      }
    });
  }

  show() {
    if (this.disposed) return;
    this.panel.hidden = false;
    this.layoutRegistration?.update();
    this.toggleButton.classList.remove('is-closed');
    this.toggleButton.title = 'Hide Transparency panel';
    this.toggleButton.setAttribute('aria-expanded', 'true');
  }

  hide() {
    if (this.disposed) return;
    this.panel.hidden = true;
    this.layoutRegistration?.update();
    this.toggleButton.classList.add('is-closed');
    this.toggleButton.title = 'Show Transparency panel';
    this.toggleButton.setAttribute('aria-expanded', 'false');
  }

  toggle() {
    if (this.panel.hidden) this.show();
    else this.hide();
  }

  dispose() {
    if (this.disposed) return;
    this.restoreAll();
    this.layoutRegistration?.unregister();
    this.panel.remove();
    this.toggleButton.remove();
    if (this.injectedStyle) this.injectedStyle.remove();
    this.disposed = true;
  }
}
