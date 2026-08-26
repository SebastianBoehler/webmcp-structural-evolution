import * as THREE from "three";

import type { AssemblyVisualPart } from "./render-envelope";

export interface VisualPiece {
  readonly id?: string;
  readonly geometry: THREE.BufferGeometry;
  readonly color?: number;
  readonly metalness?: number;
  readonly opacity?: number;
  readonly position?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
}

const cylinder = (radius: number, height: number, segments = 48) => {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
};

function motorPieces(part: Extract<AssemblyVisualPart, { kind: "motor" }>): readonly VisualPiece[] {
  const pieces: VisualPiece[] = [
    { id: "motor-base", geometry: cylinder(part.base.radius, part.base.height), color: 0x303947, metalness: 0.7, position: [0, 0, part.base.centerZ] },
    { id: "motor-stator", geometry: cylinder(part.stator.radius, part.stator.height), color: 0xb66b32, metalness: 0.42, position: [0, 0, part.stator.centerZ] },
    { id: "motor-bell", geometry: cylinder(part.bell.radius, part.bell.height), color: 0x657184, metalness: 0.76, opacity: 0.72, position: [0, 0, part.bell.centerZ] },
    { id: "motor-shaft", geometry: cylinder(part.shaft.radius, part.shaft.height), color: 0xb8c0ca, metalness: 0.95, position: [0, 0, part.shaft.centerZ] },
  ];
  part.mountHoles.forEach((hole, index) => {
    pieces.push({
      id: `motor-mount-hole-${index + 1}`,
      geometry: new THREE.TorusGeometry(hole.radius, Math.max(0.22, hole.radius * 0.18), 8, 24),
      color: 0x111820,
      metalness: 0.3,
      position: [hole.centerX, hole.centerY, 0.1],
    });
  });
  return pieces;
}

function fastenerPieces(part: Extract<AssemblyVisualPart, { kind: "fastener" }>): readonly VisualPiece[] {
  return [
    { id: "fastener-shank", geometry: cylinder(part.shank.radius, part.shank.height), color: 0x7b828b, metalness: 0.92, position: [0, 0, part.shank.centerZ] },
    { id: "fastener-head", geometry: cylinder(part.head.radius, part.head.height), color: 0x59616b, metalness: 0.92, position: [0, 0, part.head.centerZ] },
    { id: "fastener-socket", geometry: new THREE.BoxGeometry(part.socketWidth, part.socketWidth, part.socketDepth), color: 0x161a1f, position: [0, 0, part.socketCenterZ] },
  ];
}

function motorMountPieces(part: Extract<AssemblyVisualPart, { kind: "motor-mount" }>): readonly VisualPiece[] {
  const pieces: VisualPiece[] = [{
    geometry: cylinder(part.radius, part.height),
    color: 0x1688c9,
    metalness: 0.18,
  }];
  for (let index = 0; index < 4; index += 1) {
    const angle = Math.PI / 4 + index * Math.PI / 2;
    pieces.push({
      geometry: new THREE.TorusGeometry(part.boltRadius, 0.7, 8, 24),
      color: 0x0e4e72,
      metalness: 0.48,
      position: [
        Math.cos(angle) * part.boltCircle,
        Math.sin(angle) * part.boltCircle,
        part.height / 2 + 0.08,
      ],
    });
  }
  return pieces;
}

function bladeGeometry(radius: number, hubRadius: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(hubRadius * 0.65, -1.2);
  shape.bezierCurveTo(radius * 0.28, -5.8, radius * 0.72, -7.2, radius, -2.1);
  shape.bezierCurveTo(radius * 0.78, 1.2, radius * 0.38, 5.8, hubRadius * 0.65, 2.4);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSize: 0.45,
    bevelThickness: 0.35,
    curveSegments: 12,
    depth,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function propellerPieces(part: Extract<AssemblyVisualPart, { kind: "propeller" }>): readonly VisualPiece[] {
  const pieces: VisualPiece[] = [{
    geometry: cylinder(part.hubRadius, part.hubHeight),
    color: 0x202b37,
    metalness: 0.18,
    opacity: 0.92,
  }];
  for (let index = 0; index < part.bladeCount; index += 1) {
    pieces.push({
      geometry: bladeGeometry(part.radius, part.hubRadius, Math.max(1.2, part.hubHeight * 0.32)),
      color: 0x334f66,
      metalness: 0.08,
      opacity: 0.84,
      rotation: [0.08, -0.12, index * Math.PI * 2 / part.bladeCount],
    });
  }
  return pieces;
}

function flightControllerPieces(part: Extract<AssemblyVisualPart, { kind: "flight-controller" }>): readonly VisualPiece[] {
  const [width, height, depth] = part.size;
  const pieces: VisualPiece[] = [
    { geometry: new THREE.BoxGeometry(width, height, depth * 0.72), color: 0x252d36, metalness: 0.18 },
    { geometry: new THREE.BoxGeometry(width - 3, height - 3, 1.2), color: 0x244b42, position: [0, 0, depth * 0.38] },
    { geometry: new THREE.BoxGeometry(9, 9, 1.8), color: 0x151a20, metalness: 0.32, position: [0, 0, depth * 0.49] },
    { geometry: new THREE.BoxGeometry(7, 6, 2), color: 0x171c22, position: [-12, 6, depth * 0.49] },
    { geometry: new THREE.BoxGeometry(7, 6, 2), color: 0x171c22, position: [12, -6, depth * 0.49] },
  ];
  for (const side of [-1, 1]) {
    for (let index = -1; index <= 1; index += 1) {
      pieces.push({
        geometry: new THREE.BoxGeometry(4.8, 7.2, 4),
        color: 0xd6d9dc,
        metalness: 0.24,
        position: [side * (width / 2 - 2.2), index * 10, depth * 0.12],
      });
    }
  }
  return pieces;
}

export function geometryPieces(part: Exclude<AssemblyVisualPart, { kind: "model" | "mesh" }>): readonly VisualPiece[] {
  if (part.kind === "box") return [{ geometry: new THREE.BoxGeometry(...part.size) }];
  if (part.kind === "cylinder") return [{ geometry: cylinder(part.radius, part.height) }];
  if (part.kind === "motor-mount") return motorMountPieces(part);
  if (part.kind === "guard") return [{
    geometry: new THREE.TorusGeometry(part.radius, part.tubeRadius, 12, 96),
    color: 0xc56b3f,
    metalness: 0,
    opacity: 0.3,
  }];
  if (part.kind === "protected-disc") return [{
    id: "filled-protected-swept-volume",
    geometry: cylinder(part.radius, part.height, 96),
    color: 0xc56b3f,
    metalness: 0,
    opacity: 0.1,
  }];
  if (part.kind === "motor") return motorPieces(part);
  if (part.kind === "fastener") return fastenerPieces(part);
  if (part.kind === "flight-controller") return flightControllerPieces(part);
  if (part.kind === "load-vector") return [
    { geometry: cylinder(1.2, part.length * 0.68), color: 0xe04d3f, position: [0, 0, -part.length * 0.34] },
    { geometry: new THREE.ConeGeometry(3.2, part.length * 0.32, 32).rotateX(Math.PI / 2), color: 0xe04d3f, position: [0, 0, -part.length * 0.84] },
  ];
  return propellerPieces(part);
}
