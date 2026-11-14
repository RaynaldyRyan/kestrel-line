// Procedural canvas textures: concrete, wall panels, crates, hazard stripes and
// signs. Everything is drawn at load from a seeded generator, so the game ships
// no image files and fetches nothing.
import * as THREE from 'three';

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')];
}

function speckle(g, size, n, alpha, light, dark, rng) {
  for (let i = 0; i < n; i += 1) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    g.fillStyle = rng() < 0.5 ? light : dark;
    g.globalAlpha = alpha * rng();
    g.fillRect(x, y, 1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
  }
  g.globalAlpha = 1;
}

function texture(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeGroundTexture() {
  const [c, g] = canvas(256);
  g.fillStyle = '#8a8378';
  g.fillRect(0, 0, 256, 256);
  const rng = mulberry(11);
  speckle(g, 256, 5200, 0.16, '#a39a8b', '#6e675c', rng);
  g.strokeStyle = 'rgba(60, 54, 46, 0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
  }
  g.strokeStyle = 'rgba(240, 168, 48, 0.5)';
  g.lineWidth = 3;
  g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  return texture(c, 10);
}

export function makeWallTexture() {
  const [c, g] = canvas(256);
  g.fillStyle = '#9a917f';
  g.fillRect(0, 0, 256, 256);
  const rng = mulberry(23);
  speckle(g, 256, 2600, 0.12, '#b0a894', '#7d7565', rng);
  g.fillStyle = 'rgba(70, 64, 52, 0.8)';
  for (let i = 0; i < 4; i += 1) g.fillRect(i * 64, 0, 2, 256);
  g.fillStyle = 'rgba(50, 46, 38, 0.9)';
  g.fillRect(0, 200, 256, 6);
  g.fillStyle = 'rgba(45, 212, 191, 0.55)';
  g.fillRect(0, 52, 256, 3);
  return texture(c, 2);
}

export function makeCrateTexture() {
  const [c, g] = canvas(256);
  g.fillStyle = '#7a5c38';
  g.fillRect(0, 0, 256, 256);
  const rng = mulberry(37);
  for (let p = 0; p < 4; p += 1) {
    g.fillStyle = p % 2 ? '#83653f' : '#715631';
    g.fillRect(0, p * 64, 256, 64);
    g.strokeStyle = 'rgba(40, 26, 12, 0.7)';
    g.lineWidth = 2;
    g.strokeRect(0, p * 64, 256, 64);
    for (let i = 0; i < 26; i += 1) {
      g.strokeStyle = 'rgba(60, 40, 18, 0.35)';
      g.beginPath();
      const y = p * 64 + rng() * 64;
      g.moveTo(0, y);
      g.lineTo(256, y + (rng() - 0.5) * 8);
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(20, 14, 6, 0.75)';
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('HALCYON', 128, 120);
  g.font = 'bold 20px system-ui, sans-serif';
  g.fillText('DEPOT 09', 128, 150);
  return texture(c, 1);
}

export function makeHazardTexture() {
  const [c, g] = canvas(128);
  g.fillStyle = '#e8b23a';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1c1a16';
  for (let i = -4; i < 8; i += 1) {
    g.beginPath();
    g.moveTo(i * 32, 0);
    g.lineTo(i * 32 + 16, 0);
    g.lineTo(i * 32 + 16 + 128, 128);
    g.lineTo(i * 32 + 128, 128);
    g.closePath();
    g.fill();
  }
  return texture(c, 1);
}

export function makeSignTexture(text, sub) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#20242c';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#2dd4bf';
  g.lineWidth = 4;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#e9e6df';
  g.font = 'bold 52px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(text, 256, 62);
  g.fillStyle = '#2dd4bf';
  g.font = 'bold 24px system-ui, sans-serif';
  g.fillText(sub, 256, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
