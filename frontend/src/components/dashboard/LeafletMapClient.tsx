"use client";

import { useEffect } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";

import type { SensorPoint } from "./map-types";
import "leaflet/dist/leaflet.css";

interface LeafletMapClientProps {
  sensors: SensorPoint[];
  onSelect: (sensor: SensorPoint | null) => void;
}

const MAP_CENTER: [number, number] = [28.6139, 77.209];
const MAP_ZOOM = 11;

function getSeverity(level: number) {
  if (level < 70) return { label: "LOW", color: "#33ff00" };
  if (level < 85) return { label: "MODERATE", color: "#ffb000" };
  if (level < 95) return { label: "HIGH", color: "#ff7a00" };
  return { label: "CRITICAL", color: "#ff3333" };
}

function getHeatRadius(level: number) {
  if (level < 70) return 650;
  if (level < 85) return 800;
  if (level < 95) return 950;
  return 1150;
}

function MapController() {
  const map = useMap();

  useEffect(() => {
    const handleZoom = (event: Event) => {
      const detail = (event as CustomEvent<"in" | "out">).detail;
      if (detail === "in") map.zoomIn();
      if (detail === "out") map.zoomOut();
    };

    const handleReset = () => {
      map.setView(MAP_CENTER, MAP_ZOOM, { animate: true });
    };

    window.addEventListener("noiseguard-map-zoom", handleZoom);
    window.addEventListener("noiseguard-map-reset", handleReset);

    return () => {
      window.removeEventListener("noiseguard-map-zoom", handleZoom);
      window.removeEventListener("noiseguard-map-reset", handleReset);
    };
  }, [map]);

  return null;
}

function createSensorIcon(level: number) {
  const config = getSeverity(level);

  return L.divIcon({
    className: "noiseguard-sensor-marker",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `
      <div style="
        width:20px;
        height:20px;
        border-radius:50%;
        background:${config.color};
        border:2px solid #050805;
        box-shadow:0 0 8px ${config.color},0 0 18px ${config.color};
        display:flex;
        align-items:center;
        justify-content:center;
      ">
        <div style="
          width:6px;
          height:6px;
          border-radius:50%;
          background:#050805;
        "></div>
      </div>
    `,
  });
}

function NoiseField({ sensor }: { sensor: SensorPoint }) {
  const config = getSeverity(sensor.level);
  const radius = getHeatRadius(sensor.level);

  return (
    <>
      <Circle
        center={sensor.position}
        radius={radius * 1.45}
        pathOptions={{
          stroke: false,
          fillColor: config.color,
          fillOpacity: 0.018,
          weight: 0,
        }}
      />
      <Circle
        center={sensor.position}
        radius={radius * 1.15}
        pathOptions={{
          stroke: false,
          fillColor: config.color,
          fillOpacity: 0.028,
          weight: 0,
        }}
      />
      <Circle
        center={sensor.position}
        radius={radius * 0.82}
        pathOptions={{
          stroke: false,
          fillColor: config.color,
          fillOpacity: 0.045,
          weight: 0,
        }}
      />
      <Circle
        center={sensor.position}
        radius={radius * 0.58}
        pathOptions={{
          stroke: false,
          fillColor: config.color,
          fillOpacity: 0.07,
          weight: 0,
        }}
      />
      <Circle
        center={sensor.position}
        radius={radius * 0.30}
        pathOptions={{
          stroke: false,
          fillColor: config.color,
          fillOpacity: 0.11,
          weight: 0,
        }}
      />
      <CircleMarker
        center={sensor.position}
        radius={5}
        pathOptions={{
          color: config.color,
          fillColor: config.color,
          fillOpacity: 0.9,
          weight: 1,
        }}
        eventHandlers={{
          click: () => undefined,
        }}
      />
    </>
  );
}

export default function LeafletMapClient({
  sensors,
  onSelect,
}: LeafletMapClientProps) {
  return (
    <MapContainer
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
      minZoom={9}
      maxZoom={18}
      scrollWheelZoom
      zoomControl={false}
      worldCopyJump
      className="h-full w-full"
    >
      <TileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        opacity={0.55}
      />

      <MapController />

      {sensors.map((sensor) => (
        <NoiseField
          key={`field-${sensor.id}`}
          sensor={sensor}
        />
      ))}

      {sensors.map((sensor) => {
        const config = getSeverity(sensor.level);

        return (
          <CircleMarker
            key={`sensor-${sensor.id}`}
            center={sensor.position}
            radius={7}
            pathOptions={{
              color: config.color,
              fillColor: config.color,
              fillOpacity: 0.95,
              weight: 2,
            }}
            eventHandlers={{
              click: () => onSelect(sensor),
            }}
          >
            <Popup>
              <div
                style={{
                  minWidth: 170,
                  background: "#070a07",
                  color: config.color,
                  fontFamily: "monospace",
                  fontSize: 11,
                  lineHeight: 1.7,
                  padding: 7,
                  border: `1px solid ${config.color}`,
                }}
              >
                <div>SENSOR: {sensor.id}</div>
                <div>LOCATION: {sensor.name}</div>
                <div>CURRENT: {sensor.level.toFixed(1)} dB</div>
                <div>STATUS: [{config.label}]</div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

    </MapContainer>
  );
}
