import type { PartInteractionHandlers } from "./assembly-interactions";
import type { FieldRendererSession } from "./field-renderer";
import {
  mountSemanticFieldSession,
  type SemanticFieldRendererSession,
} from "./semantic-field-session";
import { replaySemanticSession, type SemanticSessionState } from "./semantic-session-state";
import type { ViewerRenderModel } from "./render-envelope";

interface SessionRef { current: FieldRendererSession | null }

export interface SemanticSessionMountOptions {
  readonly canvas: HTMLCanvasElement;
  readonly model: ViewerRenderModel;
  readonly revision: string;
  readonly sessionRef: SessionRef;
  readonly state: () => SemanticSessionState;
  readonly interactions: () => PartInteractionHandlers;
  readonly onAttempt: () => void;
  readonly onError: (error: unknown) => void;
}

export interface SemanticSessionMount {
  update(model: ViewerRenderModel, revision: string): void;
  dispose(): void;
}

export function createSemanticSessionMount(
  options: SemanticSessionMountOptions,
): SemanticSessionMount {
  let active = true;
  let pending = false;
  let session: SemanticFieldRendererSession | undefined;
  let latest = { model: options.model, revision: options.revision };
  let attempted = latest;
  const interactions: PartInteractionHandlers = {
    onSelect: (partId) => options.interactions().onSelect?.(partId),
    onMove: (partId, position) => options.interactions().onMove?.(partId, position),
    onDragState: (dragging, partId) => options.interactions().onDragState?.(dragging, partId),
  };
  const fail = (failed: SemanticFieldRendererSession, error: unknown) => {
    if (!active || session !== failed) return;
    session = undefined;
    if (options.sessionRef.current === failed) options.sessionRef.current = null;
    failed.dispose();
    options.onError(error);
  };
  const begin = () => {
    if (!active || pending || session) return;
    options.onAttempt();
    pending = true;
    attempted = latest;
    void mountSemanticFieldSession(
      options.canvas,
      attempted.model,
      attempted.revision,
      (error) => { if (active) options.onError(error); },
      interactions,
      undefined,
      () => Boolean(options.interactions().onSelect),
    ).then((mounted) => {
      pending = false;
      if (!active) {
        mounted.dispose();
        return;
      }
      session = mounted;
      options.sessionRef.current = mounted;
      try {
        if (latest.model !== attempted.model || latest.revision !== attempted.revision) {
          void Promise.resolve(mounted.updateModel(latest.model, latest.revision))
            .catch((error) => fail(mounted, error));
        }
        replaySemanticSession(mounted, options.state());
      } catch (error) {
        fail(mounted, error);
      }
    }).catch((error) => {
      pending = false;
      if (active) options.onError(error);
    });
  };
  begin();
  return {
    update(model, revision) {
      const retry = !pending && !session
        && (model !== attempted.model || revision !== attempted.revision);
      latest = { model, revision };
      if (session) {
        try {
          const mounted = session;
          void Promise.resolve(mounted.updateModel(model, revision))
            .catch((error) => fail(mounted, error));
        } catch (error) {
          fail(session, error);
        }
      }
      else if (retry) begin();
    },
    dispose() {
      if (!active) return;
      active = false;
      const mounted = session;
      session = undefined;
      if (mounted && options.sessionRef.current === mounted) options.sessionRef.current = null;
      mounted?.dispose();
    },
  };
}
