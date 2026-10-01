"use client";

import { Fragment, useEffect, useRef } from "react";

import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";

import L, {
  type LatLngExpression,
} from "leaflet";

export interface MapSensor {
  id: string;
  sensorId: number;
  name: string;
  level: number;
  latitude: number;
  longitude: number;
}

interface LeafletMapProps {
  sensors: MapSensor[];
  activeLayer: "HEATMAP" | "SENSORS";
  selectedSensorId: string | null;
  onSelectSensor: (sensorId: string) => void;
}

interface NoiseConfig {
  color: string;
  fillColor: string;
  radius: number;
  label: string;
  opacity: number;
}

/* =========================================================
   SAFE NUMBER
========================================================= */

function safeNumber(
  value: unknown,
  fallback = 0,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

/* =========================================================
   NOISE CONFIG
========================================================= */

function getNoiseConfig(
  level: number,
): NoiseConfig {
  const safeLevel = safeNumber(level);

  if (safeLevel >= 95) {
    return {
      color: "#ff3333",
      fillColor: "#ff3333",
      radius: 3000,
      label: "CRITICAL",
      opacity: 0.34,
    };
  }

  if (safeLevel >= 85) {
    return {
      color: "#ff7a00",
      fillColor: "#ff7a00",
      radius: 2200,
      label: "HIGH",
      opacity: 0.30,
    };
  }

  if (safeLevel >= 70) {
    return {
      color: "#ffb000",
      fillColor: "#ffb000",
      radius: 1400,
      label: "MODERATE",
      opacity: 0.26,
    };
  }

  return {
    color: "#33ff00",
    fillColor: "#33ff00",
    radius: 700,
    label: "LOW",
    opacity: 0.22,
  };
}

/* =========================================================
   SENSOR ICON
========================================================= */

function createSensorIcon(
  level: number,
  selected: boolean,
) {
  const safeLevel = safeNumber(level);
  const config = getNoiseConfig(
    safeLevel,
  );

  const size = selected ? 48 : 42;

  return L.divIcon({
    className: "",
    html: `
      <div
        style="
          width:${size}px;
          height:${size}px;
          border-radius:50%;
          background:${config.color};
          border:${selected ? 3 : 2}px solid #0a0a0a;
          box-shadow:
            0 0 0 2px ${config.color},
            0 0 18px ${config.color};
          display:flex;
          align-items:center;
          justify-content:center;
          color:#0a0a0a;
          font-family:monospace;
          font-size:${selected ? 13 : 11}px;
          font-weight:900;
          box-sizing:border-box;
        "
      >
        ${Math.round(safeLevel)}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [
      size / 2,
      size / 2,
    ],
    popupAnchor: [
      0,
      -(size / 2),
    ],
  });
}

/* =========================================================
   HEATMAP CENTER DOT
========================================================= */

function createHeatDotIcon(
  level: number,
) {
  const safeLevel = safeNumber(level);
  const config = getNoiseConfig(
    safeLevel,
  );

  return L.divIcon({
    className: "",
    html: `
      <div
        style="
          width:16px;
          height:16px;
          border-radius:50%;
          background:${config.color};
          border:2px solid #0a0a0a;
          box-shadow:
            0 0 0 2px ${config.color},
            0 0 12px ${config.color};
          box-sizing:border-box;
        "
      ></div>
    `,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

/* =========================================================
   MAP SIZE CONTROLLER
========================================================= */

function MapSizeController() {
  const map = useMap();

  useEffect(() => {
    const forceMapSize = () => {
      const container =
        map.getContainer();

      if (!container) {
        return;
      }

      if (
        container.clientWidth <= 0 ||
        container.clientHeight <= 0
      ) {
        return;
      }

      map.invalidateSize({
        animate: false,
        pan: false,
      });
    };

    const timers = [
      window.setTimeout(
        forceMapSize,
        0,
      ),
      window.setTimeout(
        forceMapSize,
        100,
      ),
      window.setTimeout(
        forceMapSize,
        250,
      ),
      window.setTimeout(
        forceMapSize,
        500,
      ),
      window.setTimeout(
        forceMapSize,
        1000,
      ),
    ];

    const container =
      map.getContainer();

    const observer =
      typeof ResizeObserver !==
      "undefined"
        ? new ResizeObserver(() => {
            forceMapSize();
          })
        : null;

    observer?.observe(container);

    window.addEventListener(
      "resize",
      forceMapSize,
    );

    return () => {
      timers.forEach(
        (timer) => {
          window.clearTimeout(
            timer,
          );
        },
      );

      observer?.disconnect();

      window.removeEventListener(
        "resize",
        forceMapSize,
      );
    };
  }, [map]);

  return null;
}

/* =========================================================
   MAP CONTROLS
========================================================= */

function MapControls() {
  const map = useMap();

  useEffect(() => {
    const handleZoom = (
      event: Event,
    ) => {
      const customEvent =
        event as CustomEvent<
          "in" | "out"
        >;

      if (
        customEvent.detail === "in"
      ) {
        map.zoomIn();
      }

      if (
        customEvent.detail === "out"
      ) {
        map.zoomOut();
      }
    };

    const handleReset = () => {
      map.setView(
        [28.6139, 77.209],
        11,
        {
          animate: true,
        },
      );
    };

    window.addEventListener(
      "noiseguard-map-zoom",
      handleZoom,
    );

    window.addEventListener(
      "noiseguard-map-reset",
      handleReset,
    );

    return () => {
      window.removeEventListener(
        "noiseguard-map-zoom",
        handleZoom,
      );

      window.removeEventListener(
        "noiseguard-map-reset",
        handleReset,
      );
    };
  }, [map]);

  return null;
}

/* =========================================================
   SELECTED SENSOR CONTROLLER
========================================================= */

function SelectedSensorController({
  sensors,
  selectedSensorId,
}: {
  sensors: MapSensor[];
  selectedSensorId:
    | string
    | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedSensorId) {
      return;
    }

    const sensor =
      sensors.find(
        (item) =>
          item.id ===
          selectedSensorId,
      );

    if (!sensor) {
      return;
    }

    map.flyTo(
      [
        sensor.latitude,
        sensor.longitude,
      ],
      13,
      {
        animate: true,
        duration: 0.8,
      },
    );
  }, [
    map,
    sensors,
    selectedSensorId,
  ]);

  return null;
}

/* =========================================================
   SENSOR BOUNDS
========================================================= */

function SensorBounds({
  sensors,
}: {
  sensors: MapSensor[];
}) {
  const map = useMap();

  useEffect(() => {
    if (
      sensors.length === 0
    ) {
      return;
    }

    const timer =
      window.setTimeout(() => {
        const container =
          map.getContainer();

        if (
          container.clientWidth <= 0 ||
          container.clientHeight <= 0
        ) {
          return;
        }

        const bounds =
          L.latLngBounds(
            sensors.map(
              (sensor) =>
                [
                  safeNumber(
                    sensor.latitude,
                  ),
                  safeNumber(
                    sensor.longitude,
                  ),
                ] as [
                  number,
                  number,
                ],
            ),
          );

        map.invalidateSize({
          animate: false,
          pan: false,
        });

        map.fitBounds(
          bounds,
          {
            padding: [
              50,
              50,
            ],
            maxZoom: 11,
            animate: false,
          },
        );

        window.setTimeout(
          () => {
            map.invalidateSize({
              animate: false,
              pan: false,
            });
          },
          100,
        );
      }, 300);

    return () => {
      window.clearTimeout(
        timer,
      );
    };
  }, [map, sensors]);

  return null;
}

/* =========================================================
   MAIN MAP
========================================================= */

export default function LeafletMap({
  sensors,
  activeLayer,
  selectedSensorId,
  onSelectSensor,
}: LeafletMapProps) {
  const center: LatLngExpression = [
    28.6139,
    77.209,
  ];

  /*
   * Prevent repeated automatic bounds
   * calculations from moving the map every
   * time a live reading arrives.
   */
  const firstBoundsRun =
    useRef(false);

  return (
    <div className="relative h-full min-h-0 w-full min-w-0 overflow-hidden">
      <MapContainer
        center={center}
        zoom={11}
        minZoom={2}
        maxZoom={19}
        scrollWheelZoom={true}
        zoomControl={false}
        worldCopyJump={true}
        className="absolute inset-0 h-full w-full"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: "100%",
          height: "100%",
          minWidth: "100%",
          minHeight: "100%",
          background:
            "#050a05",
        }}
      >
        {/* =================================================
            BASE MAP
        ================================================= */}

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          tileSize={256}
          updateWhenZooming={true}
          updateWhenIdle={true}
          keepBuffer={2}
        />

        {/* =================================================
            MAP ENGINE
        ================================================= */}

        <MapSizeController />

        <MapControls />

        {!firstBoundsRun.current && (
          <SensorBounds
            sensors={sensors}
          />
        )}

        <SelectedSensorController
          sensors={sensors}
          selectedSensorId={
            selectedSensorId
          }
        />

        {/* =================================================
            SENSOR RENDERING
        ================================================= */}

        {sensors.map(
          (sensor) => {
            const level =
              safeNumber(
                sensor.level,
              );

            const config =
              getNoiseConfig(
                level,
              );

            const selected =
              sensor.id ===
              selectedSensorId;

            return (
              <Fragment
                key={sensor.id}
              >
                {/* =========================================
                    HEATMAP MODE
                ========================================= */}

                {activeLayer ===
                  "HEATMAP" && (
                  <>
                    {/* Outer influence zone */}

                    <Circle
                      center={[
                        sensor.latitude,
                        sensor.longitude,
                      ]}
                      radius={
                        config.radius
                      }
                      pathOptions={{
                        color:
                          config.color,
                        fillColor:
                          config.fillColor,
                        fillOpacity:
                          config.opacity,
                        weight: 2,
                        opacity: 0.9,
                      }}
                    />

                    {/* Inner intensity zone */}

                    <Circle
                      center={[
                        sensor.latitude,
                        sensor.longitude,
                      ]}
                      radius={
                        config.radius *
                        0.45
                      }
                      pathOptions={{
                        color:
                          config.color,
                        fillColor:
                          config.fillColor,
                        fillOpacity:
                          Math.min(
                            config.opacity +
                              0.12,
                            0.55,
                          ),
                        weight: 1,
                        opacity: 0.95,
                      }}
                    />

                    {/* Center dot */}

                    <Marker
                      position={[
                        sensor.latitude,
                        sensor.longitude,
                      ]}
                      icon={createHeatDotIcon(
                        level,
                      )}
                      eventHandlers={{
                        click: () => {
                          onSelectSensor(
                            sensor.id,
                          );
                        },
                      }}
                    >
                      <Popup>
                        <div
                          style={{
                            minWidth:
                              "190px",
                            fontFamily:
                              "monospace",
                            color:
                              "#33ff00",
                            background:
                              "#0a0a0a",
                            padding:
                              "6px",
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 900,
                              marginBottom:
                                "8px",
                            }}
                          >
                            {
                              sensor.name
                            }
                          </div>

                          <div>
                            SENSOR:{" "}
                            {
                              sensor.id
                            }
                          </div>

                          <div>
                            LEVEL:{" "}
                            {level.toFixed(
                              1,
                            )}{" "}
                            dB
                          </div>

                          <div>
                            STATUS:{" "}
                            {
                              config.label
                            }
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  </>
                )}

                {/* =========================================
                    SENSOR MODE
                ========================================= */}

                {activeLayer ===
                  "SENSORS" && (
                  <Marker
                    position={[
                      sensor.latitude,
                      sensor.longitude,
                    ]}
                    icon={createSensorIcon(
                      level,
                      selected,
                    )}
                    eventHandlers={{
                      click: () => {
                        onSelectSensor(
                          sensor.id,
                        );
                      },
                    }}
                  >
                    <Popup>
                      <div
                        style={{
                          minWidth:
                            "190px",
                          fontFamily:
                            "monospace",
                          color:
                            "#33ff00",
                          background:
                            "#0a0a0a",
                          padding:
                            "6px",
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 900,
                            marginBottom:
                              "8px",
                          }}
                        >
                          {
                            sensor.name
                          }
                        </div>

                        <div>
                          SENSOR:{" "}
                          {
                            sensor.id
                          }
                        </div>

                        <div>
                          LEVEL:{" "}
                          {level.toFixed(
                            1,
                          )}{" "}
                          dB
                        </div>

                        <div>
                          STATUS:{" "}
                          {
                            config.label
                          }
                        </div>

                        <div>
                          LAT:{" "}
                          {sensor.latitude.toFixed(
                            4,
                          )}
                        </div>

                        <div>
                          LNG:{" "}
                          {sensor.longitude.toFixed(
                            4,
                          )}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )}
              </Fragment>
            );
          },
        )}
      </MapContainer>
    </div>
  );
}