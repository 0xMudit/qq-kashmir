import L from "leaflet";
import { setWorkerUrl } from "maplibre-gl";
import WorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(WorkerUrl);
export const center = [34.0837, 74.7973];
const style = "https://tiles.openfreemap.org/styles/liberty";
export function createFleetMap(node, onStatus) {
  const map = L.map(node, { zoomControl: false }).setView(center, 12);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  let layer,
    timer,
    disposed = false;
  const attribution =
    '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';
  const fallback = () => {
    if (disposed) return;
    clearTimeout(timer);
    if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    onStatus(
      "Basemap unavailable. Vehicle positions and routes are still shown.",
    );
  };
  try {
    layer = maplibreGL({ style, interactive: false });
    layer.addTo(map);
    map.attributionControl.addAttribution(attribution);
    const gl = layer.getMaplibreMap();
    timer = setTimeout(fallback, 12000);
    gl.once("load", () => {
      clearTimeout(timer);
      onStatus("");
    });
    gl.on("error", fallback);
  } catch {
    fallback();
  }
  return {
    map,
    destroy() {
      disposed = true;
      clearTimeout(timer);
      map.remove();
    },
  };
}
export { L };
