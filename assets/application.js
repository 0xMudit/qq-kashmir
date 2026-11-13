let vehicles = [];
let selectedVehicle = null;
let fleetMap = null;
let routeLayer = null;
const markers = {};
let simulation = 0;
function initMap() {
  if (fleetMap) return;
  fleetMap = L.map("fleet-map").setView([34.0837, 74.7973], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(fleetMap);
}
function renderVehicles() {
  const query = $("vehicle-search").value.toLowerCase(),
    rows = vehicles.filter((v) =>
      (v.label + " " + v.plate).toLowerCase().includes(query),
    );
  $("fleet-count").textContent = vehicles.length;
  $("online-count").textContent = vehicles.filter((v) => v.online).length;
  $("fleet-empty").hidden = vehicles.length > 0;
  $("vehicle-list").innerHTML = rows
    .map(
      (v) =>
        '<article class="vehicle-card ' +
        (v.id === selectedVehicle ? "selected" : "") +
        '" tabindex="0" role="button" data-vehicle="' +
        v.id +
        '"><div class="row"><h3>' +
        esc(v.label) +
        '</h3><span class="status ' +
        (v.online ? "online" : "offline") +
        '">' +
        (v.online ? "Online" : "Offline") +
        "</span></div><p>" +
        esc(v.plate || "No plate") +
        "</p><p>Last seen " +
        esc(
          v.seen
            ? new Date(v.seen * 1000).toLocaleTimeString()
            : "Awaiting GPS",
        ) +
        "</p></article>",
    )
    .join("");
  const active = new Set(vehicles.map((v) => v.id));
  for (const [id, marker] of Object.entries(markers)) {
    if (!active.has(id)) {
      marker.remove();
      delete markers[id];
    }
  }
  for (const v of vehicles) {
    if (v.lat === null) continue;
    if (markers[v.id]) markers[v.id].setLatLng([v.lat, v.lon]);
    else {
      const label = document.createElement("span");
      label.textContent = v.label;
      markers[v.id] = L.circleMarker([v.lat, v.lon], {
        radius: 9,
        color: "#fff",
        weight: 3,
        fillColor: "#168b85",
        fillOpacity: 1,
      })
        .addTo(fleetMap)
        .bindTooltip(label)
        .on("click", () => selectVehicle(v.id));
    }
  }
  const v = vehicles.find((v) => v.id === selectedVehicle);
  $("vehicle-detail").hidden = !v;
  if (v) {
    $("selected-label").textContent = v.label;
    $("selected-meta").textContent =
      (v.plate || "No plate") +
      " · " +
      (v.speed ?? 0) +
      " km/h · " +
      stamp(v.seen);
    $("selected-status").textContent = v.online ? "Online" : "Offline";
    $("selected-status").className =
      "status " + (v.online ? "online" : "offline");
  }
}
async function refreshFleet() {
  vehicles = await api("/vehicles");
  renderVehicles();
  if (selectedVehicle) await loadRoute();
}
async function loadRoute() {
  const selected = selectedVehicle;
  const points = await api("/vehicles/" + selected + "/history");
  if (selected !== selectedVehicle) return;
  if (routeLayer) routeLayer.remove();
  routeLayer = L.polyline(
    points.map((p) => [p.lat, p.lon]),
    { color: "#168b85", weight: 4, opacity: 0.7 },
  ).addTo(fleetMap);
  $("route-info").textContent =
    points.length +
    " recent route points · " +
    (simulation
      ? "Sample route simulation running"
      : "Latest 200 accepted points");
}
async function selectVehicle(id) {
  selectedVehicle = id;
  renderVehicles();
  const v = vehicles.find((v) => v.id === id);
  if (v && v.lat !== null) fleetMap.setView([v.lat, v.lon], 14);
  try {
    await loadRoute();
  } catch (e) {
    toast(e.message);
  }
}
$("vehicle-list").onclick = (event) => {
  const item = event.target.closest("[data-vehicle]");
  if (item) selectVehicle(item.dataset.vehicle);
};
$("vehicle-list").onkeydown = (event) => {
  if (event.key === "Enter" || event.key === " ") {
    const item = event.target.closest("[data-vehicle]");
    if (item) {
      event.preventDefault();
      selectVehicle(item.dataset.vehicle);
    }
  }
};
$("vehicle-search").oninput = renderVehicles;
$("new-vehicle").onclick = () => openDialog("vehicle-dialog");
$("vehicle-form").onsubmit = async (event) => {
  event.preventDefault();
  $("create-vehicle").disabled = true;
  try {
    const v = await post("/vehicles", {
      label: $("vehicle-label").value,
      plate: $("vehicle-plate").value,
    });
    $("vehicle-dialog").close();
    $("vehicle-form").reset();
    await refreshFleet();
    await selectVehicle(v.id);
    reveal(v.device_token);
    toast("Vehicle created. Copy its device token before closing.");
  } catch (e) {
    toast(e.message);
  } finally {
    $("create-vehicle").disabled = false;
  }
};
$("add-sample").onclick = async () => {
  $("add-sample").disabled = true;
  try {
    const v = await post("/vehicles", {
      label: "Sample delivery bike",
      plate: "SAMPLE-" + Math.floor(Math.random() * 10000),
    });
    await post("/vehicles/" + v.id + "/location", {
      seq: Date.now(),
      lat: 34.0837,
      lon: 74.7973,
      speed: 0,
    });
    await refreshFleet();
    await selectVehicle(v.id);
    toast("Sample vehicle added. Use Simulate route to send test GPS points.");
  } catch (e) {
    toast(e.message);
  } finally {
    $("add-sample").disabled = false;
  }
};
$("send-location").onclick = () => {
  const v = vehicles.find((v) => v.id === selectedVehicle);
  if (!v) return;
  $("location-lat").value = v.lat ?? 34.0837;
  $("location-lon").value = v.lon ?? 74.7973;
  $("location-seq").value = Math.max(Date.now(), v.seq + 1);
  openDialog("location-dialog");
};
$("location-form").onsubmit = async (event) => {
  event.preventDefault();
  $("submit-location").disabled = true;
  try {
    const result = await post("/vehicles/" + selectedVehicle + "/location", {
      seq: Number($("location-seq").value),
      lat: Number($("location-lat").value),
      lon: Number($("location-lon").value),
      speed: Number($("location-speed").value),
    });
    toast(
      result.accepted
        ? "GPS update accepted"
        : "Stale update rejected; latest position preserved",
    );
    $("location-dialog").close();
    await refreshFleet();
    await selectVehicle(selectedVehicle);
  } catch (e) {
    toast(e.message);
  } finally {
    $("submit-location").disabled = false;
  }
};
$("my-location").onclick = () => {
  if (!navigator.geolocation) return toast("Geolocation is not supported");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      $("location-lat").value = position.coords.latitude;
      $("location-lon").value = position.coords.longitude;
      toast("Coordinates filled. Select Send update to save.");
    },
    (error) => toast(error.message),
    { enableHighAccuracy: true, timeout: 10000 },
  );
};
$("rotate-device").onclick = async () => {
  try {
    const result = await post("/vehicles/" + selectedVehicle + "/token");
    reveal(result.device_token);
    toast("Previous device token revoked");
  } catch (e) {
    toast(e.message);
  }
};
$("archive-vehicle").onclick = async () => {
  try {
    await post("/vehicles/" + selectedVehicle + "/archive");
    simulation = 0;
    selectedVehicle = null;
    if (routeLayer) routeLayer.remove();
    await refreshFleet();
    toast("Vehicle archived; device access revoked");
  } catch (e) {
    toast(e.message);
  }
};
$("sample-route").onclick = async () => {
  if (simulation) {
    simulation = 0;
    return;
  }
  const vehicle = vehicles.find((v) => v.id === selectedVehicle);
  if (!vehicle) return;
  const run = Date.now();
  simulation = run;
  $("sample-route").textContent = "Stop simulation";
  try {
    for (let i = 0; i < 12 && simulation === run; i++) {
      await post("/vehicles/" + vehicle.id + "/location", {
        seq: Date.now(),
        lat: (vehicle.lat ?? 34.0837) + i * 0.00025,
        lon: (vehicle.lon ?? 74.7973) + Math.sin(i / 3) * 0.001,
        speed: 18 + i,
      });
      await refreshFleet();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } catch (e) {
    toast(e.message);
  } finally {
    simulation = 0;
    $("sample-route").textContent = "Simulate route";
  }
};
document.addEventListener("account-ready", () => {
  initMap();
  setTimeout(() => fleetMap.invalidateSize(), 100);
  refreshFleet().catch((e) => toast(e.message));
});
setInterval(() => {
  if (account && !document.hidden) refreshFleet().catch(() => {});
}, 5000);
