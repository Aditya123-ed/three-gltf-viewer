import { isObjectColor } from './mesh-appearance.js';

const withoutIndices = (path) => path.replace(/\[\d+\](?= \/ |$)/g, '');

export class ObjectColorController {
  constructor(container, groups, appearance, modelKey, pathOf, onChange = () => {}) {
    this.groups = groups;
    this.appearance = appearance;
    this.pathOf = pathOf;
    this.onChange = onChange;
    this.storageKey = 'three-gltf-viewer:object-colors:' + modelKey;
    this.local = new Map();
    this.shared = new Map();
    this.activeGroup = null;
    this.element = document.createElement('fieldset');
    this.element.className = 'object-color-controls';
    this.element.innerHTML = `
      <legend>Object color</legend>
      <div class="object-color-selected">Select an object in the list or 3D view.</div>
      <div class="object-color-inputs">
        <input type="color" value="#3498db" aria-label="Choose solid object color" disabled>
        <input type="text" class="mesh-annotation-field object-color-hex" value="#3498DB" maxlength="7" spellcheck="false" aria-label="Hex object color" placeholder="#3498DB" disabled>
        <button type="button" class="mesh-annotation-button primary object-color-apply" disabled>Apply color</button>
      </div>
      <button type="button" class="mesh-annotation-button object-color-reset" disabled>Reset original</button>
      <div class="mesh-annotation-help">Saved in this browser. Export / Import includes object colors.</div>
      <div class="object-color-message" role="status" aria-live="polite"></div>`;
    container.appendChild(this.element);
    this.selected = this.element.querySelector('.object-color-selected');
    this.picker = this.element.querySelector('[type="color"]');
    this.hex = this.element.querySelector('.object-color-hex');
    this.applyButton = this.element.querySelector('.object-color-apply');
    this.resetButton = this.element.querySelector('.object-color-reset');
    this.message = this.element.querySelector('.object-color-message');
    this.picker.addEventListener('input', () => { this.hex.value = this.picker.value.toUpperCase(); });
    this.hex.addEventListener('input', () => {
      if (isObjectColor(this.hex.value)) this.picker.value = this.hex.value;
    });
    this.hex.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this.applyColor(this.hex.value); }
    });
    this.applyButton.addEventListener('click', () => this.applyColor(this.hex.value));
    this.resetButton.addEventListener('click', () => this.applyColor(null));
    try {
      const saved = JSON.parse(window.localStorage.getItem(this.storageKey) || '[]');
      this.local = this.parse(saved).colors;
      this._applyAll();
    } catch (error) {
      console.warn('[Object colors] Unable to restore colors.', error);
    }
  }

  _findGroup(entry) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.objectName !== 'string') return null;
    const candidates = this.groups.filter((group) => group.name === entry.objectName);
    const pathMatches = candidates.filter((group) => withoutIndices(this.pathOf(group.object)) === withoutIndices(entry.path));
    return candidates.find((group) => this.pathOf(group.object) === entry.path) ||
      (pathMatches.length === 1 ? pathMatches[0] : null) ||
      (candidates.length === 1 ? candidates[0] : null);
  }

  parse(entries) {
    if (!Array.isArray(entries)) throw new Error('Object colors must be a list.');
    const colors = new Map();
    let unmatched = 0;
    for (const entry of entries) {
      if (!entry || (entry.color !== null && !isObjectColor(entry.color))) {
        throw new Error('An object color is invalid. Use a hex color such as #3498DB.');
      }
      const group = this._findGroup(entry);
      if (!group) { unmatched++; continue; }
      colors.set(group, entry.color?.toLowerCase() || null);
    }
    return { colors, unmatched };
  }

  _merged() { return new Map([...this.shared, ...this.local]); }

  _entries(colors) {
    return [...colors].map(([group, color]) => ({
      objectName: group.name, path: this.pathOf(group.object), color,
    }));
  }

  exportEntries() { return this._entries(this._merged()); }

  loadShared(entries) {
    if (entries === undefined) return;
    this.shared = this.parse(entries).colors;
    this._applyAll();
    this.onChange();
  }

  importColors(parsed) {
    for (const [group, color] of parsed.colors) this.local.set(group, color);
    this._applyAll();
    this._save();
    this.onChange();
  }

  _applyAll() {
    const colors = this._merged();
    for (const group of this.groups) {
      this.appearance.setColor(group.records.map((record) => record.mesh), colors.get(group) || null);
    }
    this.setSelection(this.activeGroup);
  }

  setSelection(group) {
    this.activeGroup = group;
    this.selected.textContent = group ? group.name : 'Select an object in the list or 3D view.';
    for (const input of [this.picker, this.hex, this.applyButton, this.resetButton]) input.disabled = !group;
    const color = this._merged().get(group);
    this.resetButton.disabled = !color;
    this.picker.value = color || '#3498db';
    this.hex.value = this.picker.value.toUpperCase();
    this.message.textContent = '';
  }

  applyColor(color) {
    if (!this.activeGroup) return;
    if (color !== null && !isObjectColor(color)) {
      this.message.textContent = 'Enter a hex color such as #3498DB.';
      return;
    }
    const group = this.activeGroup;
    color = color?.toLowerCase() || null;
    this.appearance.setColor(group.records.map((record) => record.mesh), color);
    this.local.set(group, color);
    this.setSelection(group);
    this._save(color ? 'Color applied.' : 'Original appearance restored.');
    this.onChange();
  }

  _save(message = 'Object colors imported.') {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this._entries(this.local)));
      this.message.textContent = message;
    } catch (error) {
      this.message.textContent = 'Color applied. Browser saving failed; use Export to keep a copy.';
    }
  }

  dispose() { this.element.remove(); }
}
