import { Box3, Vector3 } from 'three';
import { collectModelObjects, isObjectVisible } from './model-objects.js';

const STYLE_ID = 'mesh-video-styles';
const CLIENT_MODEL = '/models/client.glb';
export const TRANSFORMER_VIDEO = Object.freeze({
  objectName: 'Input_Element_Big_Transformer_baked',
  videoId: '814735677',
  title: 'Substation Fundamentals',
  url: 'https://vimeo.com/814735677',
});

export function vimeoEmbedUrl(videoId) {
  if (typeof videoId !== 'string' || !/^\d{1,12}$/.test(videoId)) throw new TypeError('Invalid Vimeo video ID');
  const url = new URL('https://player.vimeo.com/video/' + videoId);
  url.search = new URLSearchParams({ autoplay: '0', controls: '1', playsinline: '1', dnt: '1' });
  return url.href;
}

export function collectMeshVideoBindings(root, modelKey, associations = null) {
  if (modelKey !== CLIENT_MODEL) return [];
  const matches = collectModelObjects(root, associations)
    .filter((group) => group.name === TRANSFORMER_VIDEO.objectName);
  // An exact, unique source object prevents similarly named transformers or
  // material primitives from receiving the video by accident.
  return matches.length === 1 ? [{ ...matches[0], video: TRANSFORMER_VIDEO }] : [];
}

function hasVisibleMaterial(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return isObjectVisible(mesh) && materials.some((material) => material && material.visible !== false && material.opacity > 0.001);
}

export function projectMeshVideoAnchor(object, camera, width, height) {
  if (!object || !camera || width <= 0 || height <= 0) return null;
  object.updateWorldMatrix(true, true);
  camera.updateMatrixWorld();
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  const center = box.getCenter(new Vector3()).project(camera);
  if (![center.x, center.y, center.z].every(Number.isFinite) || center.z < -1 || center.z > 1 || Math.abs(center.x) > 1 || Math.abs(center.y) > 1) return null;
  let left = Infinity, right = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const corner = new Vector3(x, y, z).project(camera);
    if (corner.z < -1 || corner.z > 1) continue;
    const screenX = (corner.x + 1) * width / 2;
    left = Math.min(left, screenX); right = Math.max(right, screenX);
  }
  const x = (center.x + 1) * width / 2;
  return { x, y: (1 - center.y) * height / 2, left: Number.isFinite(left) ? left : x, right: Number.isFinite(right) ? right : x };
}

export function placeMeshVideoPopup(anchor, popup, viewport) {
  const margin = 10, gap = 14;
  const maxLeft = Math.max(margin, viewport.width - popup.width - margin);
  const maxTop = Math.max(margin, viewport.height - popup.height - margin);
  let left = anchor.right + gap;
  if (left > maxLeft) {
    left = anchor.left - gap - popup.width;
    if (left < margin) left = anchor.x + gap;
  }
  return { left: Math.min(Math.max(margin, left), maxLeft), top: Math.min(Math.max(margin, anchor.y - 8), maxTop) };
}

export class MeshVideoController {
  constructor(root, viewer, modelKey, associations = null) {
    this.disposed = false;
    this.viewer = viewer;
    this.bindings = collectMeshVideoBindings(root, modelKey, associations);
    this.activeBinding = null;
    if (this.bindings.length) {
      this._createUI();
      this.removeFrameCallback = viewer.addFrameCallback(() => this._updatePosition());
    }
  }

  _createUI() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style'); style.id = STYLE_ID;
      style.textContent = `
        .mesh-video-overlay{position:absolute;inset:0;z-index:9;overflow:hidden;pointer-events:none}
        .mesh-video-popup,.mesh-video-popup *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
        .mesh-video-popup{position:absolute;width:280px;max-width:calc(100% - 20px);max-height:calc(100% - 20px);padding:0;overflow:auto;overscroll-behavior:contain;pointer-events:auto;color:#edf2f7;background:rgba(23,28,36,.98);border:1px solid #79b9e5;border-radius:9px;box-shadow:0 8px 28px #0009}
        .mesh-video-popup[hidden]{display:none!important}
        .mesh-video-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:10px 11px;border-bottom:1px solid #394553}
        .mesh-video-title{margin:0;font-size:14px;line-height:1.3;font-weight:700}
        .mesh-video-object{margin:4px 0 0;color:#aab5c3;font-size:10px;line-height:1.3;overflow-wrap:anywhere}
        .mesh-video-close{flex:none;padding:1px 6px;color:#edf2f7;background:#303b49;border:1px solid #526174;border-radius:4px;font-size:14px;line-height:1.3;cursor:pointer}
        .mesh-video-player{position:relative;width:100%;aspect-ratio:16/9;background:#000}
        .mesh-video-player iframe{position:absolute;inset:0;display:block;width:100%;height:100%;border:0}
        .mesh-video-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;padding:8px 11px;font-size:10px;line-height:1.4;color:#aab5c3}
        .mesh-video-link{color:#9edcff;text-underline-offset:3px;white-space:nowrap}
        .mesh-video-close:focus-visible,.mesh-video-link:focus-visible{outline:2px solid #b5e3ff;outline-offset:3px}
      `;
      document.head.appendChild(style); this.injectedStyle = style;
    }
    this.overlay = document.createElement('div'); this.overlay.className = 'mesh-video-overlay';
    this.popup = document.createElement('section'); this.popup.className = 'mesh-video-popup'; this.popup.hidden = true;
    this.popup.setAttribute('role', 'dialog'); this.popup.setAttribute('aria-modal', 'false');
    this.popup.setAttribute('aria-labelledby', 'mesh-video-title');
    this.popup.innerHTML = '<div class="mesh-video-header"><div><h2 class="mesh-video-title" id="mesh-video-title"></h2><p class="mesh-video-object"></p></div><button type="button" class="mesh-video-close" aria-label="Close video">×</button></div><div class="mesh-video-player"></div><div class="mesh-video-footer"><span>Press Play to watch.</span><a class="mesh-video-link" target="_blank" rel="noopener noreferrer">Open on Vimeo ↗</a></div>';
    this.title = this.popup.querySelector('.mesh-video-title');
    this.objectLabel = this.popup.querySelector('.mesh-video-object');
    this.playerSlot = this.popup.querySelector('.mesh-video-player');
    this.link = this.popup.querySelector('.mesh-video-link');
    this.closeButton = this.popup.querySelector('.mesh-video-close');
    this.closeButton.addEventListener('click', () => this.close());
    this._onKeyDown = (event) => {
      if (event.key !== 'Escape' || !this.activeBinding) return;
      event.stopPropagation(); this.close();
    };
    document.addEventListener('keydown', this._onKeyDown, true);
    this.overlay.appendChild(this.popup); this.viewer.el.appendChild(this.overlay);
  }

  selectFromViewport(mesh) {
    if (this.disposed) return false;
    if (!mesh || !isObjectVisible(mesh)) { this.close(); return false; }
    const binding = this.bindings.find((item) => item.object === mesh || item.meshes.includes(mesh));
    if (!binding || !(mesh.isMesh ? hasVisibleMaterial(mesh) : binding.meshes.some(hasVisibleMaterial))) { this.close(); return false; }
    this.open(binding);
    return true;
  }

  open(binding) {
    if (this.disposed || !this.bindings.includes(binding)) return;
    if (this.activeBinding === binding) { this._updatePosition(); return; }
    this._stopPlayback();
    this.activeBinding = binding;
    this.title.textContent = binding.video.title;
    this.objectLabel.textContent = binding.name;
    this.link.href = binding.video.url;
    const iframe = document.createElement('iframe');
    iframe.title = binding.video.title + ' — Vimeo video player';
    iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.src = vimeoEmbedUrl(binding.video.videoId);
    this.playerSlot.appendChild(iframe);
    this.popup.hidden = false;
    this._updatePosition();
    if (this.activeBinding) this.closeButton.focus({ preventScroll: true });
  }

  _updatePosition() {
    if (this.disposed || !this.activeBinding) return;
    const binding = this.activeBinding;
    if (!binding.meshes.some(hasVisibleMaterial)) { this.close(); return; }
    const canvasRect = this.viewer.renderer.domElement.getBoundingClientRect();
    const overlayRect = this.overlay.getBoundingClientRect();
    const anchor = projectMeshVideoAnchor(binding.object, this.viewer.activeCamera, canvasRect.width, canvasRect.height);
    if (!anchor || overlayRect.width <= 0 || overlayRect.height <= 0) { this.close(); return; }
    const offsetX = canvasRect.left - overlayRect.left, offsetY = canvasRect.top - overlayRect.top;
    anchor.x += offsetX; anchor.y += offsetY; anchor.left += offsetX; anchor.right += offsetX;
    const position = placeMeshVideoPopup(anchor, { width: this.popup.offsetWidth, height: this.popup.offsetHeight }, overlayRect);
    const left = Math.round(position.left) + 'px', top = Math.round(position.top) + 'px';
    if (this.popup.style.left !== left) this.popup.style.left = left;
    if (this.popup.style.top !== top) this.popup.style.top = top;
  }

  _stopPlayback() {
    // Unload the iframe so audio/video cannot continue behind the closed popup.
    this.playerSlot?.replaceChildren();
    this.activeBinding = null;
  }

  close() {
    this._stopPlayback();
    if (this.popup) this.popup.hidden = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.close(); this.removeFrameCallback?.();
    if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown, true);
    this.overlay?.remove(); this.injectedStyle?.remove();
  }
}
