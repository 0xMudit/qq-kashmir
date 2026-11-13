import { createFleetMap, L } from "./fleet-map";
export function mountLabMap(node) {
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  node.before(status);
  node.style.background = "#0e2527";
  const { map, destroy } = createFleetMap(node, (message) => {
    status.textContent = message;
  });
  const markers = new Map();
  window.updateMap = (rows = []) => {
    for (const point of rows) {
      const position = [point.lat, point.lon];
      if (markers.has(point.vehicle))
        markers.get(point.vehicle).setLatLng(position);
      else {
        const label = document.createElement("span");
        label.textContent = point.vehicle;
        markers.set(
          point.vehicle,
          L.circleMarker(position).addTo(map).bindTooltip(label),
        );
      }
    }
  };
  async function refresh() {
    if (document.hidden) return;
    try {
      const response = await fetch("/demo/fleet");
      if (response.ok) window.updateMap(await response.json());
    } catch {
      // Keep the last known positions during a temporary network outage.
    }
  }
  refresh();
  const timer = setInterval(refresh, 2000);
  return () => {
    clearInterval(timer);
    delete window.updateMap;
    destroy();
    status.remove();
  };
}
