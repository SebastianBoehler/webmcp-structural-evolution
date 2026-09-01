import { useEffect, useRef, useState, type RefObject } from "react";

import {
  mountSemanticFieldSession,
  type SemanticCaptureLifecycle,
  type SemanticFieldRendererSession,
} from "../viewer/semantic-field-session";
import type { ViewerRenderModel } from "../viewer/render-model-types";

export type ThermalViewportState = { readonly kind: "initializing" | "ready"; readonly layer: string }
  | { readonly kind: "error"; readonly layer: string; readonly message: string };

interface Target {
  readonly model: ViewerRenderModel;
  readonly layer: string;
  readonly revision: string;
  readonly epoch: number;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function settleThermalMount<T>(
  mounting: Promise<T>,
  ready: (mounted: T) => void,
  failed: (error: unknown) => void,
): Promise<void> {
  try {
    ready(await mounting);
  } catch (error) {
    failed(error);
  }
}

export function useThermalViewportLifecycle(
  canvas: RefObject<HTMLCanvasElement | null>,
  model: ViewerRenderModel,
  sourceRevision: string,
  layer: string,
  sessionIdentity: object,
) {
  const renderer = useRef<SemanticFieldRendererSession | undefined>(undefined);
  const requested = useRef<Target | undefined>(undefined);
  const confirmed = useRef<Target | undefined>(undefined);
  const sequence = useRef(0), generation = useRef(0), running = useRef(false);
  const [mountAttempt, setMountAttempt] = useState(0);
  const latest = useRef({ model, layer, key: `${sourceRevision}:${layer}` });
  latest.current = { model, layer, key: `${sourceRevision}:${layer}` };
  const [state, setState] = useState<ThermalViewportState>({ kind: "initializing", layer });

  const target = () => ({ model: latest.current.model, layer: latest.current.layer,
    revision: `${latest.current.key}:capture:${++sequence.current}`, epoch: sequence.current });
  const current = (candidate: Target, mountedGeneration: number) => generation.current === mountedGeneration
    && requested.current?.epoch === candidate.epoch;
  const publishError = (candidate: Target, mountedGeneration: number, error: unknown) => {
    if (current(candidate, mountedGeneration)) {
      confirmed.current = undefined;
      setState({ kind: "error", layer: candidate.layer, message: message(error) });
    }
  };
  const pump = (mountedGeneration: number) => {
    const mounted = renderer.current, next = requested.current;
    if (!mounted || !next || running.current || generation.current !== mountedGeneration) return;
    running.current = true;
    let completion: Promise<void>;
    try {
      completion = Promise.resolve(mounted.updateModel(next.model, next.revision));
    } catch (error) {
      completion = Promise.reject(error);
    }
    void completion.then(() => {
      if (current(next, mountedGeneration)) {
        confirmed.current = next;
        setState({ kind: "ready", layer: next.layer });
      }
    }).catch((error) => publishError(next, mountedGeneration, error)).finally(() => {
      if (generation.current !== mountedGeneration) return;
      running.current = false;
      if (requested.current?.epoch !== next.epoch) pump(mountedGeneration);
    });
  };
  const request = (mountedGeneration: number) => {
    const next = target();
    requested.current = next;
    setState({ kind: "initializing", layer: next.layer });
    pump(mountedGeneration);
  };

  useEffect(() => {
    const mountedGeneration = ++generation.current;
    running.current = false;
    const initial = target();
    requested.current = initial;
    setState({ kind: "initializing", layer: initial.layer });
    const onCapture = (event: SemanticCaptureLifecycle) => {
      if (generation.current !== mountedGeneration || requested.current?.revision !== event.revision) return;
      if (event.state === "initializing") setState({ kind: "initializing", layer: requested.current.layer });
      else if (event.state === "ready") {
        confirmed.current = requested.current;
        setState({ kind: "ready", layer: requested.current.layer });
      }
      else publishError(requested.current, mountedGeneration, event.error);
    };
    const node = canvas.current;
    if (!node) return;
    const reportSessionError = (error: unknown) => {
      const active = requested.current;
      if (!active || generation.current !== mountedGeneration) return;
      if (error instanceof Error && error.name === "SemanticDeviceLostError") {
        const dead = renderer.current;
        renderer.current = undefined;
        running.current = false;
        dead?.dispose();
      }
      publishError(active, mountedGeneration, error);
    };
    const mounting = mountSemanticFieldSession(node, initial.model, initial.revision,
      reportSessionError, {}, onCapture);
    void settleThermalMount(mounting, (mounted) => {
        if (generation.current !== mountedGeneration) return mounted.dispose();
        renderer.current = mounted;
        if (requested.current?.epoch === initial.epoch) {
          confirmed.current = initial;
          setState({ kind: "ready", layer: initial.layer });
        } else pump(mountedGeneration);
    }, (error) => {
      const active = requested.current;
      if (active && generation.current === mountedGeneration) publishError(active, mountedGeneration, error);
    });
    return () => {
      if (generation.current === mountedGeneration) generation.current += 1;
      requested.current = undefined;
      confirmed.current = undefined;
      running.current = false;
      const mounted = renderer.current;
      renderer.current = undefined;
      mounted?.dispose();
    };
  }, [canvas, mountAttempt, sessionIdentity]);

  useEffect(() => {
    const active = requested.current;
    if (!active || (active.model === model && active.layer === layer)) return;
    request(generation.current);
  }, [layer, model]);

  return { state, retry: () => {
    if (renderer.current) request(generation.current);
    else {
      setState({ kind: "initializing", layer: latest.current.layer });
      setMountAttempt((attempt) => attempt + 1);
    }
  } };
}
