import * as THREE from "three";

import type { AssemblyVisualPart } from "./render-envelope";

export interface VisualPiece {
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
  const baseHeight = Math.max(2.4, part.height * 0.22);
  const bellHeight = part.height - baseHeight;
  const pieces: VisualPiece[] = [
    { geometry: cylinder(part.radius * 0.92, baseHeight), color: 0x303947, metalness: 0.7, position: [0, 0, -part.height / 2 + baseHeight / 2] },
    { geometry: cylinder(part.radius, bellHeight), color: 0x657184, metalness: 0.76, position: [0, 0, baseHeight / 2] },
    { geometry: cylinder(part.radius * 0.78, 1.1), color: 0x252d38, metalness: 0.82, position: [0, 0, part.height / 2 + 0.4] },
    { geometry: cylinder(part.shaftRadius, part.shaftHeight), color: 0xb8c0ca, metalness: 0.95, position: [0, 0, part.height / 2 + part.shaftHeight / 2] },
    { geometry: new THREE.TorusGeometry(part.radius * 0.72, 0.65, 8, 48), color: 0x161d26, metalness: 0.5, position: [0, 0, part.height / 2 + 0.95] },
  ];
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    pieces.push({
      geometry: new THREE.BoxGeometry(1.25, 4.6, 1.15),
      color: 0x1b232d,
      metalness: 0.25,
      position: [Math.cos(angle) * part.radius * 0.66, Math.sin(angle) * part.radius * 0.66, part.height / 2 + 1],
      rotation: [0, 0, angle],
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

export function geometryPieces(part: Exclude<AssemblyVisualPart, { kind: "model" }>): readonly VisualPiece[] {
  if (part.kind === "box") return [{ geometry: new THREE.BoxGeometry(...part.size) }];
  if (part.kind === "cylinder") return [{ geometry: cylinder(part.radius, part.height) }];
  if (part.kind === "guard") return [{
    geometry: new THREE.TorusGeometry(part.radius, part.tubeRadius, 12, 96),
    color: 0xc56b3f,
    metalness: 0,
    opacity: 0.3,
  }];
  if (part.kind === "motor") return motorPieces(part);
  return propellerPieces(part);
}
