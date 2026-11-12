export class ObjectTransparencyController {
  constructor(container, groups, appearance) {
    this.groups = groups;
    this.appearance = appearance;
    this.activeGroup = null;
    this.element = document.createElement('fieldset');
    this.element.className = 'object-transparency-controls';
    this.element.innerHTML = `
      <legend>Transparency</legend>
      <div class="object-transparency-hint mesh-annotation-help">Select an object in the list or 3D view.</div>
      <div class="object-transparency-control">
        <input type="range" min="0" max="100" step="1" value="0" aria-label="Object transparency" disabled>
        <output class="object-transparency-value">—</output>
      </div>
      <div class="object-transparency-scale"><span>Original</span><span>Hidden</span></div>
      <div class="object-transparency-actions">
        <button type="button" class="mesh-annotation-button object-transparency-reset" disabled>Reset object</button>
        <button type="button" class="mesh-annotation-button object-transparency-restore" disabled>Restore all</button>
      </div>`;
    container.appendChild(this.element);
    this.input = this.element.querySelector('[type=range]');
    this.value = this.element.querySelector('output');
    this.hint = this.element.querySelector('.object-transparency-hint');
    this.resetButton = this.element.querySelector('.object-transparency-reset');
    this.restoreButton = this.element.querySelector('.object-transparency-restore');
    this.input.addEventListener('input', () => this.setTransparency(Number(this.input.value)));
    this.resetButton.addEventListener('click', () => this.setTransparency(0));
    this.restoreButton.addEventListener('click', () => this.restoreAll());
    this.setSelection(null);
  }

  setSelection(group) {
    this.activeGroup = group;
    const percentage = group ? Math.round(100 - this.appearance.getOpacity(group.meshes[0])) : 0;
    this.input.disabled = !group;
    this.input.value = String(percentage);
    this.input.setAttribute('aria-valuetext', percentage + '% transparent');
    this.value.textContent = group ? percentage + '%' : '—';
    this.hint.hidden = Boolean(group);
    this.resetButton.disabled = !group || percentage === 0;
    this.restoreButton.disabled = !this.groups.some((item) => item.meshes.some((mesh) => this.appearance.getOpacity(mesh) < 100));
  }

  setTransparency(percentage) {
    if (!this.activeGroup || !Number.isFinite(percentage)) return;
    const opacity = 100 - Math.max(0, Math.min(100, percentage));
    for (const mesh of this.activeGroup.meshes) this.appearance.setOpacity(mesh, opacity);
    this.setSelection(this.activeGroup);
  }

  restoreAll() {
    for (const group of this.groups) {
      for (const mesh of group.meshes) this.appearance.setOpacity(mesh, 100);
    }
    this.setSelection(this.activeGroup);
  }

  dispose() { this.element.remove(); }
}
