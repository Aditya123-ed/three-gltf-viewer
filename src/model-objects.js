// GLTFLoader may split one exported object into many material primitives. All
// object-facing panels use the source node association rather than those parts.
export function sourceObject(mesh, root, associations = null) {
  for (let object = mesh; object && object !== root; object = object.parent) {
    if (associations?.get(object)?.nodes !== undefined) return object;
  }
  return mesh;
}

export function objectName(object) {
  return object.userData.name || object.name || 'Unnamed object';
}

export function objectPath(object) {
  const names = [];
  for (let current = object; current; current = current.parent) {
    const name = current.userData.name || current.name;
    if (name) names.unshift(name);
  }
  return names.join(' / ') || object.type || 'Object';
}

export function collectModelObjects(root, associations = null) {
  const groups = new Map();
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
    const object = sourceObject(mesh, root, associations);
    if (!groups.has(object)) {
      groups.set(object, { object, name: objectName(object), displayPath: objectPath(object), meshes: [] });
    }
    groups.get(object).meshes.push(mesh);
  });
  return [...groups.values()];
}
