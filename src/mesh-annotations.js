import { Vector3 } from 'three';
import { registerMeshPanel } from './mesh-panel-layout.js';

const STYLE_ID = 'mesh-annotation-controller-styles';
const FORMAT = 'three-gltf-viewer-annotations';

export class MeshAnnotationController {
  constructor(root, viewer, modelKey, onSelect = () => {}) {
    this.root = root;
    this.viewer = viewer;
    this.modelKey = String(modelKey || 'uploaded-model');
    this.onSelect = onSelect;
    this.records = [];
    this.annotations = Object.create(null);
    this.activeRecord = null;
    this.previewRecord = null;
    this.showLabels = true;
    this.disposed = false;
    this.frameId = null;

    this._collectMeshes();
    this._loadAnnotations();
    this._injectStyles();
    this._createUI();
    this._renderRows();
    this._createOverlay();
    this._bindEvents();
    this._updateCounts();
    this._ensureFrameLoop();
  }

  _collectMeshes() {
    this.root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry) return;
      this.records.push({
        mesh,
        row: null,
        marker: null,
        path: this._stablePath(mesh),
        displayPath: this._displayPath(mesh),
        searchText: '',
        localCenter: null,
      });
    });
  }

  _stablePath(mesh) {
    const segments = [];
    let current = mesh;
    while (current && current !== this.root) {
      const parent = current.parent;
      const index = parent ? parent.children.indexOf(current) : 0;
      segments.unshift((current.name || current.type || 'Object') + '[' + index + ']');
      current = parent;
    }
    return segments.join(' / ') || mesh.name || mesh.type || 'Mesh';
  }

  _displayPath(mesh) {
    const names = [];
    let current = mesh;
    while (current) {
      if (current.name) names.unshift(current.name);
      current = current.parent;
    }
    return names.join(' / ') || mesh.type || 'Mesh';
  }

  _loadAnnotations() {
    try {
      const saved = window.localStorage.getItem(this._storageKey());
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && parsed.annotations && typeof parsed.annotations === 'object') {
        this.annotations = parsed.annotations;
      }
    } catch (error) {
      console.warn('[Mesh Annotations] Unable to read saved annotations.', error);
    }
  }

  _storageKey() {
    return 'three-gltf-viewer:mesh-annotations:' + this.modelKey;
  }

  _persist() {
    try {
      window.localStorage.setItem(
        this._storageKey(),
        JSON.stringify({
          format: FORMAT,
          modelKey: this.modelKey,
          annotations: this.annotations,
        }),
      );
    } catch (error) {
      console.warn('[Mesh Annotations] Unable to save annotations in this browser.', error);
      this._setStatus('Browser storage is unavailable. Export your annotations to keep a copy.');
    }
  }

  _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.mesh-annotation-panel,.mesh-annotation-toggle,.mesh-annotation-editor{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}',
      '.mesh-annotation-panel *,.mesh-annotation-toggle *,.mesh-annotation-editor *{box-sizing:border-box}',
      '.mesh-annotation-panel[hidden],.mesh-annotation-editor[hidden],.mesh-annotation-preview[hidden]{display:none!important}',
      '.mesh-annotation-panel{z-index:100001;display:flex;flex-direction:column;overflow:hidden;color:#edf2f7;background:rgba(23,28,36,.98);border:1px solid #526174;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.55);font-size:13px}',
      '.mesh-annotation-header{flex:0 0 auto;padding:11px 13px;border-bottom:1px solid #394553}',
      '.mesh-annotation-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px;font-weight:700}',
      '.mesh-annotation-count{margin-top:5px;color:#aab5c3;font-size:11px}',
      '.mesh-annotation-search{display:block;width:100%;margin-top:9px;padding:8px 10px;color:#fff;background:#242c37;border:1px solid #526174;border-radius:5px;outline:none;font:inherit}',
      '.mesh-annotation-search:focus,.mesh-annotation-field:focus{border-color:#78bdf0;outline:none}',
      '.mesh-annotation-toolbar{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.mesh-annotation-button{padding:6px 9px;color:#eaf2fa;background:#303b49;border:1px solid #526174;border-radius:5px;cursor:pointer;font:inherit}',
      '.mesh-annotation-button:hover{background:#405064}',
      '.mesh-annotation-button.primary{color:#fff;background:#17618d;border-color:#3887b7}',
      '.mesh-annotation-button.primary:hover{background:#1e76a9}',
      '.mesh-annotation-button:disabled{opacity:.4;cursor:not-allowed}',
      '.mesh-annotation-close{padding:3px 8px;font-size:16px}',
      '.mesh-annotation-list{min-height:0;flex:1 1 auto;overflow-y:auto;padding:5px 9px 9px;overscroll-behavior:contain}',
      '.mesh-annotation-item{display:flex;width:100%;align-items:flex-start;gap:8px;padding:8px 7px;color:#edf2f7;background:transparent;border:0;border-bottom:1px solid #303945;border-radius:4px;text-align:left;cursor:pointer}',
      '.mesh-annotation-item:hover{background:#2a3542}',
      '.mesh-annotation-item.selected{background:#174e75;outline:1px solid #65b8f0;color:#fff}',
      '.mesh-annotation-item-copy{min-width:0;flex:1 1 auto}',
      '.mesh-annotation-name{display:block;font-weight:700;line-height:1.35;overflow-wrap:anywhere}',
      '.mesh-annotation-path{display:block;margin-top:3px;color:#9eabba;font-size:10px;line-height:1.35;overflow-wrap:anywhere}',
      '.mesh-annotation-item.selected .mesh-annotation-path{color:#c5e6ff}',
      '.mesh-annotation-status{flex:0 0 auto;margin-top:1px;padding:3px 5px;color:#aebccc;background:#303b49;border-radius:4px;font-size:9px;font-weight:700;letter-spacing:.04em}',
      '.mesh-annotation-status.saved{color:#a8e3c2;background:#174b3b}',
      '.mesh-annotation-empty{padding:14px 5px;color:#aab5c3;line-height:1.5}',
      '.mesh-annotation-toggle{position:fixed;z-index:100002;left:14px;width:38px;height:38px;display:grid;place-items:center;padding:0;color:#fff;background:#174e75;border:1px solid #6486a5;border-radius:8px;box-shadow:0 3px 12px rgba(0,0,0,.5);font-size:18px;line-height:1;cursor:pointer}',
      '.mesh-annotation-toggle:hover{background:#226a9a}',
      '.mesh-annotation-toggle.is-closed{background:#38424e}',
      '.mesh-annotation-editor{position:fixed;z-index:100004;left:374px;top:174px;width:360px;max-width:calc(100vw - 400px);max-height:calc(100vh - 28px);overflow:auto;padding:16px;color:#edf2f7;background:rgba(23,28,36,.99);border:1px solid #6486a5;border-radius:12px;box-shadow:0 14px 46px rgba(0,0,0,.62);font-size:13px}',
      '.mesh-annotation-editor-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}',
      '.mesh-annotation-editor-title{font-size:16px;font-weight:700;line-height:1.3}',
      '.mesh-annotation-editor-mesh{margin-top:4px;color:#9eabba;font-size:10px;line-height:1.4;overflow-wrap:anywhere}',
      '.mesh-annotation-field-wrap{display:block;margin:11px 0}',
      '.mesh-annotation-label{display:block;margin-bottom:5px;color:#c8d3df;font-size:11px;font-weight:700}',
      '.mesh-annotation-field{display:block;width:100%;padding:9px 10px;color:#fff;background:#202833;border:1px solid #526174;border-radius:6px;font:inherit;line-height:1.45}',
      '.mesh-annotation-field::placeholder{color:#8291a2}',
      '.mesh-annotation-details{min-height:104px;resize:vertical}',
      '.mesh-annotation-help{margin:8px 0;color:#93a3b5;font-size:10px;line-height:1.45}',
      '.mesh-annotation-error{min-height:16px;color:#ffb4a8;font-size:11px}',
      '.mesh-annotation-editor-actions{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:10px}',
      '.mesh-annotation-editor-actions .spacer{flex:1}',
      '.mesh-annotation-overlay{position:absolute;inset:0;z-index:6;overflow:hidden;pointer-events:none}',
      '.mesh-annotation-marker{position:absolute;max-width:220px;transform:translate(-50%,-100%);padding:6px 9px;color:#fff;background:rgba(19,29,40,.94);border:1px solid #79b9e5;border-radius:6px;box-shadow:0 3px 12px rgba(0,0,0,.45);font:600 11px/1.25 Arial,Helvetica,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;pointer-events:auto}',
      '.mesh-annotation-marker:before{content:"";display:inline-block;width:6px;height:6px;margin-right:6px;background:#ffb347;border-radius:50%;vertical-align:1px}',
      '.mesh-annotation-marker:hover{background:#17537b;border-color:#b5e0ff}',
      '.mesh-annotation-marker[hidden]{display:none!important}',
      '.mesh-annotation-preview{position:absolute;z-index:8;width:280px;max-width:calc(100% - 20px);padding:13px;color:#edf2f7;background:rgba(23,28,36,.98);border:1px solid #79b9e5;border-radius:9px;box-shadow:0 8px 28px rgba(0,0,0,.55);font-family:Arial,Helvetica,sans-serif;pointer-events:auto}',
      '.mesh-annotation-preview-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}',
      '.mesh-annotation-preview-title{font-size:14px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}',
      '.mesh-annotation-preview-subtitle{margin-top:5px;color:#a9d8f7;font-size:11px;line-height:1.4}',
      '.mesh-annotation-preview-details{margin-top:8px;color:#d4dde7;font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.mesh-annotation-preview-close{padding:1px 6px;color:#dce6ef;background:#303b49;border:1px solid #526174;border-radius:4px;cursor:pointer;font:inherit}',
      '@media(max-width:760px){.mesh-annotation-editor{left:14px;top:auto;bottom:14px;width:calc(100vw - 28px);max-width:none;max-height:62vh}}',
    ].join('\n');
    document.head.appendChild(style);
    this.injectedStyle = style;
  }

  _createUI() {
    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button';
    this.toggleButton.className = 'mesh-annotation-toggle';
    this.toggleButton.textContent = '✎';
    this.toggleButton.title = 'Show mesh annotations';
    this.toggleButton.setAttribute('aria-label', 'Toggle mesh annotations');

    this.panel = document.createElement('section');
    this.panel.className = 'mesh-annotation-panel';
    this.panel.setAttribute('aria-label', 'Mesh annotations');
    this.panel.innerHTML = [
      '<div class="mesh-annotation-header">',
      '  <div class="mesh-annotation-heading">',
      '    <span>Object Annotations</span>',
      '    <button type="button" class="mesh-annotation-button mesh-annotation-close mesh-annotation-hide" aria-label="Hide panel" title="Hide panel">×</button>',
      '  </div>',
      '  <div class="mesh-annotation-count"></div>',
      '  <input class="mesh-annotation-search" type="search" placeholder="Find a mesh to annotate…" aria-label="Search meshes">',
      '  <div class="mesh-annotation-toolbar">',
      '    <button type="button" class="mesh-annotation-button mesh-annotation-export">Export</button>',
      '    <button type="button" class="mesh-annotation-button mesh-annotation-import">Import</button>',
      '    <button type="button" class="mesh-annotation-button mesh-annotation-labels">Labels: On</button>',
      '  </div>',
      '</div>',
      '<div class="mesh-annotation-list"></div>',
    ].join('');

    this.list = this.panel.querySelector('.mesh-annotation-list');
    this.searchInput = this.panel.querySelector('.mesh-annotation-search');
    this.countLabel = this.panel.querySelector('.mesh-annotation-count');
    this.exportButton = this.panel.querySelector('.mesh-annotation-export');
    this.importButton = this.panel.querySelector('.mesh-annotation-import');
    this.labelsButton = this.panel.querySelector('.mesh-annotation-labels');

    this.editor = document.createElement('section');
    this.editor.className = 'mesh-annotation-editor';
    this.editor.hidden = true;
    this.editor.setAttribute('role', 'dialog');
    this.editor.setAttribute('aria-modal', 'false');
    this.editor.setAttribute('aria-label', 'Edit mesh annotation');
    this.editor.innerHTML = [
      '<div class="mesh-annotation-editor-top">',
      '  <div>',
      '    <div class="mesh-annotation-editor-title">Edit object annotation</div>',
      '    <div class="mesh-annotation-editor-mesh"></div>',
      '  </div>',
      '  <button type="button" class="mesh-annotation-button mesh-annotation-close mesh-annotation-editor-close" aria-label="Close editor" title="Close editor">×</button>',
      '</div>',
      '<label class="mesh-annotation-field-wrap">',
      '  <span class="mesh-annotation-label">Heading / title</span>',
      '  <input class="mesh-annotation-field mesh-annotation-title-input" type="text" maxlength="120" placeholder="e.g. 380 kV circuit breaker">',
      '</label>',
      '<label class="mesh-annotation-field-wrap">',
      '  <span class="mesh-annotation-label">Subtitle</span>',
      '  <input class="mesh-annotation-field mesh-annotation-subtitle-input" type="text" maxlength="180" placeholder="Short description or component type">',
      '</label>',
      '<label class="mesh-annotation-field-wrap">',
      '  <span class="mesh-annotation-label">Details / information</span>',
      '  <textarea class="mesh-annotation-field mesh-annotation-details mesh-annotation-details-input" maxlength="2000" placeholder="Write a brief explanation, specification, or client-facing note…"></textarea>',
      '</label>',
      '<div class="mesh-annotation-help">Saved annotations appear as small labels beside the object in the 3D view. Click a label to read its details.</div>',
      '<div class="mesh-annotation-error" aria-live="polite"></div>',
      '<div class="mesh-annotation-editor-actions">',
      '  <button type="button" class="mesh-annotation-button mesh-annotation-remove">Remove</button>',
      '  <span class="spacer"></span>',
      '  <button type="button" class="mesh-annotation-button mesh-annotation-cancel">Cancel</button>',
      '  <button type="button" class="mesh-annotation-button primary mesh-annotation-save">Save annotation</button>',
      '</div>',
    ].join('');

    this.titleInput = this.editor.querySelector('.mesh-annotation-title-input');
    this.subtitleInput = this.editor.querySelector('.mesh-annotation-subtitle-input');
    this.detailsInput = this.editor.querySelector('.mesh-annotation-details-input');
    this.editorMeshLabel = this.editor.querySelector('.mesh-annotation-editor-mesh');
    this.errorLabel = this.editor.querySelector('.mesh-annotation-error');
    this.removeButton = this.editor.querySelector('.mesh-annotation-remove');

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json,.json';
    this.fileInput.hidden = true;

    document.body.append(this.toggleButton, this.panel, this.editor, this.fileInput);
    this.layoutRegistration = registerMeshPanel(this.panel, this.toggleButton, 2);
  }

  _createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'mesh-annotation-overlay';
    this.viewer.el.appendChild(this.overlay);

    this.records.forEach((record) => this._ensureMarker(record));

    this.preview = document.createElement('div');
    this.preview.className = 'mesh-annotation-preview';
    this.preview.hidden = true;
    this.preview.innerHTML = [
      '<div class="mesh-annotation-preview-top">',
      '  <div class="mesh-annotation-preview-copy">',
      '    <div class="mesh-annotation-preview-title"></div>',
      '    <div class="mesh-annotation-preview-subtitle"></div>',
      '  </div>',
      '  <button type="button" class="mesh-annotation-preview-close" aria-label="Close information">×</button>',
      '</div>',
      '<div class="mesh-annotation-preview-details"></div>',
    ].join('');
    this.previewTitle = this.preview.querySelector('.mesh-annotation-preview-title');
    this.previewSubtitle = this.preview.querySelector('.mesh-annotation-preview-subtitle');
    this.previewDetails = this.preview.querySelector('.mesh-annotation-preview-details');
    this.preview.querySelector('.mesh-annotation-preview-close').addEventListener('click', () => this._hidePreview());
    this.overlay.appendChild(this.preview);
  }

  _bindEvents() {
    this.toggleButton.addEventListener('click', () => this.toggle());
    this.panel.querySelector('.mesh-annotation-hide').addEventListener('click', () => this.hide());
    this.searchInput.addEventListener('input', () => this._filterRows());
    this.exportButton.addEventListener('click', () => this.exportAnnotations());
    this.importButton.addEventListener('click', () => this.fileInput.click());
    this.labelsButton.addEventListener('click', () => this._toggleLabels());
    this.fileInput.addEventListener('change', (event) => this._importFile(event));
    this.editor.querySelector('.mesh-annotation-editor-close').addEventListener('click', () => this._closeEditor());
    this.editor.querySelector('.mesh-annotation-cancel').addEventListener('click', () => this._closeEditor());
    this.editor.querySelector('.mesh-annotation-save').addEventListener('click', () => this._saveActiveAnnotation());
    this.removeButton.addEventListener('click', () => this._removeActiveAnnotation());
    this._onKeyDown = (event) => {
      if (event.key === 'Escape') {
        this._closeEditor();
        this._hidePreview();
      }
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  _renderRows() {
    this.list.innerHTML = '';
    if (!this.records.length) {
      this.list.innerHTML = '<div class="mesh-annotation-empty">No renderable meshes were found in this model.</div>';
      return;
    }

    this.records.forEach((record, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mesh-annotation-item';
      button.setAttribute('aria-pressed', 'false');

      const copy = document.createElement('span');
      copy.className = 'mesh-annotation-item-copy';

      const name = document.createElement('span');
      name.className = 'mesh-annotation-name';
      name.textContent = (index + 1) + '. ' + (record.mesh.name || 'Unnamed mesh');

      const path = document.createElement('span');
      path.className = 'mesh-annotation-path';
      path.textContent = record.displayPath;

      const status = document.createElement('span');
      status.className = 'mesh-annotation-status';

      copy.append(name, path);
      button.append(copy, status);
      button.addEventListener('click', () => this._activate(record, true, true));
      this.list.appendChild(button);

      record.row = button;
      record.status = status;
      record.searchText = ((record.mesh.name || '') + ' ' + record.displayPath).toLowerCase();
      this._refreshRecord(record);
    });
  }

  _refreshRecord(record) {
    if (!record.row) return;
    const annotation = this.annotations[record.path];
    record.row.classList.toggle('selected', this.activeRecord === record);
    record.row.setAttribute('aria-pressed', String(this.activeRecord === record));
    record.status.textContent = annotation ? 'SAVED' : 'ADD';
    record.status.classList.toggle('saved', Boolean(annotation));
    if (record.marker) {
      record.marker.textContent = 'i  ' + (annotation.title || annotation.subtitle || record.mesh.name || 'Information');
      record.marker.title = annotation.title || annotation.subtitle || 'View object information';
      record.marker.hidden = !this.showLabels || !annotation;
    }
  }

  _filterRows() {
    const query = this.searchInput.value.trim().toLowerCase();
    this.records.forEach((record) => {
      record.row.hidden = !record.searchText.includes(query);
    });
    const matches = this.records.filter((record) => !query || record.searchText.includes(query)).length;
    if (this.countLabel) {
      this.countLabel.textContent = query
        ? matches + ' matching / ' + this.records.length + ' meshes'
        : this._countText();
    }
  }

  _countText() {
    const saved = Object.keys(this.annotations).length;
    return this.records.length + ' meshes · ' + saved + ' annotated';
  }

  _updateCounts() {
    this.countLabel.textContent = this._countText();
    this.exportButton.disabled = Object.keys(this.annotations).length === 0;
  }

  _activate(record, openEditor, notify) {
    if (this.disposed || !record) return;
    this.activeRecord = record;
    this.records.forEach((item) => this._refreshRecord(item));
    if (openEditor) {
      this._hidePreview();
      this._openEditor(record);
    } else {
      this._closeEditor();
    }
    if (notify) this.onSelect(record.mesh);
  }

  syncSelection(mesh, openEditor = true) {
    if (this.disposed) return;
    if (!mesh) {
      this.activeRecord = null;
      this.records.forEach((record) => this._refreshRecord(record));
      this._closeEditor();
      return;
    }
    const record = this.records.find((item) => item.mesh === mesh);
    if (!record) return;
    this._activate(record, openEditor, false);
  }

  _openEditor(record) {
    this.activeRecord = record;
    const annotation = this.annotations[record.path] || {};
    this.editorMeshLabel.textContent = this._displayPath(record.mesh);
    this.titleInput.value = annotation.title || '';
    this.subtitleInput.value = annotation.subtitle || '';
    this.detailsInput.value = annotation.details || '';
    this.errorLabel.textContent = '';
    this.removeButton.hidden = !this.annotations[record.path];
    this.editor.hidden = false;
    this.titleInput.focus();
    this.titleInput.select();
  }

  _closeEditor() {
    if (!this.editor) return;
    this.editor.hidden = true;
    this.errorLabel.textContent = '';
  }

  _saveActiveAnnotation() {
    if (!this.activeRecord) return;
    const title = this.titleInput.value.trim();
    const subtitle = this.subtitleInput.value.trim();
    const details = this.detailsInput.value.trim();

    if (!title && !subtitle && !details) {
      this.errorLabel.textContent = 'Add a title, subtitle, or details before saving.';
      return;
    }

    this.annotations[this.activeRecord.path] = {
      meshName: this.activeRecord.mesh.name || 'Unnamed mesh',
      path: this.activeRecord.path,
      title,
      subtitle,
      details,
    };
    this._persist();
    this._refreshRecord(this.activeRecord);
    this._updateCounts();
    this._ensureFrameLoop();
    this._setStatus('Annotation saved for ' + (this.activeRecord.mesh.name || 'this mesh') + '.');
    this.removeButton.hidden = false;
  }

  _removeActiveAnnotation() {
    if (!this.activeRecord || !this.annotations[this.activeRecord.path]) return;
    delete this.annotations[this.activeRecord.path];
    this._persist();
    this._refreshRecord(this.activeRecord);
    this._updateCounts();
    if (this.previewRecord === this.activeRecord) this._hidePreview();
    this._setStatus('Annotation removed.');
    this.titleInput.value = '';
    this.subtitleInput.value = '';
    this.detailsInput.value = '';
    this.removeButton.hidden = true;
  }

  _ensureMarker(record) {
    if (record.marker || !this.overlay) return;
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'mesh-annotation-marker';
    marker.addEventListener('click', () => {
      this._activate(record, false, false);
      this._showPreview(record);
      this.onSelect(record.mesh);
    });
    this.overlay.appendChild(marker);
    record.marker = marker;
    this._refreshRecord(record);
  }

  _toggleLabels() {
    this.showLabels = !this.showLabels;
    this.labelsButton.textContent = 'Labels: ' + (this.showLabels ? 'On' : 'Off');
    this.records.forEach((record) => this._refreshRecord(record));
  }

  _createLocalCenter(record) {
    const geometry = record.mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      record.localCenter = geometry.boundingBox.getCenter(new Vector3());
    } else {
      record.localCenter = new Vector3();
    }
  }

  _ensureFrameLoop() {
    if (this.disposed || this.frameId !== null || !Object.keys(this.annotations).length) return;
    const tick = () => {
      if (this.disposed) return;
      this._updateMarkers();
      if (Object.keys(this.annotations).length) {
        this.frameId = window.requestAnimationFrame(tick);
      } else {
        this.frameId = null;
      }
    };
    this.frameId = window.requestAnimationFrame(tick);
  }

  _updateMarkers() {
    if (!this.viewer || !this.viewer.renderer || !this.viewer.activeCamera || !this.overlay) return;

    const canvasRect = this.viewer.renderer.domElement.getBoundingClientRect();
    const overlayRect = this.overlay.getBoundingClientRect();
    const camera = this.viewer.activeCamera;
    camera.updateMatrixWorld();

    const ndc = new Vector3();
    const world = new Vector3();

    this.records.forEach((record) => {
      const annotation = this.annotations[record.path];
      if (!annotation) {
        if (record.marker) record.marker.hidden = true;
        return;
      }
      this._ensureMarker(record);

      if (!this.showLabels) {
        record.marker.hidden = true;
        return;
      }

      if (!record.localCenter) this._createLocalCenter(record);
      record.mesh.updateWorldMatrix(true, false);
      world.copy(record.localCenter);
      record.mesh.localToWorld(world);
      ndc.copy(world).project(camera);

      const visible = ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
      record.marker.hidden = !visible;
      if (!visible) return;

      const x = canvasRect.left - overlayRect.left + ((ndc.x + 1) / 2) * canvasRect.width;
      const y = canvasRect.top - overlayRect.top + ((1 - ndc.y) / 2) * canvasRect.height;
      record.marker.style.left = x + 'px';
      record.marker.style.top = y + 'px';

      if (record === this.previewRecord && !this.preview.hidden) {
        const previewWidth = Math.min(280, Math.max(180, overlayRect.width - 20));
        const left = Math.min(Math.max(10, x + 14), Math.max(10, overlayRect.width - previewWidth - 10));
        const top = Math.min(Math.max(10, y - 8), Math.max(10, overlayRect.height - 160));
        this.preview.style.left = left + 'px';
        this.preview.style.top = top + 'px';
      }
    });
  }

  _showPreview(record) {
    const annotation = this.annotations[record.path];
    if (!annotation) return;
    this.previewRecord = record;
    this.previewTitle.textContent = annotation.title || record.mesh.name || 'Object information';
    this.previewSubtitle.textContent = annotation.subtitle || '';
    this.previewSubtitle.hidden = !annotation.subtitle;
    this.previewDetails.textContent = annotation.details || '';
    this.previewDetails.hidden = !annotation.details;
    this.preview.hidden = false;
    this._updateMarkers();
  }

  _hidePreview() {
    if (this.preview) this.preview.hidden = true;
    this.previewRecord = null;
  }

  _setStatus(message) {
    this.countLabel.textContent = message;
    window.setTimeout(() => {
      if (!this.disposed && this.countLabel) this.countLabel.textContent = this._countText();
    }, 2600);
  }

  exportAnnotations() {
    const entries = Object.values(this.annotations);
    if (!entries.length) return;
    const payload = {
      format: FORMAT,
      version: 1,
      modelKey: this.modelKey,
      exportedAt: new Date().toISOString(),
      annotations: entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mesh-annotations.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this._setStatus('Annotation file exported.');
  }

  async _importFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!payload || payload.format !== FORMAT || !Array.isArray(payload.annotations)) {
        throw new Error('This is not a supported mesh annotation file.');
      }

      let imported = 0;
      let unmatched = 0;
      payload.annotations.forEach((annotation) => {
        if (!annotation || typeof annotation.path !== 'string') {
          unmatched++;
          return;
        }
        const record = this.records.find((item) => item.path === annotation.path);
        if (!record) {
          unmatched++;
          return;
        }
        this.annotations[record.path] = {
          meshName: record.mesh.name || 'Unnamed mesh',
          path: record.path,
          title: String(annotation.title || '').slice(0, 120),
          subtitle: String(annotation.subtitle || '').slice(0, 180),
          details: String(annotation.details || '').slice(0, 2000),
        };
        imported++;
      });

      this._persist();
      this.records.forEach((record) => this._refreshRecord(record));
      this._updateCounts();
      this._ensureFrameLoop();
      this._setStatus(imported + ' annotations imported' + (unmatched ? ' · ' + unmatched + ' unmatched' : '') + '.');
    } catch (error) {
      window.alert('Unable to import annotations: ' + error.message);
    } finally {
      this.fileInput.value = '';
    }
  }

  show() {
    if (this.disposed) return;
    this.panel.hidden = false;
    this.layoutRegistration && this.layoutRegistration.update();
    this.toggleButton.classList.remove('is-closed');
    this.toggleButton.title = 'Hide mesh annotations';
    this.toggleButton.setAttribute('aria-expanded', 'true');
  }

  hide() {
    if (this.disposed) return;
    this.panel.hidden = true;
    this.layoutRegistration && this.layoutRegistration.update();
    this.toggleButton.classList.add('is-closed');
    this.toggleButton.title = 'Show mesh annotations';
    this.toggleButton.setAttribute('aria-expanded', 'false');
  }

  toggle() {
    if (this.panel.hidden) this.show();
    else this.hide();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameId !== null) window.cancelAnimationFrame(this.frameId);
    document.removeEventListener('keydown', this._onKeyDown);
    if (this.layoutRegistration) this.layoutRegistration.unregister();
    this.panel.remove();
    this.toggleButton.remove();
    this.editor.remove();
    this.fileInput.remove();
    this.overlay.remove();
    if (this.injectedStyle) this.injectedStyle.remove();
  }
}
