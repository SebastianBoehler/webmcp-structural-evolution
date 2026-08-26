import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

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

const material = (color, metalness = 0.05, roughness = 0.55) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness });
const black = material(0x11161c, 0.75, 0.28);
const darkMetal = material(0x303842, 0.88, 0.22);
const aluminum = material(0x8994a0, 0.92, 0.2);
const copper = material(0xc86d32, 0.8, 0.3);
const gold = material(0xd8a93d, 0.72, 0.24);
const ceramic = material(0xd9dde2, 0.05, 0.42);
const greenPcb = material(0x0b553f, 0.15, 0.48);
const batteryBlack = material(0x17191d, 0.05, 0.72);

function mesh(group, geometry, surface, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, surface);
  item.position.set(...position);
  item.rotation.set(...rotation);
  group.add(item);
  return item;
}
const cylinder = (radius, height, segments = 64) => new THREE.CylinderGeometry(radius, radius, height, segments);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z, 2, 2, 2);

function motor() {
  const group = new THREE.Group();
  group.name = "Hobbywing_XRotor_2207_5SL_1780KV_spec_model";
  mesh(group, cylinder(0.0132, 0.0034), darkMetal, [0, 0, 0.0017], [Math.PI / 2, 0, 0]);
  mesh(group, cylinder(0.0114, 0.002), copper, [0, 0, 0.0042], [Math.PI / 2, 0, 0]);
  mesh(group, cylinder(0.014, 0.0128), black, [0, 0, 0.0114], [Math.PI / 2, 0, 0]);
  mesh(group, cylinder(0.0122, 0.0022), aluminum, [0, 0, 0.0189], [Math.PI / 2, 0, 0]);
  mesh(group, new THREE.TorusGeometry(0.0108, 0.0012, 16, 64), darkMetal, [0, 0, 0.0185]);
  mesh(group, cylinder(0.0025, 0.0121), aluminum, [0, 0, 0.0259], [Math.PI / 2, 0, 0]);
  mesh(group, cylinder(0.0042, 0.002), black, [0, 0, 0.0212], [Math.PI / 2, 0, 0]);
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6;
    mesh(group, box(0.0012, 0.0065, 0.001), aluminum,
      [Math.cos(angle) * 0.007, Math.sin(angle) * 0.007, 0.0198], [0, 0, angle]);
    mesh(group, new RoundedBoxGeometry(0.0024, 0.0012, 0.0058, 2, 0.00035), copper,
      [Math.cos(angle) * 0.0119, Math.sin(angle) * 0.0119, 0.009], [0, 0, angle]);
  }
  for (let index = 0; index < 6; index += 1) {
    const angle = index * Math.PI / 3;
    mesh(group, cylinder(0.00055, 0.0012, 24), aluminum,
      [Math.cos(angle) * 0.0088, Math.sin(angle) * 0.0088, 0.0203], [Math.PI / 2, 0, 0]);
  }
  for (const [x, y] of [[0.005657, 0.005657], [-0.005657, 0.005657], [-0.005657, -0.005657], [0.005657, -0.005657]]) {
    mesh(group, cylinder(0.0015, 0.0038, 32), material(0x050608), [x, y, 0.0018], [Math.PI / 2, 0, 0]);
  }
  [0xffd334, 0xe43b30, 0x1f232b].forEach((color, index) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.010 + index * 0.002, 0, 0.004),
      new THREE.Vector3(-0.011, -0.0004 + index * 0.0004, 0.0035),
      new THREE.Vector3(-0.012, -0.001 + index * 0.001, 0.001),
    ]);
    mesh(group, new THREE.TubeGeometry(curve, 32, 0.00065, 12, false), material(color, 0, 0.6));
  });
  return group;
}

function propeller() {
  const group = new THREE.Group();
  group.name = "HQProp_HQ5X4_3X3V2S_spec_model";
  const propMaterial = material(0x263f55, 0.05, 0.35);
  mesh(group, cylinder(0.0064, 0.0065), propMaterial, [0, 0, 0], [Math.PI / 2, 0, 0]);
  mesh(group, cylinder(0.0025, 0.007, 48), material(0x0a0c0f), [0, 0, 0], [Math.PI / 2, 0, 0]);
  const blade = new THREE.Shape();
  blade.moveTo(0.0045, -0.0045);
  blade.bezierCurveTo(0.019, -0.010, 0.046, -0.008, 0.062, -0.0018);
  blade.bezierCurveTo(0.052, 0.0045, 0.025, 0.0068, 0.0045, 0.0038);
  blade.closePath();
  const geometry = new THREE.ExtrudeGeometry(blade, {
    depth: 0.0012, bevelEnabled: true, bevelSegments: 3, steps: 2,
    bevelSize: 0.00045, bevelThickness: 0.00035, curveSegments: 36,
  });
  geometry.translate(0, 0, -0.0006);
  for (let index = 0; index < 3; index += 1) {
    const item = mesh(group, geometry.clone(), propMaterial, [0, 0, 0], [0.05, 0.12, index * Math.PI * 2 / 3]);
    item.name = `pitch_blade_${index + 1}`;
  }
  return group;
}

function electronicsStack() {
  const group = new THREE.Group();
  group.name = "SpeedyBee_F405_V4_BLS55A_stack_spec_model";
  const board = (z, x, y, color) => mesh(group, new RoundedBoxGeometry(x, y, 0.0016, 7, 0.0018), color, [0, 0, z]);
  board(0.0054, 0.0416, 0.0394, greenPcb);
  board(-0.0054, 0.0456, 0.044, material(0x123a34, 0.12, 0.5));
  for (const [x, y] of [[0.01525, 0.01525], [-0.01525, 0.01525], [-0.01525, -0.01525], [0.01525, -0.01525]]) {
    mesh(group, cylinder(0.0022, 0.0175, 32), material(0xc1c6c9, 0.85, 0.24), [x, y, 0], [Math.PI / 2, 0, 0]);
    mesh(group, cylinder(0.0032, 0.002, 32), black, [x, y, 0.0092], [Math.PI / 2, 0, 0]);
  }
  mesh(group, box(0.009, 0.009, 0.0019), black, [0, 0, 0.0072]);
  for (let side = -1; side <= 1; side += 2) for (let index = 0; index < 12; index += 1) {
    mesh(group, box(0.0014, 0.0005, 0.00045), gold,
      [side * (0.0052 + (index % 2) * 0.0003), -0.0048 + Math.floor(index / 2) * 0.0019, 0.0083]);
  }
  mesh(group, box(0.004, 0.004, 0.0015), material(0x65707c, 0.65, 0.3), [-0.010, 0.007, 0.007]);
  mesh(group, box(0.009, 0.0075, 0.003), aluminum, [0.0175, 0, 0.0065]);
  for (let row = 0; row < 2; row += 1) for (let column = 0; column < 6; column += 1) {
    mesh(group, box(0.0048, 0.0035, 0.0017), black,
      [-0.014 + column * 0.0056, -0.013 + row * 0.026, -0.0039]);
  }
  for (let index = 0; index < 6; index += 1) {
    mesh(group, cylinder(0.0014, 0.004, 24), material(0x2d3137, 0.35, 0.4),
      [-0.017 + index * 0.0068, 0.018, -0.002], [Math.PI / 2, 0, 0]);
  }
  for (let index = 0; index < 12; index += 1) {
    mesh(group, box(0.0026, 0.0012, 0.0008), material(0xc9b878, 0.65, 0.3),
      [-0.0165 + (index % 6) * 0.0066, index < 6 ? -0.017 : 0.017, 0.0067]);
  }
  for (const [x, y] of [[-0.013, -0.007], [-0.008, -0.007], [0.008, 0.008], [0.013, 0.008]]) {
    mesh(group, cylinder(0.00125, 0.0026, 32), material(0x24282e, 0.55, 0.3), [x, y, 0.0082], [Math.PI / 2, 0, 0]);
  }
  for (let index = 0; index < 14; index += 1) {
    mesh(group, box(0.0025, 0.0012, 0.00075), index % 3 === 0 ? ceramic : black,
      [-0.016 + (index % 7) * 0.0052, -0.010 + Math.floor(index / 7) * 0.020, 0.008]);
  }
  return group;
}

function battery() {
  const group = new THREE.Group();
  group.name = "Tattu_RLine_V5_1550mAh_6S_spec_model";
  mesh(group, new RoundedBoxGeometry(0.078, 0.037, 0.052, 10, 0.003), batteryBlack);
  for (let index = 1; index < 6; index += 1) {
    mesh(group, box(0.00035, 0.0365, 0.049), material(0x3c4149, 0, 0.65), [-0.039 + index * 0.013, 0, 0]);
  }
  mesh(group, box(0.052, 0.0008, 0.025), material(0xd9c329, 0.05, 0.55), [0, -0.019, 0]);
  mesh(group, box(0.060, 0.0009, 0.005), material(0xe6cd2a, 0.05, 0.46), [-0.003, -0.0192, 0.013]);
  mesh(group, box(0.026, 0.00095, 0.003), ceramic, [-0.014, -0.0193, 0.004]);
  mesh(group, box(0.012, 0.001, 0.0525), material(0x2a2d32, 0.05, 0.7), [0, 0, 0]);
  [0xd82929, 0x15181c].forEach((color, index) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.037, -0.009 + index * 0.018, 0.012),
      new THREE.Vector3(0.050, -0.012 + index * 0.024, 0.018),
      new THREE.Vector3(0.066, -0.011 + index * 0.022, 0.014),
    ]);
    mesh(group, new THREE.TubeGeometry(curve, 32, 0.0018, 14, false), material(color, 0, 0.55));
  });
  mesh(group, new RoundedBoxGeometry(0.014, 0.009, 0.008, 3, 0.0013), material(0xe4b323, 0.05, 0.45), [0.071, 0, 0.014]);
  mesh(group, cylinder(0.0022, 0.010, 24), material(0x202329), [0.071, -0.0025, 0.014], [Math.PI / 2, 0, 0]);
  mesh(group, cylinder(0.0022, 0.010, 24), material(0x202329), [0.071, 0.0025, 0.014], [Math.PI / 2, 0, 0]);
  return group;
}

function batteryStrap() {
  const group = new THREE.Group();
  group.name = "Sunderlabs_20mm_battery_retention_strap";
  const webbing = material(0x20242a, 0.02, 0.88);
  const stitch = material(0xd7dde3, 0.02, 0.68);
  mesh(group, new RoundedBoxGeometry(0.020, 0.043, 0.0015, 3, 0.00035), webbing, [0, 0, 0.0305]);
  mesh(group, new RoundedBoxGeometry(0.020, 0.043, 0.0015, 3, 0.00035), webbing, [0, 0, -0.02675]);
  mesh(group, new RoundedBoxGeometry(0.020, 0.0015, 0.05725, 3, 0.00035), webbing, [0, -0.0215, 0.001875]);
  mesh(group, new RoundedBoxGeometry(0.020, 0.0015, 0.05725, 3, 0.00035), webbing, [0, 0.0215, 0.001875]);
  mesh(group, new RoundedBoxGeometry(0.022, 0.010, 0.0034, 4, 0.0006), darkMetal, [0, -0.012, 0.03175]);
  for (const x of [-0.006, 0, 0.006]) mesh(group, box(0.00045, 0.038, 0.00025), stitch, [x, 0, 0.03135]);
  return group;
}

function batteryHarness() {
  const group = new THREE.Group();
  group.name = "XT60_12AWG_to_OpenESC_installed_harness";
  const start = new THREE.Vector3(0.027838, 0.005238, -0.014);
  const end = new THREE.Vector3(-0.027838, -0.005238, 0.014);
  [0xd82929, 0x15181c].forEach((color, index) => {
    const offset = (index - 0.5) * 0.0046;
    const curve = new THREE.CatmullRomCurve3([
      start.clone().add(new THREE.Vector3(0, offset, 0)),
      new THREE.Vector3(0.020, -0.005 + offset, -0.014),
      new THREE.Vector3(-0.006, -0.005 + offset, -0.014),
      new THREE.Vector3(-0.012, -0.005 + offset, 0.002),
      new THREE.Vector3(-0.020, -0.005 + offset, 0.008),
      end.clone().add(new THREE.Vector3(0, offset, -0.003165)),
    ]);
    mesh(group, new THREE.TubeGeometry(curve, 72, 0.0017, 14, false), material(color, 0, 0.52));
  });
  mesh(group, new RoundedBoxGeometry(0.014, 0.010, 0.009, 4, 0.0013), material(0xe4b323, 0.05, 0.45), [0.0215, 0.005238, -0.014]);
  mesh(group, new RoundedBoxGeometry(0.010, 0.008, 0.007, 4, 0.001), material(0x22262c, 0.04, 0.72), [-0.025, -0.005238, 0.014]);
  return group;
}

function motorHarness() {
  const group = new THREE.Group();
  group.name = "three_phase_20AWG_motor_to_ESC_harness";
  [0xe9c629, 0xd64935, 0x20252b].forEach((color, index) => {
    const y = (index - 1) * 0.0018;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.036, y, -0.001165),
      new THREE.Vector3(-0.018, y + (index - 1) * 0.0004, -0.0012),
      new THREE.Vector3(0.018, y - (index - 1) * 0.0004, -0.0032),
      new THREE.Vector3(0.036, y, -0.004),
    ]);
    mesh(group, new THREE.TubeGeometry(curve, 72, 0.00062, 14, false), material(color, 0, 0.58));
  });
  return group;
}

function fpvCamera() {
  const group = new THREE.Group();
  group.name = "RunCam_Phoenix_2_spec_model";
  mesh(group, new RoundedBoxGeometry(0.019, 0.020, 0.019, 8, 0.0018), black);
  mesh(group, cylinder(0.006, 0.012, 64), darkMetal, [0.015, 0, 0], [0, 0, Math.PI / 2]);
  mesh(group, cylinder(0.0048, 0.013, 64), material(0x1c2735, 0.25, 0.22), [0.017, 0, 0], [0, 0, Math.PI / 2]);
  mesh(group, cylinder(0.0022, 0.0135, 64), material(0x294e73, 0.05, 0.1), [0.024, 0, 0], [0, 0, Math.PI / 2]);
  for (const y of [-0.010, 0.010]) {
    mesh(group, cylinder(0.001, 0.002, 32), material(0x08090b), [0, y, 0]);
    for (const z of [-0.006, 0.006]) mesh(group, cylinder(0.0008, 0.0015, 24), aluminum, [-0.006, y * 0.96, z], [Math.PI / 2, 0, 0]);
  }
  return group;
}

function fastener() {
  const group = new THREE.Group();
  group.name = "Accu_SSCF_M3_8_DIN912_spec_model";
  const zinc = material(0x737b83, 0.94, 0.18);
  mesh(group, cylinder(0.00124, 0.008, 48), zinc, [0, 0, 0.004], [Math.PI / 2, 0, 0]);
  const turns = 16;
  const thread = new THREE.CatmullRomCurve3(Array.from({ length: turns * 16 + 1 }, (_, index) => {
    const progress = index / (turns * 16);
    const angle = progress * turns * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * 0.00142, Math.sin(angle) * 0.00142, progress * 0.008);
  }));
  mesh(group, new THREE.TubeGeometry(thread, turns * 16, 0.00011, 6, false), zinc);
  mesh(group, cylinder(0.00284, 0.003, 64), zinc, [0, 0, -0.0015], [Math.PI / 2, 0, 0]);
  mesh(group, cylinder(0.00125, 0.0013, 6), black, [0, 0, -0.00235], [Math.PI / 2, 0, 0]);
  return group;
}

async function save(name, scene) {
  scene.traverse((object) => {
    if (object.isMesh) {
      object.geometry.computeVertexNormals();
      object.castShadow = true;
    }
  });
  const output = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
  const outputDirectory = new URL("../public/reference-cad/", import.meta.url);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(new URL(name, outputDirectory), Buffer.from(output));
}

await Promise.all([
  save("hobbywing-xrotor-2207.glb", motor()),
  save("hqprop-5x4.3x3.glb", propeller()),
  save("speedybee-f405-v4-stack.glb", electronicsStack()),
  save("tattu-rline-v5-1550-6s.glb", battery()),
  save("sunderlabs-battery-strap-20mm.glb", batteryStrap()),
  save("xt60-openesc-battery-harness.glb", batteryHarness()),
  save("motor-to-esc-3x20awg.glb", motorHarness()),
  save("runcam-phoenix-2.glb", fpvCamera()),
  save("accu-m3x8-din912.glb", fastener()),
]);
