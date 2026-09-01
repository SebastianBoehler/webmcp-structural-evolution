import { useEffect, useRef } from "react";

import type { PartInteractionHandlers } from "./assembly-interactions";
import type { FieldRendererSession } from "./field-renderer";
import type { ViewerRenderModel } from "./render-envelope";
import type { SemanticSessionState } from "./semantic-session-state";
import {
  createSemanticSessionMount,
  type SemanticSessionMount,
} from "./semantic-session-mount";

interface CurrentRef<Value> { current: Value }

export interface UseSemanticSessionMountOptions {
  readonly enabled: boolean;
  readonly canvasRef: CurrentRef<HTMLCanvasElement | null>;
  readonly sessionRef: CurrentRef<FieldRendererSession | null>;
  readonly model: ViewerRenderModel | undefined;
  readonly revision: string;
  readonly stateRef: CurrentRef<SemanticSessionState>;
  readonly interactions: PartInteractionHandlers;
  readonly onAttempt: () => void;
  readonly onError: (error: unknown) => void;
}

export function useSemanticSessionMount(options: UseSemanticSessionMountOptions): void {
  const controllerRef = useRef<SemanticSessionMount | undefined>(undefined);
  const latestRef = useRef(options);
  latestRef.current = options;
  const active = options.enabled && Boolean(options.model);

  useEffect(() => {
    if (!active) return;
    const latest = latestRef.current;
    const canvas = latest.canvasRef.current;
    if (!canvas || !latest.model) return;
    const controller = createSemanticSessionMount({
      canvas, model: latest.model, revision: latest.revision,
      sessionRef: latest.sessionRef,
      state: () => latestRef.current.stateRef.current,
      interactions: () => latestRef.current.interactions,
      onAttempt: () => latestRef.current.onAttempt(),
      onError: (error) => latestRef.current.onError(error),
    });
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = undefined;
      controller.dispose();
    };
  }, [active]);

  useEffect(() => {
    if (active && options.model) {
      controllerRef.current?.update(options.model, options.revision);
    }
  }, [active, options.model, options.revision]);
}
