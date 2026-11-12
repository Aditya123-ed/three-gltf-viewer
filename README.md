# glTF Viewer

Preview glTF 2.0 models in WebGL using three.js and a drag-and-drop interface.

Viewer: [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com/)

![screenshot](https://user-images.githubusercontent.com/1848368/31580352-b7354096-b101-11e7-86d7-f07677835812.png)

This fork adds a **Mesh Transparency** panel and a **Properties** panel. Both list one row per exported object using its original name; material primitives stay grouped under that object. Transparency adjusts all of an object's parts together from 0–100%, with name search and Restore all. Solid object colors remain independent of transparency and other objects sharing the same original material.

The **Current Flow** panel animates separate particles along detected wire meshes. Each wire has its own Forward/Reverse selector and visibility checkbox. On/Off, speed, particle color, particle size, and particle density apply to the whole flow. Density ranges from 10–300%; 100% preserves the original spacing. Directions and shared controls save in this browser and are included in Properties → Export / Import. Existing files with a single global direction or without density continue to load. All three panels start closed.

The six short drop spans below the substation's two entry gantries have individual direction corrections. These match the named source mesh and both endpoints, so other spans in the same mesh keep their direction. The corrections affect particle paths only; the GLB, object names, materials, and mesh grouping remain intact.

It also adds a **Mesh Selection** panel listing the model's renderable meshes. Clicking a name highlights that exact mesh in the viewport with a colored bounding-box outline. Both panels have their own floating toggle buttons and share a stacked left-side layout, so either panel can be hidden independently. The selection panel includes mesh-name and hierarchy-path search, plus a clear-selection button.

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

-   [THREE.GLTFLoader](https://threejs.org/docs/#examples/en/loaders/GLTFLoader)
-   [glTF 2.0 Specification](https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md)
-   [glTF 2.0 Sample Models](https://github.com/KhronosGroup/glTF-Sample-Models/tree/master/2.0/)

## Known Issues

-   [ ] Limited drag-and-drop support in Safari.
