import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const require = createRequire(import.meta.url);
const occtFactory = require("occt-import-js");

globalThis.FileReader = class {
  result = null;
  onload = null;
  onloadend = null;
  onerror = null;
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }).catch((error) => this.onerror?.(error));
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type};base64,${Buffer.from(value).toString("base64")}`;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }).catch((error) => this.onerror?.(error));
  }
};

const sources = [
  {
    name: "OpenFC-Lite rev3.3",
    output: "opendrone-openfc-lite-rev3.3.glb",
    url: "https://github.com/OpenDrone-hw/OpenFC-Lite/releases/download/rev3.3/OpenFC-Lite-rev3.3.step",
    sha256: "ac8cb93a42d54cff67e15b6442b4eb74c003015a06e943cb0222cc981303669d",
    repository: "https://github.com/OpenDrone-hw/OpenFC-Lite/tree/rev3.3",
    expectedSizeMm: [37.942302, 37.942302, 5.38],
  },
  {
    name: "OpenESC-30x30 rev3.3",
    output: "opendrone-openesc-30x30-rev3.3.glb",
    url: "https://github.com/OpenDrone-hw/OpenESC-30x30/releases/download/rev3.3/OpenESC-30x30-rev3.3.step",
    sha256: "dadded39478f0c7525d3b89722fa7fa57fb794cea374832f197d407bee34e6e3",
    repository: "https://github.com/OpenDrone-hw/OpenESC-30x30/tree/rev3.3",
    expectedSizeMm: [41.62706, 42.504999, 6.33],
  },
];

const roundedColor = (color) => (color?.length === 3 ? color : [0.34, 0.38, 0.42])
  .map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255));
const materialKey = (color) => roundedColor(color).join("-");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function download(source) {
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`${source.name} download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const digest = sha256(buffer);
  if (digest !== source.sha256) throw new Error(`${source.name} checksum mismatch: ${digest}`);
  return buffer;
}

function geometryFrom(raw) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(raw.attributes.position.array, 3));
  if (raw.attributes.normal?.array?.length === raw.attributes.position.array.length) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(raw.attributes.normal.array, 3));
  }
  geometry.setIndex(raw.index.array);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  return geometry;
}

function boundsFor(meshes) {
  const bounds = new THREE.Box3();
  for (const raw of meshes) {
    const positions = raw.attributes.position.array;
    for (let index = 0; index < positions.length; index += 3) {
      bounds.expandByPoint(new THREE.Vector3(positions[index], positions[index + 1], positions[index + 2]));
    }
  }
  return bounds;
}

function closeEnough(actual, expected) {
  return actual.every((value, axis) => Math.abs(value - expected[axis]) <= 0.05);
}

async function convert(occt, source, bytes) {
  const result = occt.ReadStepFile(bytes, {
    linearUnit: "millimeter",
    linearDeflectionType: "absolute_value",
    linearDeflection: 0.08,
    angularDeflection: 0.22,
  });
  if (!result.success || !result.meshes?.length) throw new Error(`${source.name} STEP import failed`);

  const bounds = boundsFor(result.meshes);
  const size = bounds.getSize(new THREE.Vector3()).toArray();
  if (!closeEnough(size, source.expectedSizeMm)) {
    throw new Error(`${source.name} size mismatch: ${size.join(" x ")} mm`);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const byMaterial = new Map();
  for (const raw of result.meshes) {
    const key = materialKey(raw.color);
    const geometry = geometryFrom(raw);
    geometry.translate(-center.x, -center.y, -center.z);
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), geometry]);
  }

  const scene = new THREE.Group();
  scene.name = source.name.replaceAll(" ", "_");
  scene.userData = {
    sourceStep: source.url,
    sourceRepository: source.repository,
    sourceSha256: source.sha256,
    sourceUnits: "mm",
    sourceLicense: "CERN-OHL-S-2.0",
    processing: "OpenCascade tessellation; recentered only; 0.08 mm linear deflection",
  };
  for (const [key, geometries] of byMaterial) {
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) throw new Error(`${source.name} could not merge ${key}`);
    for (const item of geometries) item.dispose();
    const [red, green, blue] = key.split("-").map(Number);
    const color = new THREE.Color(red / 255, green / 255, blue / 255);
    const dark = color.r + color.g + color.b < 0.55;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color,
      metalness: dark ? 0.28 : 0.12,
      roughness: dark ? 0.38 : 0.5,
    }));
    mesh.name = `${scene.name}_${key}`;
    scene.add(mesh);
  }
  const triangleCount = result.meshes.reduce((total, mesh) => total + mesh.index.array.length / 3, 0);
  scene.userData.triangleCount = triangleCount;
  scene.userData.sourceMeshCount = result.meshes.length;
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
  const outputDirectory = new URL("../public/reference-cad/", import.meta.url);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(new URL(source.output, outputDirectory), Buffer.from(glb));
  return { output: source.output, sizeMm: size, triangleCount, materials: byMaterial.size };
}

const occt = await occtFactory();
for (const source of sources) {
  const bytes = await download(source);
  console.log(await convert(occt, source, bytes));
}
