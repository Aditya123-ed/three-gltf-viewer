# glTF Viewer

Preview glTF 2.0 models in WebGL using three.js and a drag-and-drop interface.

Viewer: [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com/)

This fork adds a per-mesh transparency panel. After a model loads, use the left-side **Mesh Transparency** panel to adjust each mesh independently from 0–100%. The panel includes mesh-name search, a floating show/hide toggle, and a Restore all action. Material copies are made per mesh so changing one mesh does not change other meshes that shared the same source glTF material.

## Quickstart

```
npm install
npm run dev
```

Build the production site with:

```
npm run build
```

## Sharing a model

The viewer supports a model URL in the hash, for example:

```
https://YOUR-VIEWER-DOMAIN/#model=https://YOUR-MODEL-HOST/model.glb
```

The model host must allow cross-origin requests (CORS) from the viewer domain.

## glTF 2.0 Resources

- [THREE.GLTFLoader](https://threejs.org/docs/#examples/en/loaders/GLTFLoader)
- [glTF 2.0 Specification](https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md)
- [glTF 2.0 Sample Models](https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/)

## Known Issues

- [ ] Limited drag-and-drop support in Safari.
