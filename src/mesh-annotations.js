import { Vector3 } from 'three';
import { registerMeshPanel } from './mesh-panel-layout.js';

const STYLE_ID = 'mesh-annotation-controller-styles';
const FORMAT = 'three-gltf-viewer-annotations';
const SHARED_MODEL = '/models/client.glb';
const SHARED_ANNOTATIONS = '/models/client.annotations.json';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DATA_LENGTH = 4 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1280;

function isAnnotationImage(value) {
  return typeof value === 'string' && value.length <= MAX_IMAGE_DATA_LENGTH &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

async function prepareAnnotationImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error('Choose an image under 20 MB.');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/webp', 0.88);
    if (!isAnnotationImage(image)) {
      throw new Error('This image is too large after resizing. Try a smaller one.');
    }
    return image;
  } finally {
    bitmap.close();
  }
}

function openAnnotationDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(FORMAT, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('models');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class MeshAnnotationController {
  constructor(root, viewer, modelKey, onSelect = () => {}) {
    this.root = root;
    this.viewer = viewer;
    this.modelKey = String(modelKey || 'uploaded-model');
    this.onSelect = onSelect;
    this.records = [];
    this.localAnnotations = Object.create(null);
    this.sharedAnnotations = Object.create(null);
    this.sharedRequest = null;
    this.activeRecord = null;
    this.previewRecord = null;
    this.focusSnapshot = null;
    this.showLabels = true;
    this.disposed = false;
    this.frameId = null;
    this.imageReadId = 0;
    this.annotationDb = null;

    this._collectMeshes();
    this._loadAnnotations();
    this.annotations = this._mergeAnnotations();
    this.annotatedRecords = this.records.filter((record) => Boolean(this.annotations[record.path]));
    this._injectStyles();
    this._createUI();
    this._renderRows();
    this._createOverlay();
    this._bindEvents();
    this._updateCounts();
    this._ensureFrameLoop();
    this._restoreFromDatabase();
    if (this.modelKey === SHARED_MODEL) this._loadSharedAnnotations();
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
        this.localAnnotations = Object.assign(Object.create(null), parsed.annotations);
      }
    } catch (error) {
      console.warn('[Mesh Annotations] Unable to read saved annotations.', error);
    }
  }

  _storageKey() {
    return 'three-gltf-viewer:mesh-annotations:' + this.modelKey;
  }

  async _restoreFromDatabase() {
    // Keep the original localStorage entries readable until this model is saved to IndexedDB.
    this.toggleButton.disabled = true;
    try {
      const db = await openAnnotationDatabase();
      if (this.disposed) {
        db.close();
        return;
      }
      this.annotationDb = db;
      const saved = await new Promise((resolve, reject) => {
        const request = db.transaction('models').objectStore('models').get(this.modelKey);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (this.disposed || !saved) return;
      this.localAnnotations = Object.assign(Object.create(null), saved);
      this._syncAnnotationRecords();
    } catch (error) {
      this.annotationDb?.close();
      this.annotationDb = null;
      console.warn('[Mesh Annotations] Unable to open annotation database.', error);
    } finally {
      if (!this.disposed) this.toggleButton.disabled = false;
    }
  }

  async _persist(message) {
    try {
      if (this.annotationDb) {
        await new Promise((resolve, reject) => {
          const transaction = this.annotationDb.transaction('models', 'readwrite');
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
          transaction.objectStore('models').put(this.localAnnotations, this.modelKey);
        });
      } else {
        window.localStorage.setItem(
          this._storageKey(),
          JSON.stringify({ format: FORMAT, modelKey: this.modelKey, annotations: this.localAnnotations }),
        );
      }
      if (!this.disposed) this._setStatus(message);
    } catch (error) {
      console.warn('[Mesh Annotations] Unable to save annotations in this browser.', error);
      if (!this.disposed) {
        this._setStatus('Could not save in this browser. Export your annotations to keep a copy.');
        if (!this.editor.hidden) {
          this.errorLabel.textContent = 'Could not save in this browser. Use Export to keep a copy.';
        }
      }
    }
  }

  async _loadSharedAnnotations() {
    const request = new AbortController();
    this.sharedRequest = request;
    const timeout = window.setTimeout(() => request.abort(), 25000);
    try {
      const response = await fetch(SHARED_ANNOTATIONS, { cache: 'no-store', signal: request.signal });
      // An unconfigured deployment returns 404. A local dev server may return its index page.
      if (response.status === 404 || response.headers.get('content-type')?.includes('text/html')) return;
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (this.disposed) return;
      const shared = this._parseAnnotationPayload(payload);
      this.sharedAnnotations = shared.annotations;
      this._syncAnnotationRecords();
      if (!shared.imported && shared.unmatched) {
        console.warn('[Mesh Annotations] The published annotation file did not match the loaded model.');
      }
    } catch (error) {
      if (!this.disposed) {
        console.warn('[Mesh Annotations] Unable to load shared annotations.', error);
        this._setStatus('Could not load shared annotations. Try refreshing the viewer.');
      }
    } finally {
      window.clearTimeout(timeout);
      this.sharedRequest = null;
    }
  }

  _mergeAnnotations() {
    const annotations = Object.assign(Object.create(null), this.sharedAnnotations);
    for (const [path, entry] of Object.entries(this.localAnnotations)) {
      if (entry === null) delete annotations[path];
      else annotations[path] = entry;
    }
    return annotations;
  }

  _syncAnnotationRecords() {
    this.annotations = this._mergeAnnotations();
    this.annotatedRecords = this.records.filter((record) => Boolean(this.annotations[record.path]));
    this.annotatedRecords.forEach((record) => this._ensureMarker(record));
    this.records.forEach((record) => this._refreshRecord(record));
    this._updateCounts();
    this._ensureFrameLoop();
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
      '.mesh-annotation-toggle{position:fixed;z-index:100002;left:14px;min-width:132px;height:38px;display:inline-flex;align-items:center;justify-content:flex-start;gap:9px;padding:0 12px;color:#f4f8fc;background:rgba(23,43,61,.97);border:1px solid #6486a5;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.46);font-family:sans-serif;font-size:11px;font-weight:600;line-height:1;letter-spacing:.15px;white-space:nowrap;cursor:pointer;transition:background .16s ease,border-color .16s ease,box-shadow .16s ease}',
      '.mesh-annotation-toggle-icon{display:inline-grid;width:16px;flex:0 0 16px;place-items:center;font-size:16px;line-height:1}',
      '.mesh-annotation-toggle-label{display:inline-block;font:600 11px/1 sans-serif}',
      '.mesh-annotation-toggle:hover{background:#226a9a;border-color:#8bb8d9;box-shadow:0 5px 16px rgba(0,0,0,.52)}',
      '.mesh-annotation-toggle.is-closed{background:rgba(45,56,69,.97)}',
      '.mesh-annotation-editor{position:fixed;z-index:100004;left:374px;top:174px;width:360px;max-width:calc(100vw - 400px);max-height:calc(100vh - 188px);overflow:auto;padding:16px;color:#edf2f7;background:rgba(23,28,36,.99);border:1px solid #6486a5;border-radius:12px;box-shadow:0 14px 46px rgba(0,0,0,.62);font-size:13px}',
      '.mesh-annotation-editor-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}',
      '.mesh-annotation-editor-title{font-size:16px;font-weight:700;line-height:1.3}',
      '.mesh-annotation-editor-mesh{margin-top:4px;color:#9eabba;font-size:10px;line-height:1.4;overflow-wrap:anywhere}',
      '.mesh-annotation-field-wrap{display:block;margin:11px 0}',
      '.mesh-annotation-label{display:block;margin-bottom:5px;color:#c8d3df;font-size:11px;font-weight:700}',
      '.mesh-annotation-field{display:block;width:100%;padding:9px 10px;color:#fff;background:#202833;border:1px solid #526174;border-radius:6px;font:inherit;line-height:1.45}',
      '.mesh-annotation-field::placeholder{color:#8291a2}',
      '.mesh-annotation-details{min-height:104px;resize:vertical}',
      '.mesh-annotation-image-input{padding:6px;font-size:12px}',
      '.mesh-annotation-image-input::file-selector-button{margin-right:6px;padding:4px 7px;color:#eaf2fa;background:#303b49;border:1px solid #526174;border-radius:4px;cursor:pointer;font:inherit}',
      '.mesh-annotation-image{display:block;max-width:100%;margin-top:8px;object-fit:contain;border-radius:4px}',
      '.mesh-annotation-image[hidden],.mesh-annotation-remove-image[hidden]{display:none}',
      '.mesh-annotation-editor .mesh-annotation-image{max-height:112px}',
      '.mesh-annotation-remove-image{margin-top:6px}',
      '.mesh-annotation-help{margin:8px 0;color:#93a3b5;font-size:10px;line-height:1.45}',
      '.mesh-annotation-error{min-height:16px;color:#ffb4a8;font-size:11px}',
      '.mesh-annotation-editor-actions{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:10px}',
      '.mesh-annotation-editor-actions .spacer{flex:1}',
      '.mesh-annotation-overlay{position:absolute;inset:0;z-index:6;overflow:hidden;pointer-events:none}',
      '.mesh-annotation-marker{position:absolute;max-width:220px;transform:translate(-50%,-100%);padding:6px 9px;color:#fff;background:rgba(19,29,40,.94);border:1px solid #79b9e5;border-radius:6px;box-shadow:0 3px 12px rgba(0,0,0,.45);font:600 11px/1.25 Arial,Helvetica,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;pointer-events:auto}',
      '.mesh-annotation-marker:before{content:"";display:inline-block;width:6px;height:6px;margin-right:6px;background:#ffb347;border-radius:50%;vertical-align:1px}',
      '.mesh-annotation-marker:hover{background:#17537b;border-color:#b5e0ff}',
      '.mesh-annotation-marker[hidden]{display:none!important}',
      '.mesh-annotation-preview{position:absolute;z-index:8;display:flex;align-items:flex-start;gap:8px;width:280px;max-width:calc(100% - 20px);max-height:calc(100% - 20px);overflow:auto;overscroll-behavior:contain;padding:13px;color:#edf2f7;background:rgba(23,28,36,.98);border:1px solid #79b9e5;border-radius:9px;box-shadow:0 8px 28px rgba(0,0,0,.55);font-family:Arial,Helvetica,sans-serif;pointer-events:auto}',
      '.mesh-annotation-preview:has(> .mesh-annotation-image:not([hidden])){width:460px}',
      '.mesh-annotation-preview-copy{flex:1;min-width:0}',
      '.mesh-annotation-preview-title{font-size:14px;font-weight:700;line-height:1.3;overflow-wrap:anywhere}',
      '.mesh-annotation-preview-subtitle{margin-top:5px;color:#a9d8f7;font-size:11px;line-height:1.4}',
      '.mesh-annotation-preview-details{margin-top:8px;color:#d4dde7;font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.mesh-annotation-preview .mesh-annotation-image{flex:none;width:min(42%,180px);max-height:180px;margin:0;object-position:top right}',
      '.mesh-annotation-preview-close{flex:none;padding:1px 6px;color:#dce6ef;background:#303b49;border:1px solid #526174;border-radius:4px;cursor:pointer;font:inherit}',
      '@media(max-width:760px){.mesh-annotation-editor{left:14px;top:auto;bottom:14px;width:calc(100vw - 28px);max-width:none;max-height:62vh}}',
    ].join('\n');
    document.head.appendChild(style);
    this.injectedStyle = style;
  }

  _createUI() {
    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button';
    this.toggleButton.className = 'mesh-annotation-toggle';
    this.toggleButton.innerHTML = '<span class="mesh-annotation-toggle-icon" aria-hidden="true">✎</span><span class="mesh-annotation-toggle-label">Properties</span>';
    this.toggleButton.title = 'Show Properties panel';
    this.toggleButton.setAttribute('aria-label', 'Toggle Properties panel');
    this.toggleButton.classList.add('is-closed');
    this.toggleButton.setAttribute('aria-expanded', 'false');

    this.panel = document.createElement('section');
    this.panel.className = 'mesh-annotation-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Mesh annotations');
    this.panel.innerHTML = [
      '<div class="mesh-annotation-header">',
      '  <div class="mesh-annotation-heading">',
      '    <span>Properties</span>',
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
      '<label class="mesh-annotation-field-wrap">',
      '  <span class="mesh-annotation-label">Image (optional)</span>',
      '  <input class="mesh-annotation-field mesh-annotation-image-input" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="mesh-annotation-image-help">',
      '</label>',
      '<div class="mesh-annotation-help" id="mesh-annotation-image-help">JPG, PNG, or WebP, up to 20 MB.</div>',
      '<img class="mesh-annotation-image" alt="Selected annotation image" hidden>',
      '<button type="button" class="mesh-annotation-button mesh-annotation-remove-image" hidden>Remove image</button>',
      '<div class="mesh-annotation-help">Click the label beside the object in the 3D view to see its details and image.</div>',
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
    this.imageInput = this.editor.querySelector('.mesh-annotation-image-input');
    this.editorImage = this.editor.querySelector('.mesh-annotation-image');
    this.removeImageButton = this.editor.querySelector('.mesh-annotation-remove-image');
    this.saveButton = this.editor.querySelector('.mesh-annotation-save');
    this.editorMeshLabel = this.editor.querySelector('.mesh-annotation-editor-mesh');
    this.errorLabel = this.editor.querySelector('.mesh-annotation-error');
    this.removeButton = this.editor.querySelector('.mesh-annotation-remove');

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json,.json';
    this.fileInput.hidden = true;

    document.body.append(this.toggleButton, this.panel, this.editor, this.fileInput);
    this.layoutRegistration = registerMeshPanel(this.panel, this.toggleButton, 1);
  }

  _createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'mesh-annotation-overlay';
    this.viewer.el.appendChild(this.overlay);

    this.annotatedRecords.forEach((record) => this._ensureMarker(record));

    this.preview = document.createElement('div');
    this.preview.className = 'mesh-annotation-preview';
    this.preview.hidden = true;
    this.preview.innerHTML = [
      '<div class="mesh-annotation-preview-copy">',
      '  <div class="mesh-annotation-preview-title"></div>',
      '  <div class="mesh-annotation-preview-subtitle"></div>',
      '  <div class="mesh-annotation-preview-details"></div>',
      '</div>',
      '<img class="mesh-annotation-image" alt="" hidden>',
      '<button type="button" class="mesh-annotation-preview-close" aria-label="Close information">×</button>',
    ].join('');
    this.previewTitle = this.preview.querySelector('.mesh-annotation-preview-title');
    this.previewSubtitle = this.preview.querySelector('.mesh-annotation-preview-subtitle');
    this.previewDetails = this.preview.querySelector('.mesh-annotation-preview-details');
    this.previewImage = this.preview.querySelector('.mesh-annotation-image');
    this.preview.querySelector('.mesh-annotation-preview-close').addEventListener('click', () => this._hidePreview());
    this.overlay.appendChild(this.preview);
  }

  _bindEvents() {
    this.toggleButton.addEventListener('click', () => this.toggle());
    this.panel.querySelector('.mesh-annotation-hide').addEventListener('click', () => this.hide());
    this.searchInput.addEventListener('input', () => this._filterRows());
    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this._navigateToSearchMatch();
    });
    this.exportButton.addEventListener('click', () => this.exportAnnotations());
    this.importButton.addEventListener('click', () => this.fileInput.click());
    this.labelsButton.addEventListener('click', () => this._toggleLabels());
    this.fileInput.addEventListener('change', (event) => this._importFile(event));
    this.editor.querySelector('.mesh-annotation-editor-close').addEventListener('click', () => this._closeEditor());
    this.editor.querySelector('.mesh-annotation-cancel').addEventListener('click', () => this._closeEditor());
    this.imageInput.addEventListener('change', () => this._chooseImage());
    this.removeImageButton.addEventListener('click', () => {
      this._resetImage('');
      this.errorLabel.textContent = '';
    });
    this.saveButton.addEventListener('click', () => this._saveActiveAnnotation());
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
      button.addEventListener('click', () => this._handlePanelRecordClick(record));
      this.list.appendChild(button);

      record.row = button;
      record.status = status;
      record.searchText = ((record.mesh.name || '') + ' ' + record.displayPath).toLowerCase();
      this._refreshRecord(record);
    });
  }

  _refreshRecord(record) {
    if (!record.row) return;
    const annotation = this.annotations[record.path] || null;
    record.row.classList.toggle('selected', this.activeRecord === record);
    record.row.setAttribute('aria-pressed', String(this.activeRecord === record));
    record.status.textContent = annotation ? 'SAVED' : 'ADD';
    record.status.classList.toggle('saved', Boolean(annotation));
    if (record.marker) {
      if (annotation) {
        record.marker.textContent = 'i  ' + (annotation.title || annotation.subtitle || record.mesh.name || 'Information');
        record.marker.title = annotation.title || annotation.subtitle || 'View object information';
        record.marker.hidden = !this.showLabels;
      } else {
        record.marker.hidden = true;
      }
    }
  }

  _filterRows() {
    const query = this.searchInput.value.trim().toLowerCase();
    const matchingRecords = query
      ? this.records.filter((record) => record.searchText.includes(query))
      : this.records;

    const matchingSet = new Set(matchingRecords);
    this.records.forEach((record) => {
      record.row.hidden = !matchingSet.has(record);
    });

    if (this.countLabel) {
      this.countLabel.textContent = query
        ? matchingRecords.length + ' matching / ' + this.records.length + ' meshes'
        : this._countText();
    }

    // When the search has narrowed to one mesh, select and focus it automatically.
    // For ambiguous queries, wait for Enter so typing does not jump between objects.
    if (query && matchingRecords.length === 1 && this.activeRecord !== matchingRecords[0]) {
      this._selectSearchMatch(matchingRecords[0]);
    }
  }

  _findBestSearchMatch(query, matchingRecords) {
    if (!query || !matchingRecords.length) return null;

    const exactName = matchingRecords.find(
      (record) => (record.mesh.name || '').trim().toLowerCase() === query,
    );
    if (exactName) return exactName;

    const exactPath = matchingRecords.find(
      (record) => record.displayPath.trim().toLowerCase() === query,
    );
    if (exactPath) return exactPath;

    return matchingRecords.find(
      (record) => (record.mesh.name || '').trim().toLowerCase().startsWith(query),
    ) || matchingRecords[0];
  }

  _selectSearchMatch(record) {
    if (!record || this.disposed) return;
    if (this.activeRecord === record) {
      if (record.row) record.row.scrollIntoView({ block: 'nearest' });
      return;
    }

    // Search selection highlights the mesh and focuses the camera without opening
    // the annotation editor or stealing focus from the search field.
    this._hidePreview(false);
    this._activate(record, false, true);
  }

  _navigateToSearchMatch() {
    const query = this.searchInput.value.trim().toLowerCase();
    if (!query) return;

    const matchingRecords = this.records.filter((record) => record.searchText.includes(query));
    const record = this._findBestSearchMatch(query, matchingRecords);
    if (record) this._selectSearchMatch(record);
  }

  _countText() {
    const saved = this.annotatedRecords.length;
    return this.records.length + ' meshes · ' + saved + ' annotated';
  }

  _updateCounts() {
    this.countLabel.textContent = this._countText();
    this.exportButton.disabled = Object.keys(this.annotations).length === 0;
  }

  _handlePanelRecordClick(record) {
    // Clicking the currently-open row again acts as a deselect command.
    if (this.activeRecord === record && !this.editor.hidden) {
      this._deselect();
      return;
    }
    this._activate(record, true, true);
  }

  _focusRecord(record) {
    if (!this.focusSnapshot) {
      this.focusSnapshot = this.viewer.captureCameraView();
    }
    this.viewer.focusCameraOnObject(record.mesh, 850);
  }

  _restoreCameraFocus() {
    if (!this.focusSnapshot) return;
    const snapshot = this.focusSnapshot;
    // Keep the starting view until the restore finishes. A new selection made during
    // this animation can then cancel it and continue using the same original snapshot.
    this.viewer.restoreCameraView(snapshot, 700, () => {
      if (this.focusSnapshot === snapshot) this.focusSnapshot = null;
    });
  }

  _activate(record, openEditor, notify) {
    if (this.disposed || !record) return;

    if (this.previewRecord && this.previewRecord !== record) {
      this._hidePreview(false);
    }

    this.activeRecord = record;
    this.records.forEach((item) => this._refreshRecord(item));
    if (record.row) record.row.scrollIntoView({ block: 'nearest' });

    this._focusRecord(record);

    if (openEditor) {
      this._hidePreview(false);
      this._openEditor(record);
    } else {
      this._closeEditor();
    }

    if (notify) this.onSelect(record.mesh);
  }

  selectFromViewport(mesh) {
    if (this.disposed) return;

    if (!mesh) {
      this._deselect();
      return;
    }

    const record = this.records.find((item) => item.mesh === mesh);
    if (!record) {
      this._deselect();
      return;
    }

    // Viewport selection updates the annotation list but does not open the editor.
    this._hidePreview(false);
    this._activate(record, false, true);
  }

  _deselect() {
    if (this.disposed) return;

    this._hidePreview(false);
    this._closeEditor();
    this.activeRecord = null;
    this.records.forEach((record) => this._refreshRecord(record));
    this.onSelect(null);
    this._restoreCameraFocus();
  }

  syncSelection(mesh, openEditor = true) {
    if (this.disposed) return;
    if (!mesh) {
      this._deselect();
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
    this._resetImage(annotation.image);
    this.errorLabel.textContent = '';
    this.removeButton.hidden = !this.annotations[record.path];
    this.editor.hidden = false;
    this.titleInput.focus();
    this.titleInput.select();
  }

  _closeEditor() {
    if (!this.editor) return;
    this.editor.hidden = true;
    this._resetImage('');
    this.errorLabel.textContent = '';
  }

  _setImage(element, image) {
    const visible = isAnnotationImage(image);
    element.hidden = !visible;
    if (visible) element.src = image;
    else element.removeAttribute('src');
  }

  _resetImage(image) {
    this.imageReadId++;
    this.imageInput.value = '';
    this.saveButton.disabled = false;
    this._setDraftImage(isAnnotationImage(image) ? image : '');
  }

  _setDraftImage(image) {
    this.draftImage = image;
    this._setImage(this.editorImage, image);
    this.removeImageButton.hidden = !image;
  }

  async _chooseImage() {
    const file = this.imageInput.files[0];
    this.imageInput.value = '';
    if (!file) return;

    const readId = ++this.imageReadId;
    this.saveButton.disabled = true;
    this.errorLabel.textContent = 'Preparing image…';
    try {
      const image = await prepareAnnotationImage(file);
      if (this.disposed || readId !== this.imageReadId) return;
      this._setDraftImage(image);
      this.errorLabel.textContent = '';
    } catch (error) {
      if (this.disposed || readId !== this.imageReadId) return;
      this.errorLabel.textContent = error.name === 'Error' ? error.message : 'Could not read this image. Choose another file.';
    } finally {
      if (!this.disposed && readId === this.imageReadId) this.saveButton.disabled = false;
    }
  }

  _saveActiveAnnotation() {
    if (!this.activeRecord || this.saveButton.disabled) return;
    const title = this.titleInput.value.trim();
    const subtitle = this.subtitleInput.value.trim();
    const details = this.detailsInput.value.trim();

    if (!title && !subtitle && !details) {
      this.errorLabel.textContent = 'Add a title, subtitle, or details before saving.';
      return;
    }

    this.localAnnotations[this.activeRecord.path] = {
      meshName: this.activeRecord.mesh.name || 'Unnamed mesh',
      path: this.activeRecord.path,
      title,
      subtitle,
      details,
      ...(this.draftImage ? { image: this.draftImage } : {}),
    };
    this.annotations[this.activeRecord.path] = this.localAnnotations[this.activeRecord.path];
    this.errorLabel.textContent = '';
    if (!this.annotatedRecords.includes(this.activeRecord)) {
      this.annotatedRecords.push(this.activeRecord);
    }
    this._ensureMarker(this.activeRecord);
    this._refreshRecord(this.activeRecord);
    this._updateCounts();
    this._ensureFrameLoop();
    this._persist('Annotation saved in this browser.');
    this.removeButton.hidden = false;
  }

  _removeActiveAnnotation() {
    if (!this.activeRecord || !this.annotations[this.activeRecord.path]) return;
    const path = this.activeRecord.path;
    // A local removal can hide a shared annotation without changing the published copy.
    if (this.sharedRequest || this.sharedAnnotations[path]) this.localAnnotations[path] = null;
    else delete this.localAnnotations[path];
    delete this.annotations[path];
    this.annotatedRecords = this.annotatedRecords.filter((record) => record !== this.activeRecord);
    if (this.activeRecord.marker) this.activeRecord.marker.hidden = true;
    this._refreshRecord(this.activeRecord);
    this._updateCounts();
    if (this.previewRecord === this.activeRecord) this._hidePreview();
    this._persist('Annotation removed.');
    this.titleInput.value = '';
    this.subtitleInput.value = '';
    this.detailsInput.value = '';
    this._resetImage('');
    this.removeButton.hidden = true;
  }

  _ensureMarker(record) {
    if (record.marker || !this.overlay) return;
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'mesh-annotation-marker';
    marker.addEventListener('click', () => {
      this._activate(record, false, true);
      this._showPreview(record);
    });
    this.overlay.appendChild(marker);
    record.marker = marker;
    this._refreshRecord(record);
  }

  _toggleLabels() {
    this.showLabels = !this.showLabels;
    this.labelsButton.textContent = 'Labels: ' + (this.showLabels ? 'On' : 'Off');
    this.records.forEach((record) => this._refreshRecord(record));
    if (!this.showLabels) this._hidePreview();
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
    if (this.disposed || this.frameId !== null || !this.annotatedRecords.length) return;
    const tick = () => {
      if (this.disposed) return;
      this._updateMarkers();
      if (this.annotatedRecords.length) {
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

    this.annotatedRecords.forEach((record) => {
      const annotation = this.annotations[record.path];
      if (!annotation) return;
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
      if (!visible) {
        if (record === this.previewRecord) this._hidePreview();
        return;
      }

      const x = canvasRect.left - overlayRect.left + ((ndc.x + 1) / 2) * canvasRect.width;
      const y = canvasRect.top - overlayRect.top + ((1 - ndc.y) / 2) * canvasRect.height;
      record.marker.style.left = x + 'px';
      record.marker.style.top = y + 'px';

      if (record === this.previewRecord && !this.preview.hidden) {
        const left = Math.min(Math.max(10, x + 14), Math.max(10, overlayRect.width - this.preview.offsetWidth - 10));
        const top = Math.min(Math.max(10, y - 8), Math.max(10, overlayRect.height - this.preview.offsetHeight - 10));
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
    this.previewImage.alt = 'Image for ' + this.previewTitle.textContent;
    this._setImage(this.previewImage, annotation.image);
    this.preview.scrollTop = 0;
    this.preview.hidden = false;
    this._updateMarkers();
  }

  _hidePreview(restoreCamera = true) {
    if (this.preview) {
      this.preview.hidden = true;
      this._setImage(this.previewImage, '');
    }
    this.previewRecord = null;
    if (restoreCamera) this._restoreCameraFocus();
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

  _parseAnnotationPayload(payload) {
    if (!payload || payload.format !== FORMAT || !Array.isArray(payload.annotations)) {
      throw new Error('This is not a supported mesh annotation file.');
    }

    const recordsByPath = new Map(this.records.map((record) => [record.path, record]));
    const annotations = Object.create(null);
    let imported = 0;
    let unmatched = 0;
    for (const annotation of payload.annotations) {
      const record = recordsByPath.get(annotation?.path);
      if (!record) {
        unmatched++;
        continue;
      }
      if (annotation.image !== undefined && !isAnnotationImage(annotation.image)) {
        throw new Error('An image for ' + (record.mesh.name || 'a mesh') + ' is invalid or too large.');
      }
      annotations[record.path] = {
        meshName: record.mesh.name || 'Unnamed mesh',
        path: record.path,
        title: String(annotation.title || '').slice(0, 120),
        subtitle: String(annotation.subtitle || '').slice(0, 180),
        details: String(annotation.details || '').slice(0, 2000),
        ...(annotation.image ? { image: annotation.image } : {}),
      };
      imported++;
    }
    return { annotations, imported, unmatched };
  }

  async _importFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (this.disposed) return;
      const { annotations, imported, unmatched } = this._parseAnnotationPayload(payload);
      Object.assign(this.localAnnotations, annotations);
      this._closeEditor();
      this._hidePreview(false);
      this._syncAnnotationRecords();
      await this._persist(imported + ' annotations imported' + (unmatched ? ' · ' + unmatched + ' unmatched' : '') + '.');
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
    this.toggleButton.title = 'Hide Properties panel';
    this.toggleButton.setAttribute('aria-expanded', 'true');
  }

  hide() {
    if (this.disposed) return;
    this.panel.hidden = true;
    this.layoutRegistration && this.layoutRegistration.update();
    this.toggleButton.classList.add('is-closed');
    this.toggleButton.title = 'Show Properties panel';
    this.toggleButton.setAttribute('aria-expanded', 'false');
  }

  toggle() {
    if (this.panel.hidden) this.show();
    else this.hide();
  }

  dispose() {
    if (this.disposed) return;
    this._hidePreview(false);
    this._restoreCameraFocus();
    this.disposed = true;
    this.sharedRequest?.abort();
    this.annotationDb?.close();
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
