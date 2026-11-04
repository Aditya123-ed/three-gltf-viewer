import { registerMeshPanel } from './mesh-panel-layout.js';

const STYLE_ID = 'mesh-selection-controller-styles';

export class MeshSelectionController {
  constructor(root, onSelect = () => {}) {
    this.root = root;
    this.onSelect = onSelect;
    this.records = [];
    this.selectedMesh = null;
    this.disposed = false;

    this._collectMeshes();
    this._injectStyles();
    this._createUI();
    this._renderRows();
  }

  _collectMeshes() {
    this.root.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;

      this.records.push({
        mesh: object,
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
      .mesh-selection-panel,
      .mesh-selection-toggle {
        font-family: Arial, Helvetica, sans-serif;
        box-sizing: border-box;
      }
      .mesh-selection-panel *,
      .mesh-selection-toggle * { box-sizing: border-box; }
      .mesh-selection-panel[hidden] { display: none; }
      .mesh-selection-panel {
        position: fixed;
        z-index: 100001;
        left: 14px;
        top: 170px;
        width: 350px;
        max-width: calc(100vw - 28px);
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
      .mesh-selection-header {
        flex: 0 0 auto;
        padding: 13px;
        border-bottom: 1px solid #394553;
      }
      .mesh-selection-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        font-size: 15px;
        font-weight: 700;
      }
      .mesh-selection-count {
        margin-top: 6px;
        color: #aab5c3;
        font-size: 11px;
      }
      .mesh-selection-search {
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
      .mesh-selection-search:focus { border-color: #78bdf0; }
      .mesh-selection-actions {
        display: flex;
        gap: 7px;
        margin-top: 9px;
      }
      .mesh-selection-button {
        padding: 6px 10px;
        color: #eaf2fa;
        background: #303b49;
        border: 1px solid #526174;
        border-radius: 5px;
        cursor: pointer;
        font: inherit;
      }
      .mesh-selection-button:hover { background: #405064; }
      .mesh-selection-list {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 5px 10px 10px;
        overscroll-behavior: contain;
      }
      .mesh-selection-item {
        display: block;
        width: 100%;
        padding: 9px 7px;
        color: #edf2f7;
        background: transparent;
        border: 0;
        border-bottom: 1px solid #303945;
        border-radius: 4px;
        text-align: left;
        cursor: pointer;
      }
      .mesh-selection-item:hover { background: #2a3542; }
      .mesh-selection-item.selected {
        color: #fff;
        background: #174e75;
        outline: 1px solid #65b8f0;
      }
      .mesh-selection-name {
        display: block;
        font-weight: 700;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .mesh-selection-path {
        display: block;
        margin-top: 4px;
        color: #9eabba;
        font-size: 10px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .mesh-selection-item.selected .mesh-selection-path { color: #c5e6ff; }
      .mesh-selection-empty {
        padding: 14px 5px;
        color: #aab5c3;
        line-height: 1.5;
      }
      .mesh-selection-toggle {
        position: fixed;
        z-index: 100002;
        left: 14px;
        top: 116px;
        width: 38px;
        height: 38px;
        display: grid;
        place-items: center;
        padding: 0;
        color: #fff;
        background: #174e75;
        border: 1px solid #6486a5;
        border-radius: 8px;
        box-shadow: 0 3px 12px rgba(0,0,0,.5);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
      .mesh-selection-toggle:hover { background: #226a9a; }
      .mesh-selection-toggle.is-closed { background: #38424e; }
    `;
    document.head.appendChild(style);
    this.injectedStyle = style;
  }

  _createUI() {
    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button';
    this.toggleButton.className = 'mesh-selection-toggle';
    this.toggleButton.textContent = '☷';
    this.toggleButton.title = 'Hide mesh selection list';
    this.toggleButton.setAttribute('aria-label', 'Toggle mesh selection list');

    this.panel = document.createElement('section');
    this.panel.className = 'mesh-selection-panel';
    this.panel.setAttribute('aria-label', 'Mesh selection list');
    this.panel.innerHTML = `
      <div class="mesh-selection-header">
        <div class="mesh-selection-title">
          <span>Mesh Selection</span>
          <button type="button" class="mesh-selection-button mesh-selection-close"
            aria-label="Hide panel" title="Hide panel">×</button>
        </div>
        <div class="mesh-selection-count">${this.records.length} mesh${this.records.length === 1 ? '' : 'es'} available</div>
        <input class="mesh-selection-search" type="search"
          placeholder="Search mesh names…" aria-label="Search mesh names">
        <div class="mesh-selection-actions">
          <button type="button" class="mesh-selection-button mesh-selection-clear">Clear selection</button>
        </div>
      </div>
      <div class="mesh-selection-list"></div>
    `;

    this.list = this.panel.querySelector('.mesh-selection-list');
    this.searchInput = this.panel.querySelector('.mesh-selection-search');

    this.toggleButton.addEventListener('click', () => this.toggle());
    this.panel.querySelector('.mesh-selection-close').addEventListener('click', () => this.hide());
    this.panel.querySelector('.mesh-selection-clear').addEventListener('click', () => this.clearSelection());

    this.searchInput.addEventListener('input', () => this._filterRows());

    document.body.append(this.toggleButton, this.panel);
    this.layoutRegistration = registerMeshPanel(this.panel, this.toggleButton, 1);
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
      this.list.innerHTML = '<div class="mesh-selection-empty">No renderable meshes were found in this model.</div>';
      return;
    }

    this.records.forEach((record, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mesh-selection-item';
      button.setAttribute('aria-pressed', 'false');

      const name = document.createElement('span');
      name.className = 'mesh-selection-name';
      name.textContent = `${index + 1}. ${record.mesh.name || 'Unnamed mesh'}`;

      const path = document.createElement('span');
      path.className = 'mesh-selection-path';
      path.textContent = this._meshPath(record.mesh);

      button.append(name, path);
      button.addEventListener('click', () => this.select(record.mesh));

      this.list.appendChild(button);
      record.row = button;
      record.searchText = `${record.mesh.name || ''} ${this._meshPath(record.mesh)}`.toLowerCase();
    });
  }

  _filterRows() {
    const query = this.searchInput.value.trim().toLowerCase();
    const matchingRecords = [];

    this.records.forEach((record) => {
      const matches = !query || record.searchText.includes(query);
      record.row.hidden = !matches;
      if (matches) matchingRecords.push(record);
    });

    // Update the result count so the search feedback is visible.
    const countLabel = this.panel.querySelector('.mesh-selection-count');
    if (countLabel) {
      countLabel.textContent = query
        ? `${matchingRecords.length} matching / ${this.records.length} meshes`
        : `${this.records.length} mesh${this.records.length === 1 ? '' : 'es'} available`;
    }

    if (!query) return;

    // Prefer a single exact mesh-name or full hierarchy-path match.
    const exactMatches = matchingRecords.filter((record) => {
      const meshName = (record.mesh.name || '').trim().toLowerCase();
      const meshPath = this._meshPath(record.mesh).trim().toLowerCase();
      return meshName === query || meshPath === query;
    });

    let autoMatch = null;
    if (exactMatches.length === 1) {
      autoMatch = exactMatches[0];
    } else if (exactMatches.length === 0 && matchingRecords.length === 1) {
      // Also auto-select when the typed partial name identifies only one mesh.
      autoMatch = matchingRecords[0];
    }

    if (autoMatch) {
      this.select(autoMatch.mesh);
    } else if (
      this.selectedMesh &&
      !matchingRecords.some((record) => record.mesh === this.selectedMesh)
    ) {
      // Don't leave an old mesh highlighted when it no longer matches the search.
      this.clearSelection();
    }
  }

  syncSelection(mesh) {
    if (this.disposed) return;
    this.selectedMesh = mesh || null;

    this.records.forEach((record) => {
      const selected = record.mesh === this.selectedMesh;
      record.row.classList.toggle('selected', selected);
      record.row.setAttribute('aria-pressed', String(selected));
      if (selected) record.row.scrollIntoView({ block: 'nearest' });
    });
  }

  select(mesh) {
    if (this.disposed) return;
    this.syncSelection(mesh);
    this.onSelect(mesh);
  }

  clearSelection() {
    if (this.disposed) return;
    this.syncSelection(null);
    this.onSelect(null);
  }

  show() {
    if (this.disposed) return;
    this.panel.hidden = false;
    this.layoutRegistration?.update();
    this.toggleButton.classList.remove('is-closed');
    this.toggleButton.title = 'Hide mesh selection list';
    this.toggleButton.setAttribute('aria-expanded', 'true');
  }

  hide() {
    if (this.disposed) return;
    this.panel.hidden = true;
    this.layoutRegistration?.update();
    this.toggleButton.classList.add('is-closed');
    this.toggleButton.title = 'Show mesh selection list';
    this.toggleButton.setAttribute('aria-expanded', 'false');
  }

  toggle() {
    if (this.panel.hidden) this.show();
    else this.hide();
  }

  dispose() {
    if (this.disposed) return;
    this.onSelect(null);
    this.layoutRegistration?.unregister();
    this.panel.remove();
    this.toggleButton.remove();
    if (this.injectedStyle) this.injectedStyle.remove();
    this.disposed = true;
  }
}
