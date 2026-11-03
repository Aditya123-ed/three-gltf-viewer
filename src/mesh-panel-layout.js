const registrations = [];
let resizeBound = false;

function updateMeshPanelLayout() {
  const visible = registrations
    .filter((item) => item.panel.isConnected && !item.panel.hidden)
    .sort((a, b) => a.order - b.order);

  registrations.forEach((item) => {
    if (!item.toggleButton.isConnected) return;
    item.toggleButton.style.position = 'fixed';
    item.toggleButton.style.left = '14px';
    item.toggleButton.style.top = `${72 + item.order * 44}px`;
  });

  const panelStart = 174;
  const gap = 10;
  const available = Math.max(150, window.innerHeight - panelStart - 14);
  const panelHeight = Math.max(
    130,
    Math.floor((available - gap * Math.max(0, visible.length - 1)) / Math.max(1, visible.length)),
  );

  let top = panelStart;
  visible.forEach((item) => {
    item.panel.style.position = 'fixed';
    item.panel.style.left = '14px';
    item.panel.style.top = `${top}px`;
    item.panel.style.height = `${panelHeight}px`;
    item.panel.style.maxHeight = `${panelHeight}px`;
    item.panel.style.width = '350px';
    item.panel.style.maxWidth = 'calc(100vw - 28px)';
    top += panelHeight + gap;
  });
}

export function registerMeshPanel(panel, toggleButton, order = 0) {
  const entry = { panel, toggleButton, order };
  registrations.push(entry);

  if (!resizeBound) {
    window.addEventListener('resize', updateMeshPanelLayout);
    resizeBound = true;
  }

  updateMeshPanelLayout();

  return {
    update: updateMeshPanelLayout,
    unregister() {
      const index = registrations.indexOf(entry);
      if (index !== -1) registrations.splice(index, 1);
      updateMeshPanelLayout();
    },
  };
}
