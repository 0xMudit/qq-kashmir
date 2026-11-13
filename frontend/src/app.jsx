import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shell,
  Field,
  Modal,
  Secret,
  Notice,
  Status,
  action,
  api,
  post,
  date,
  useRecords,
} from "./shared";
import { center, createFleetMap, L } from "./fleet-map";
import { toast } from "sonner";

function FleetMap({ vehicles, selected, points, onSelect }) {
  const node = useRef(null),
    controller = useRef(null),
    markers = useRef(new Map()),
    route = useRef(null);
  const [status, setStatus] = useState("Loading basemap…");
  useEffect(() => {
    controller.current = createFleetMap(node.current, setStatus);
    const observer = new ResizeObserver(() =>
      controller.current?.map.invalidateSize(),
    );
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      controller.current.destroy();
      controller.current = null;
      markers.current.clear();
    };
  }, []);
  useEffect(() => {
    const map = controller.current.map;
    const active = new Set(
      vehicles.filter((v) => v.lat !== null).map((v) => v.id),
    );
    for (const [id, marker] of markers.current)
      if (!active.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    for (const vehicle of vehicles) {
      if (vehicle.lat === null) continue;
      let marker = markers.current.get(vehicle.id);
      if (!marker) {
        marker = L.circleMarker([vehicle.lat, vehicle.lon], {
          radius: 8,
          fillColor: "#168b85",
          fillOpacity: 1,
          color: "#fff",
          weight: 3,
        }).addTo(map);
        const label = document.createElement("span");
        label.textContent = vehicle.label;
        marker.bindTooltip(label).on("click", () => onSelect(vehicle.id));
        markers.current.set(vehicle.id, marker);
      }
      marker
        .setLatLng([vehicle.lat, vehicle.lon])
        .setRadius(vehicle.id === selected?.id ? 11 : 8);
    }
  }, [vehicles, selected?.id, onSelect]);
  useEffect(() => {
    if (selected?.lat != null)
      controller.current.map.setView([selected.lat, selected.lon], 14);
  }, [selected?.id]);
  useEffect(() => {
    route.current?.remove();
    route.current = L.polyline(
      points.map((p) => [p.lat, p.lon]),
      { color: "#168b85", weight: 4 },
    ).addTo(controller.current.map);
    return () => route.current?.remove();
  }, [points]);
  return (
    <div className="map-region">
      <div
        ref={node}
        className="fleet-map"
        aria-label="Fleet positions and route map"
      />
      {status && (
        <div role="status" className="map-status">
          {status}
        </div>
      )}
      <Badge className="map-count">
        {vehicles.length} vehicles · {vehicles.filter((v) => v.online).length}{" "}
        online
      </Badge>
    </div>
  );
}
function Fleet() {
  const { rows, error, refresh } = useRecords("/vehicles");
  const [id, setId] = useState(null),
    [query, setQuery] = useState(""),
    [points, setPoints] = useState([]);
  const [modal, setModal] = useState(""),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false);
  const simulation = useRef(null),
    active = useRef(true);
  const selected = rows.find((v) => v.id === id);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      simulation.current = null;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setPoints([]);
    if (!id) return;
    function load() {
      if (!document.hidden)
        api("/vehicles/" + id + "/history")
          .then((data) => {
            if (current) setPoints(data);
          })
          .catch((e) => {
            if (current) toast.error(e.message);
          });
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [id]);
  function create(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    action(async () => {
      try {
        const vehicle = await post("/vehicles", data);
        await refresh();
        setId(vehicle.id);
        setModal("");
        setSecret(vehicle.device_token);
      } finally {
        setBusy(false);
      }
    });
  }
  async function locationUpdate(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    await action(async () => {
      try {
        const result = await post(
          "/vehicles/" + id + "/location",
          Object.fromEntries(
            Object.entries(data).map(([key, value]) => [key, Number(value)]),
          ),
        );
        toast[result.accepted ? "success" : "warning"](
          result.accepted ? "Location accepted" : "Stale update rejected",
        );
        setModal("");
        await refresh();
        setPoints(await api("/vehicles/" + id + "/history"));
      } finally {
        setBusy(false);
      }
    });
  }
  function sample() {
    setBusy(true);
    action(async () => {
      try {
        const vehicle = await post("/vehicles", {
          label: "Sample delivery bike",
          plate: "SAMPLE",
        });
        await post("/vehicles/" + vehicle.id + "/location", {
          seq: Date.now(),
          lat: center[0],
          lon: center[1],
          speed: 0,
        });
        await refresh();
        setId(vehicle.id);
      } finally {
        setBusy(false);
      }
    });
  }
  function simulate() {
    if (running) {
      simulation.current = null;
      return;
    }
    const run = Symbol();
    simulation.current = run;
    setRunning(true);
    const vehicle = selected;
    action(async () => {
      try {
        for (let i = 0; i < 12 && simulation.current === run; i++) {
          await post("/vehicles/" + vehicle.id + "/location", {
            seq: Math.max(Date.now(), vehicle.seq + i + 1),
            lat: Math.min(90, (vehicle.lat ?? center[0]) + i * 0.00025),
            lon: Math.max(
              -180,
              Math.min(
                180,
                (vehicle.lon ?? center[1]) + Math.sin(i / 3) * 0.001,
              ),
            ),
            speed: 18 + i,
          });
          await refresh();
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } finally {
        simulation.current = null;
        if (active.current) setRunning(false);
      }
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Fleet tracking</h1>
          <p className="text-muted-foreground">
            Follow vehicles and recent routes.
          </p>
        </div>
        <Button onClick={() => setModal("vehicle")}>Add vehicle</Button>
      </div>
      <Notice>{error}</Notice>
      <div className="fleet-layout">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Vehicles</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Input
              aria-label="Search vehicles"
              placeholder="Search vehicle or plate"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {rows
              .filter((v) =>
                (v.label + " " + v.plate)
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((v) => (
                <Button
                  key={v.id}
                  className="h-auto min-w-0 justify-between gap-3 py-3 whitespace-normal text-left"
                  variant={v.id === id ? "secondary" : "outline"}
                  onClick={() => setId(v.id)}
                >
                  <span>
                    {v.label}
                    <small className="block text-muted-foreground">
                      {v.plate || "No plate"}
                    </small>
                  </span>
                  <Status>{v.online ? "Online" : "Offline"}</Status>
                </Button>
              ))}
            {!rows.length && (
              <p className="text-sm text-muted-foreground">
                No vehicles connected.
              </p>
            )}
            <Button disabled={busy} variant="outline" onClick={sample}>
              Add sample vehicle
            </Button>
          </CardContent>
        </Card>
        <div className="min-w-0 grid gap-4">
          <FleetMap
            vehicles={rows}
            selected={selected}
            points={points}
            onSelect={setId}
          />
          {selected && (
            <Card>
              <CardHeader>
                <CardTitle>{selected.label}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  {selected.plate || "No plate"} · {selected.speed ?? 0} km/h ·{" "}
                  {date(selected.seen)} · {points.length} recent points
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setModal("location")}>
                    Send GPS update
                  </Button>
                  <Button variant="outline" onClick={simulate}>
                    {running ? "Stop simulation" : "Simulate route"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      action(async () =>
                        setSecret(
                          (await post("/vehicles/" + id + "/token"))
                            .device_token,
                        ),
                      )
                    }
                  >
                    Rotate device token
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setModal("archive")}
                  >
                    Archive
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <Modal
        open={modal === "vehicle"}
        onOpenChange={(open) => {
          if (!open) setModal("");
        }}
        title="Connect a vehicle"
        description="Register a vehicle and get its revocable telemetry token."
      >
        <form className="grid gap-4" onSubmit={create}>
          <Field
            id="vehicle-label"
            name="label"
            label="Vehicle name"
            required
            maxLength={80}
          />
          <Field
            id="vehicle-plate"
            name="plate"
            label="Plate or reference"
            maxLength={24}
          />
          <Button disabled={busy}>Create vehicle</Button>
        </form>
      </Modal>
      <Modal
        open={modal === "location" && Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setModal("");
        }}
        title="Send a GPS update"
        description="A newer sequence number is required."
      >
        <form className="grid gap-4" onSubmit={locationUpdate}>
          <Field
            id="lat"
            name="lat"
            label="Latitude"
            type="number"
            step="any"
            min={-90}
            max={90}
            defaultValue={selected?.lat ?? center[0]}
            required
          />
          <Field
            id="lon"
            name="lon"
            label="Longitude"
            type="number"
            step="any"
            min={-180}
            max={180}
            defaultValue={selected?.lon ?? center[1]}
            required
          />
          <Field
            id="speed"
            name="speed"
            label="Speed (km/h)"
            type="number"
            step="any"
            min={0}
            max={400}
            defaultValue={0}
            required
          />
          <Field
            id="seq"
            name="seq"
            label="Sequence number"
            type="number"
            min={0}
            defaultValue={Math.max(Date.now(), (selected?.seq ?? 0) + 1)}
            required
          />
          <Button
            type="button"
            variant="outline"
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (!navigator.geolocation)
                return toast.error("Geolocation is unavailable");
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  form.elements.lat.value = position.coords.latitude;
                  form.elements.lon.value = position.coords.longitude;
                  toast.success("Coordinates filled. Send the update to save.");
                },
                (error) => toast.error(error.message),
                { timeout: 10000 },
              );
            }}
          >
            Fill with my location
          </Button>
          <Button disabled={busy}>Send update</Button>
        </form>
      </Modal>
      <Modal
        open={modal === "archive"}
        onOpenChange={(open) => {
          if (!open) setModal("");
        }}
        title="Archive vehicle"
        description="This revokes the vehicle’s telemetry token and hides it from the active fleet."
      >
        <Button
          variant="destructive"
          onClick={() =>
            action(async () => {
              await post("/vehicles/" + id + "/archive");
              simulation.current = null;
              setId(null);
              setModal("");
              await refresh();
            })
          }
        >
          Archive vehicle
        </Button>
      </Modal>
      <Secret value={secret} close={() => setSecret("")} />
    </>
  );
}
export default function App() {
  return <Shell Product={Fleet} />;
}
