export interface SensorPoint {
  id: string;
  sensorId: number;
  name: string;
  level: number;
  position: [number, number];
  updatedAt?: string;
  source?: string;
  eventType?: string;
}

export interface SensorReading {
  id: number;
  sensor_id: number;
  noise_level: number;
  recorded_at: string;
  source: string;
  event_type: string;
}
