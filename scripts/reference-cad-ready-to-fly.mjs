import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const surface = (color, metalness = 0.05, roughness = 0.55) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness });
const black = surface(0x11161c, 0.72, 0.28);
const dark = surface(0x303842, 0.82, 0.24);
const silver = surface(0x8994a0, 0.92, 0.2);
const gold = surface(0xd8a93d, 0.72, 0.24);
const green = surface(0x0b553f, 0.12, 0.48);

function mesh(group, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(...position);
  item.rotation.set(...rotation);
  group.add(item);
  return item;
}

const box = (x, y, z) => new THREE.BoxGeometry(x, y, z, 2, 2, 2);
const cylinder = (radius, height, segments = 64) => new THREE.CylinderGeometry(radius, radius, height, segments);
const zCylinder = (group, radius, height, material, z, segments = 64) =>
  mesh(group, cylinder(radius, height, segments), material, [0, 0, z], [Math.PI / 2, 0, 0]);

function threadedFastener(name, radius, length, headRadius, headHeight) {
  const group = new THREE.Group();
  group.name = name;
  const finish = surface(0x737b83, 0.94, 0.18);
  zCylinder(group, radius * 0.82, length, finish, length / 2);
  const turns = Math.max(8, Math.round(length / (radius * 0.5)));
  const thread = new THREE.CatmullRomCurve3(Array.from({ length: turns * 12 + 1 }, (_, index) => {
    const progress = index / (turns * 12);
    const angle = progress * turns * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * radius * 0.94, Math.sin(angle) * radius * 0.94, progress * length);
  }));
  mesh(group, new THREE.TubeGeometry(thread, turns * 12, radius * 0.075, 6, false), finish);
  zCylinder(group, headRadius, headHeight, finish, -headHeight / 2);
  zCylinder(group, headRadius * 0.44, headHeight * 0.46, black, -headHeight * 0.72, 6);
  return group;
}

export const cameraFastener = () => {
  const group = threadedFastener("Accu_SSCF_M2_4_A4_BL", 0.001, 0.004, 0.0019, 0.002);
  group.rotation.x = -Math.PI / 2;
  return group;
};

export const stackBolt = () => threadedFastener("Accu_SSC_M3_25_12_9_Z", 0.0015, 0.025, 0.00284, 0.003);

function spacer(name, length) {
  const group = new THREE.Group();
  group.name = name;
  const sleeve = zCylinder(group, 0.0025, length, surface(0x2b3036, 0.04, 0.62), length / 2, 48);
  const bore = cylinder(0.0016, length + 0.0002, 48);
  bore.rotateX(Math.PI / 2);
  const boreMesh = new THREE.Mesh(bore, black);
  boreMesh.position.z = length / 2;
  sleeve.material.side = THREE.DoubleSide;
  group.add(boreMesh);
  return group;
}

export const stackSpacer6 = () => spacer("Harwin_R30_6700694", 0.006);
export const stackSpacer5 = () => spacer("Harwin_R30_6700594", 0.005);

export function stackLocknut() {
  const group = new THREE.Group();
  group.name = "NBK_SWUT_M3_titanium_locknut";
  zCylinder(group, 0.0032, 0.004, silver, 0.002, 6);
  zCylinder(group, 0.0015, 0.0042, black, 0.002, 48);
  zCylinder(group, 0.0021, 0.0008, surface(0x274d73, 0.05, 0.5), 0.0036, 48);
  return group;
}

export function videoTransmitter() {
  const group = new THREE.Group();
  group.name = "SpeedyBee_TX800_spec_model";
  mesh(group, new RoundedBoxGeometry(0.028, 0.028, 0.0016, 5, 0.0012), green);
  mesh(group, new RoundedBoxGeometry(0.026, 0.026, 0.0038, 5, 0.0008), dark, [0, 0, 0.0027]);
  for (let index = -5; index <= 5; index += 1) {
    mesh(group, box(0.0009, 0.023, 0.001), silver, [index * 0.0022, 0, 0.0051]);
  }
  for (const [x, y] of [[-0.010, -0.010], [0.010, -0.010], [0.010, 0.010], [-0.010, 0.010]]) {
    zCylinder(group, 0.0015, 0.0018, black, 0, 32).position.set(x, y, 0);
  }
  mesh(group, box(0.006, 0.004, 0.0025), silver, [-0.011, 0, 0.001]);
  zCylinder(group, 0.0022, 0.0032, gold, 0.0016, 48).position.x = -0.012;
  for (let index = 0; index < 7; index += 1) {
    mesh(group, box(0.002, 0.0012, 0.0007), index % 2 ? black : surface(0xd8d8cd),
      [-0.008 + index * 0.0026, 0.0105, 0.0012]);
  }
  return group;
}

export function videoAntenna() {
  const group = new THREE.Group();
  group.name = "Foxeer_PA1474_Lollipop_4_Plus_RHCP_MMCX";
  mesh(group, cylinder(0.0022, 0.007, 48), gold, [0.0035, 0, 0], [0, 0, Math.PI / 2]);
  mesh(group, cylinder(0.0014, 0.046, 32), surface(0x252a31, 0.05, 0.72), [0.029, 0, 0], [0, 0, Math.PI / 2]);
  mesh(group, new THREE.SphereGeometry(0.0055, 48, 32), surface(0x292d33, 0.05, 0.5), [0.0545, 0, 0]);
  mesh(group, new THREE.TorusGeometry(0.0031, 0.00042, 12, 48), surface(0xd9a945, 0.65, 0.25), [0.0545, 0, 0]);
  return group;
}

export function radioReceiver() {
  const group = new THREE.Group();
  group.name = "RadioMaster_RP1_V2_ELRS_2_4GHz";
  mesh(group, new RoundedBoxGeometry(0.013, 0.011, 0.0012, 4, 0.0007), green);
  mesh(group, box(0.006, 0.006, 0.0015), black, [0, 0, 0.00135]);
  mesh(group, box(0.003, 0.002, 0.0014), silver, [-0.0045, 0, 0.0014]);
  for (let index = 0; index < 4; index += 1) {
    mesh(group, box(0.0012, 0.0007, 0.00045), gold, [0.003 + index * 0.0015, -0.0047, 0.0008]);
  }
  mesh(group, cylinder(0.00055, 0.0645, 20), surface(0x20252b, 0.02, 0.75), [0.03875, 0, 0], [0, 0, Math.PI / 2]);
  mesh(group, cylinder(0.00055, 0.030, 20), surface(0x20252b, 0.02, 0.75), [0.071, 0, 0], [Math.PI / 2, 0, 0]);
  return group;
}
