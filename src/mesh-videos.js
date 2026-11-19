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

export class MeshVideoController {
  constructor(root, modelKey, associations = null) {
    this.disposed = false;
    this.bindings = collectMeshVideoBindings(root, modelKey, associations);
    this.activeBinding = null;
    if (this.bindings.length) this._createUI();
  }

  _createUI() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style'); style.id = STYLE_ID;
      style.textContent = `
        .mesh-video-dialog,.mesh-video-dialog *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
        .mesh-video-dialog{width:min(920px,calc(100vw - 28px));max-width:920px;max-height:calc(100dvh - 28px);margin:auto;padding:0;overflow:auto;color:#edf2f7;background:#171c24;border:1px solid #6486a5;border-radius:12px;box-shadow:0 20px 80px #000b}
        .mesh-video-dialog::backdrop{background:rgba(3,9,16,.78)}
        .mesh-video-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:15px 17px;border-bottom:1px solid #394553}
        .mesh-video-title{margin:0;font-size:17px;line-height:1.4;font-weight:700}
        .mesh-video-object{margin:5px 0 0;color:#aab5c3;font-size:11px;line-height:1.4;overflow-wrap:anywhere}
        .mesh-video-close{flex:none;padding:3px 9px;color:#edf2f7;background:#303b49;border:1px solid #526174;border-radius:5px;font-size:20px;line-height:1.2;cursor:pointer}
        .mesh-video-player{position:relative;width:100%;aspect-ratio:16/9;max-height:calc(100dvh - 160px);min-height:140px;background:#000}
        .mesh-video-player iframe{position:absolute;inset:0;display:block;width:100%;height:100%;border:0}
        .mesh-video-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:12px 17px;font-size:12px;line-height:1.5;color:#aab5c3}
        .mesh-video-link{color:#9edcff;text-underline-offset:3px;white-space:nowrap}
        .mesh-video-close:focus-visible,.mesh-video-link:focus-visible{outline:2px solid #b5e3ff;outline-offset:3px}
      `;
      document.head.appendChild(style); this.injectedStyle = style;
    }
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'mesh-video-dialog';
    this.dialog.setAttribute('aria-labelledby', 'mesh-video-title');
    this.dialog.innerHTML = '<div class="mesh-video-header"><div><h2 class="mesh-video-title" id="mesh-video-title"></h2><p class="mesh-video-object"></p></div><button type="button" class="mesh-video-close" aria-label="Close video" autofocus>×</button></div><div class="mesh-video-player"></div><div class="mesh-video-footer"><span>Press Play to watch. Closing this window stops playback.</span><a class="mesh-video-link" target="_blank" rel="noopener noreferrer">Open on Vimeo ↗</a></div>';
    this.title = this.dialog.querySelector('.mesh-video-title');
    this.objectLabel = this.dialog.querySelector('.mesh-video-object');
    this.playerSlot = this.dialog.querySelector('.mesh-video-player');
    this.link = this.dialog.querySelector('.mesh-video-link');
    this.dialog.querySelector('.mesh-video-close').addEventListener('click', () => this.close());
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('keydown', (event) => {
      // Escape closes the video without also closing Properties or restoring
      // the annotation camera behind the modal.
      if (event.key === 'Escape') event.stopPropagation();
    });
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this._stopPlayback(); });
    this.dialog.addEventListener('click', (event) => {
      if (event.target !== this.dialog) return;
      const rect = this.dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.close();
    });
    document.body.appendChild(this.dialog);
  }

  selectFromViewport(mesh) {
    if (this.disposed || !mesh || !isObjectVisible(mesh)) return false;
    const binding = this.bindings.find((item) => item.object === mesh || item.meshes.includes(mesh));
    if (!binding || !(mesh.isMesh ? hasVisibleMaterial(mesh) : binding.meshes.some(hasVisibleMaterial))) return false;
    this.open(binding);
    return true;
  }

  open(binding) {
    if (this.disposed || !this.bindings.includes(binding)) return;
    if (this.dialog.open && this.activeBinding === binding) return;
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
    if (!this.dialog.open) this.dialog.showModal();
  }

  _stopPlayback() {
    // Unload the iframe so audio/video cannot continue behind the closed popup.
    this.playerSlot?.replaceChildren();
    this.activeBinding = null;
  }

  close() {
    this._stopPlayback();
    if (this.dialog?.open) this.dialog.close();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.close(); this.dialog?.remove(); this.injectedStyle?.remove();
  }
}
