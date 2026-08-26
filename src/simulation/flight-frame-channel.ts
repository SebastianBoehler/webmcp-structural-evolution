import type { FlightFrame } from "./flight-scenarios";

export interface FlightFrameSource {
  subscribe(listener: (frame: FlightFrame | undefined) => void): () => void;
}

export interface FlightFrameChannel extends FlightFrameSource {
  emit(frame: FlightFrame | undefined): void;
}

export function createFlightFrameChannel(): FlightFrameChannel {
  const listeners = new Set<(frame: FlightFrame | undefined) => void>();
  let latest: FlightFrame | undefined;
  return {
    emit(frame) {
      latest = frame;
      listeners.forEach((listener) => listener(frame));
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(latest);
      return () => listeners.delete(listener);
    },
  };
}
