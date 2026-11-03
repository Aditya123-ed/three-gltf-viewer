const registrations = [];
let resizeBound = false;

export function registerMeshPanel(panel, toggleButton, order = 0) {
  const entry = { panel, toggleButton, order };
  registrations.push(entry);

  const layout = () => {
    const visible = registrations
      .filter((item) => !item.panel.hidden)
      .sort((a, b) => a.order - b.order);

    registrations.forEach((item) => {
      item.toggleButton.style.position = 'fixed';
      item.toggleButton.style.left = '14px';
      item.toggleButton.style.top = `${72 + item.order * 44}px`;
    });

    const panelStart = 174;
    const gap = 10;
    const available = Math.max(160, window.innerHeight - panelStart - 14);
    const height = Math.max(
      150,
      Math.floor((available - gap * Math.max(0, visible.length - 1)) / Math.max(1, visible.length)),
    );

    let top = panelStart;
    visible.forEach((item) => {
      item.panel.style.position = 'fixed';
      item.panel.style.left = '14px';
      item.panel.style.top = `${top}px`;
      item.panel.style.height = `${height}px`;
      item.panel.style.maxHeight = `${height}px`;
      item.panel.style.width = '350px';
      item.panel.style.maxWidth = 'calc(100vw - 28px)';
      top += height + gap;
    });
  };

  if (!resizeBound) {
    window.addEventListener('resize', () => {
      registrations.forEach((item) => item.panel.isConnected && item.toggleButton.isConnected);
      const visible = registrations.filter((item) => !item.panel.hidden);
      const gap = 10;
      const start = 174;
      const available = Math.max(160, window.innerHeight - start - 14);
      const height = Math.max(150, Math.floor((available - gap * Math.max(0, visible.length - 1)) / Math.max(1, visible.length)));
      let top = start;
      visible.sort((a, b) => a.order - b.order).forEach((item) => {
        item.panel.style.top = `${top}px`;
        item.panel.style.height = `${height}px`;
        item.panel.style.maxHeight = `${height}px`;
        top += height + gap;
      });
    });
    resizeBound = true;
  }

  layout();

  return {
    update: layout,
    unregister() {
      const index = registrations.indexOf(entry);
      if (index !== -1) registrations.splice(index, 1);
      layout();
    },
  };
}
