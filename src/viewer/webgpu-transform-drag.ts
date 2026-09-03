import type * as THREE from "three";

export type TransformSpace = "world" | "local";
export type TransformAxis = "x" | "y" | "z";

interface TransformDragOptions {
  readonly orbitEnabled: () => boolean;
  readonly setOrbitEnabled: (enabled: boolean) => void;
  readonly onMove: (
    semanticId: string,
    position: readonly [number, number, number],
  ) => unknown;
  readonly onPreview: () => void;
  readonly onMoveError: (error: unknown) => void;
  readonly onDragState: (dragging: boolean, semanticId: string) => void;
}

interface ActiveDrag {
  readonly semanticId: string;
  readonly object: THREE.Object3D;
  readonly axisOrigin: THREE.Vector3;
  readonly axisDirection: THREE.Vector3;
  readonly startParameter: number;
  readonly startPosition: THREE.Vector3;
  readonly orbitWasEnabled: boolean;
  finalPosition?: THREE.Vector3;
}

export interface WebGpuTransformDrag {
  setOptions(space: TransformSpace, snap: number | null): void;
  begin(
    semanticId: string,
    object: THREE.Object3D,
    axis: TransformAxis,
    ray: THREE.Ray,
  ): boolean;
  move(ray: THREE.Ray): void;
  end(): void;
  dispose(): void;
}

function axisParameter(
  ray: THREE.Ray,
  origin: THREE.Vector3,
  axis: THREE.Vector3,
): number | undefined {
  const direction = ray.direction.clone().normalize();
  const offset = origin.clone().sub(ray.origin);
  const parallel = axis.dot(direction);
  const denominator = 1 - parallel * parallel;
  if (Math.abs(denominator) < 1e-12) return undefined;
  return (parallel * direction.dot(offset) - axis.dot(offset)) / denominator;
}

function snapValue(value: number, snap: number): number {
  return Math.round(value / snap) * snap;
}

function setWorldPosition(object: THREE.Object3D, position: THREE.Vector3): void {
  const localPosition = position.clone();
  object.parent?.worldToLocal(localPosition);
  object.position.copy(localPosition);
  object.updateMatrixWorld(true);
}

export function createWebGpuTransformDrag(
  options: TransformDragOptions,
): WebGpuTransformDrag {
  let space: TransformSpace = "world";
  let snap: number | null = null;
  let active: ActiveDrag | undefined;
  let disposed = false;

  const end = () => {
    if (!active) return;
    const completed = active;
    active = undefined;
    options.setOrbitEnabled(completed.orbitWasEnabled);
    if (completed.finalPosition) {
      const position = completed.finalPosition;
      const reject = (error: unknown) => {
        try {
          setWorldPosition(completed.object, completed.startPosition);
          options.onPreview();
        } catch (rollbackError) {
          options.onMoveError(rollbackError);
        }
        options.onMoveError(error);
      };
      try {
        void Promise.resolve(options.onMove(completed.semanticId, [position.x, position.y, position.z]))
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    }
    options.onDragState(false, completed.semanticId);
  };

  return {
    setOptions(nextSpace, nextSnap) {
      if (nextSnap !== null && (!Number.isFinite(nextSnap) || nextSnap <= 0)) {
        throw new RangeError("transform snap must be a positive finite distance");
      }
      space = nextSpace;
      snap = nextSnap;
    },
    begin(semanticId, object, axis, ray) {
      if (disposed || active) return false;
      object.updateWorldMatrix(true, false);
      const startPosition = object.getWorldPosition(object.position.clone());
      const worldRotation = object.getWorldQuaternion(object.quaternion.clone());
      const axisDirection = object.position.clone().set(
        axis === "x" ? 1 : 0,
        axis === "y" ? 1 : 0,
        axis === "z" ? 1 : 0,
      );
      if (space === "local") axisDirection.applyQuaternion(worldRotation);
      axisDirection.normalize();
      const startParameter = axisParameter(ray, startPosition, axisDirection);
      if (startParameter === undefined) return false;
      const orbitWasEnabled = options.orbitEnabled();
      active = {
        semanticId,
        object,
        axisOrigin: startPosition,
        axisDirection,
        startParameter,
        startPosition,
        orbitWasEnabled,
      };
      options.setOrbitEnabled(false);
      options.onDragState(true, semanticId);
      return true;
    },
    move(ray) {
      if (!active || disposed) return;
      const parameter = axisParameter(ray, active.axisOrigin, active.axisDirection);
      if (parameter === undefined) return;
      let displacement = parameter - active.startParameter;
      if (snap !== null) displacement = snapValue(displacement, snap);
      const position = active.startPosition.clone()
        .addScaledVector(active.axisDirection, displacement);
      setWorldPosition(active.object, position);
      active.finalPosition = position;
      options.onPreview();
    },
    end,
    dispose() {
      if (disposed) return;
      end();
      disposed = true;
    },
  };
}
