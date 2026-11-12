# glTF Viewer

Preview glTF 2.0 models in WebGL using three.js and a drag-and-drop interface.

Viewer: [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com/)

![screenshot](https://user-images.githubusercontent.com/1848368/31580352-b7354096-b101-11e7-86d7-f07677835812.png)

The **Properties** panel combines object selection, annotations, solid colors, and transparency. It lists one row per exported object using its original name; material primitives stay grouped under that object. Select an object in the list or 3D view to use the **Transparency** section below **Object color**. Its slider ranges from 0% (original appearance) to 100% (hidden), with Reset object and Restore all actions. Color and transparency can be adjusted or reset independently. The separate Transparency bar and panel have been removed. The arrow on the floating Properties bar opens the panel, and X closes it.

The **Current Flow** panel animates separate particles along detected wire meshes. Each wire has its own Forward/Reverse selector and visibility checkbox. On/Off, speed, particle color, particle size, and particle density apply to the whole flow. Density ranges from 10–300%; 100% preserves the original spacing. Directions and shared controls save in this browser and are included in Properties → Export / Import. Existing files with a single global direction or without density continue to load. Both panels start closed.

The checkbox on the floating **Current Flow** bar switches the particles on or off directly. The arrow opens the settings panel; its X closes the panel. Opening or closing the panel keeps the flow's On/Off state.

The six short drops below the two entry gantries and three individually marked branches from the horizontal bus have direction corrections. These match the named source mesh and both endpoints, so other spans in the same mesh keep their direction. The corrections affect particle paths only; the GLB, object names, materials, and mesh grouping remain intact.

Properties search and viewport picking select and focus the same object, with a colored bounding-box outline. Properties and Current Flow share a stacked left-side layout and can be opened independently.

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
