import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader = class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    }, this.onerror);
  }
};

const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x16212c,
  metalness: 0.72,
  roughness: 0.38,
});
const edgeMaterial = new THREE.MeshStandardMaterial({
  color: 0x566372,
  metalness: 0.82,
  roughness: 0.28,
});
const lensMaterial = new THREE.MeshStandardMaterial({
  color: 0x73e8ef,
  emissive: 0x2bbfc9,
  emissiveIntensity: 1.8,
  metalness: 0.18,
  roughness: 0.12,
});
const darkLensMaterial = new THREE.MeshStandardMaterial({
  color: 0x071015,
  metalness: 0.48,
  roughness: 0.16,
});

const scene = new THREE.Scene();
scene.name = 'Agent OS low-poly CCTV camera';

function add(geometry, material, { name, position, rotation } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name || 'camera-part';
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// Camera body, angled sun shield, and rear electronics block.
add(new THREE.BoxGeometry(0.9, 0.62, 1.35), bodyMaterial, {
  name: 'camera-body',
  position: [0, 1.55, 0],
});
add(new THREE.BoxGeometry(1.08, 0.1, 1.62), edgeMaterial, {
  name: 'sun-shield',
  position: [0, 1.91, 0.08],
  rotation: [-0.035, 0, 0],
});
add(new THREE.BoxGeometry(0.72, 0.48, 0.24), edgeMaterial, {
  name: 'rear-cap',
  position: [0, 1.55, -0.79],
});

// An octagonal hood and emissive lens keep the silhouette legible at night.
add(new THREE.CylinderGeometry(0.34, 0.41, 0.5, 8, 1, false), bodyMaterial, {
  name: 'lens-hood',
  position: [0, 1.55, 0.9],
  rotation: [Math.PI / 2, 0, 0],
});
add(new THREE.CylinderGeometry(0.265, 0.265, 0.08, 12), lensMaterial, {
  name: 'cyan-lens-ring',
  position: [0, 1.55, 1.17],
  rotation: [Math.PI / 2, 0, 0],
});
add(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 12), darkLensMaterial, {
  name: 'lens-glass',
  position: [0, 1.55, 1.22],
  rotation: [Math.PI / 2, 0, 0],
});

// Low-poly yoke and wall/pole mount.
add(new THREE.CylinderGeometry(0.13, 0.13, 1.05, 8), edgeMaterial, {
  name: 'mount-stem',
  position: [0, 0.75, -0.25],
});
add(new THREE.BoxGeometry(0.56, 0.16, 0.56), edgeMaterial, {
  name: 'mount-base',
  position: [0, 0.18, -0.25],
});
add(new THREE.BoxGeometry(0.12, 0.65, 0.18), edgeMaterial, {
  name: 'left-yoke',
  position: [-0.5, 1.25, -0.08],
  rotation: [0.18, 0, 0],
});
add(new THREE.BoxGeometry(0.12, 0.65, 0.18), edgeMaterial, {
  name: 'right-yoke',
  position: [0.5, 1.25, -0.08],
  rotation: [0.18, 0, 0],
});
add(new THREE.CylinderGeometry(0.16, 0.16, 1.12, 8), edgeMaterial, {
  name: 'tilt-axle',
  position: [0, 1.42, -0.08],
  rotation: [0, 0, Math.PI / 2],
});

const exporter = new GLTFExporter();
const result = await exporter.parseAsync(scene, {
  binary: true,
  trs: true,
  onlyVisible: true,
});
const output = fileURLToPath(
  new URL('../public/models/agent-os-low-poly-camera.glb', import.meta.url),
);
await writeFile(output, Buffer.from(result));
console.log(`Wrote ${output} (${result.byteLength} bytes)`);
