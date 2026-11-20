export function isObjectVisible(object) {
  for (let current = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return Boolean(object);
}

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

export function collectCollectionObjects(root, collectionNames, fallbackMembers = []) {
  const normalize = (name) => String(name).trim().toLowerCase().replace(/[\s_-]+/g, '');
  const names = new Set([...collectionNames].map(normalize));
  const collections = [];
  root.traverse((object) => {
    if (names.has(normalize(objectName(object)))) collections.push(object);
  });
  if (collections.length) {
    return collections.filter((object) => {
      for (let parent = object.parent; parent; parent = parent.parent) {
        if (collections.includes(parent)) return false;
      }
      return true;
    });
  }
  const members = new Set(fallbackMembers), objects = [];
  root.traverse((object) => {
    if (members.has(objectName(object))) objects.push(object);
  });
  return objects;
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
