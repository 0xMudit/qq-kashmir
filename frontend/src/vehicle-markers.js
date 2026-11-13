import { L } from "./fleet-map";

export const vehicleTypes = [
  ["car", "Car"],
  ["truck", "Truck"],
  ["bus", "Bus"],
];

// Each silhouette points north. Rotation is applied to the drawing, leaving the
// marker and its selection ring anchored to the GPS coordinate.
const silhouettes = {
  car: '<path d="M8 5Q8 2 12 2H16Q20 2 20 5L22 13V22Q22 25 19 25H9Q6 25 6 22V13Z"/><path class="vehicle-glass" d="M10 8H18L19 12H9Z M9 19H19L18 22H10Z"/>',
  truck:
    '<rect x="6" y="11" width="16" height="15" rx="2"/><path d="M8 10V5Q8 2 11 2H17Q20 2 20 5V10Z"/><path class="vehicle-glass" d="M10 5H18V8H10Z M9 14H19V23H9Z"/>',
  bus: '<rect x="6" y="1.5" width="16" height="25" rx="4"/><path class="vehicle-glass" d="M9 5H19V10H9Z M9 13H11V22H9Z M17 13H19V22H17Z M12.5 14H15.5V19H12.5Z"/>',
};

export function vehicleIcon(
  type,
  { selected = false, online = false, heading = 0 } = {},
) {
  const kind = Object.hasOwn(silhouettes, type) ? type : "car";
  return L.divIcon({
    className: "vehicle-marker",
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    tooltipAnchor: [0, -20],
    html: `<span class="vehicle-marker-face" data-type="${kind}" data-selected="${selected}" data-online="${online}"><svg aria-hidden="true" viewBox="0 0 28 28" style="transform:rotate(${heading}deg)">${silhouettes[kind]}</svg></span>`,
  });
}

export function travelHeading(previous, next, heading) {
  // Ignore GPS jitter so parked vehicles retain their last visible direction.
  if (previous.distanceTo(next) < 5) return heading;
  const radians = Math.PI / 180;
  const lat1 = previous.lat * radians;
  const lat2 = next.lat * radians;
  const longitude = (next.lng - previous.lng) * radians;
  const east = Math.sin(longitude) * Math.cos(lat2);
  const north =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(longitude);
  return Math.round(Math.atan2(east, north) / radians);
}
