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

const metal = new THREE.MeshStandardMaterial({
  color: 0x4f696d,
  metalness: 0.72,
  roughness: 0.46,
});
const accent = new THREE.MeshStandardMaterial({
  color: 0x78e7ec,
  emissive: 0x238f96,
  emissiveIntensity: 0.5,
  metalness: 0.38,
  roughness: 0.35,
});
const scene = new THREE.Scene();
scene.name = 'Agent OS camera support pole';

function add(geometry, material, name, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

add(
  new THREE.CylinderGeometry(0.12, 0.15, 2.9, 8),
  metal,
  'pole',
  [0, 1.45, 0],
);
add(
  new THREE.CylinderGeometry(0.24, 0.28, 0.12, 8),
  metal,
  'foot',
  [0, 0.06, 0],
);
add(
  new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10),
  accent,
  'locator-collar',
  [0, 2.78, 0],
);

const exporter = new GLTFExporter();
const result = await exporter.parseAsync(scene, {
  binary: true,
  trs: true,
  onlyVisible: true,
});
const output = fileURLToPath(
  new URL('../public/models/agent-os-camera-pole.glb', import.meta.url),
);
await writeFile(output, Buffer.from(result));
console.log(`Wrote ${output} (${result.byteLength} bytes)`);
