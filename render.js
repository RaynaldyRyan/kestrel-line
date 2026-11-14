// The three.js scene, built from the sim's own data: map boxes become meshes,
// actors become figures, shots become tracers. The sim never touches three.js;
// this module reads state once a frame and turns it into a picture. Pools for
// tracers and explosions mean the hot loop allocates nothing.
import * as THREE from 'three';
import { BOXES, SITE } from './map.js';
import { eyeHeight } from './physics.js';
import { makeGroundTexture, makeWallTexture, makeCrateTexture, makeHazardTexture, makeSignTexture } from './textures.js';

const TEAM_COLOR = [0x2dd4bf, 0xe0653a];
const TEAM_DARK = [0x14302c, 0x33190f];

export function createRender(container, options) {
  const lowQuality = !!(options && options.lowQuality);
  const renderer = new THREE.WebGLRenderer({ antialias: !lowQuality, powerPreference: 'high-performance' });
  renderer.setPixelRatio(lowQuality ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !lowQuality;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x232b3d);
  scene.fog = new THREE.Fog(0x232b3d, 34, 95);
  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0x93a7cc, 0x3a332a, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.9);
  sun.position.set(28, 42, 18);
  sun.castShadow = !lowQuality;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const siteLight = new THREE.PointLight(0x2dd4bf, 12, 12, 1.8);
  siteLight.position.set(SITE.x, 3, SITE.z);
  scene.add(siteLight);

  // Ground.
  const groundMat = new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(66, 46), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Map boxes, one shared unit box scaled per entry.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: makeWallTexture(), roughness: 0.9 });
  const crateMat = new THREE.MeshStandardMaterial({ map: makeCrateTexture(), roughness: 0.85 });
  const lowMat = new THREE.MeshStandardMaterial({ map: makeHazardTexture(), roughness: 0.8 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.65, roughness: 0.45 });
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x4a6b63, metalness: 0.4, roughness: 0.5 });
  const matFor = { wall: wallMat, crate: crateMat, tall: crateMat, low: lowMat, barrel: metalMat, tank: tankMat };
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 14);
  for (const b of BOXES) {
    let mesh;
    if (b.k === 'barrel') {
      mesh = new THREE.Mesh(barrelGeo, metalMat);
      mesh.position.set(b.x, 0.55, b.z);
    } else {
      mesh = new THREE.Mesh(unitBox, matFor[b.k] || wallMat);
      mesh.scale.set(b.w, b.h, b.d);
      mesh.position.set(b.x, b.h / 2, b.z);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Site A marker: a glowing ring, a light pillar, and a sign on the front wall.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(SITE.r - 0.7, SITE.r, 48),
    new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SITE.x, 0.03, SITE.z);
  scene.add(ring);
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 14, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  );
  pillar.position.set(SITE.x, 7, SITE.z);
  scene.add(pillar);
  function addSign(text, sub, x, y, z, yaw, w) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / 4),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(text, sub) }),
    );
    sign.position.set(x, y, z);
    sign.rotation.y = yaw;
    scene.add(sign);
  }
  addSign('SITE A', 'HALCYON DEPOT', 0, 2.6, -9.4, 0, 4.5);
  addSign('FOUNDRY', 'WEST LANE', -10.6, 2.4, 12, Math.PI / 2, 3.5);
  addSign('SILO WALK', 'EAST LANE', 10.6, 2.4, 12, -Math.PI / 2, 3.5);
  addSign('MID', 'CENTRAL LANE', -3.4, 2.4, -9.4, 0, 2.5);

  // Distant silhouettes outside the walls, so the horizon is not empty fog.
  const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0x1a2130 });
  const silhouetteSpots = [[-40, -14, 10, 18], [-24, -30, 14, 24], [8, -32, 12, 16], [30, -28, 10, 20], [42, 4, 12, 14], [-42, 12, 10, 16], [24, 30, 14, 12], [-14, 32, 10, 18]];
  for (const [x, z, w, h] of silhouetteSpots) {
    const block = new THREE.Mesh(unitBox, silhouetteMat);
    block.scale.set(w, h, 8);
    block.position.set(x, h / 2 - 1, z);
    scene.add(block);
  }

  // Actor figures: legs, torso with a team stripe, head with a visor, and a gun.
  const figureGeo = {
    legs: new THREE.BoxGeometry(0.34, 0.7, 0.22),
    torso: new THREE.BoxGeometry(0.52, 0.62, 0.3),
    head: new THREE.BoxGeometry(0.3, 0.28, 0.3),
    visor: new THREE.BoxGeometry(0.32, 0.08, 0.05),
    gun: new THREE.BoxGeometry(0.09, 0.13, 0.75),
    stripe: new THREE.BoxGeometry(0.54, 0.1, 0.32),
    flash: new THREE.BoxGeometry(0.56, 0.66, 0.34),
  };
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x8a6f56, roughness: 0.7 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x17181c, metalness: 0.5, roughness: 0.5 });
  const figures = new Map();

  function figureFor(actor) {
    let f = figures.get(actor.id);
    if (f) return f;
    const group = new THREE.Group();
    const torsoMat = new THREE.MeshStandardMaterial({ color: TEAM_DARK[actor.team], roughness: 0.8 });
    const legs = new THREE.Mesh(figureGeo.legs, darkMat);
    legs.position.y = 0.35;
    const torso = new THREE.Mesh(figureGeo.torso, torsoMat);
    torso.position.y = 1.03;
    const head = new THREE.Mesh(figureGeo.head, skinMat);
    head.position.y = 1.55;
    const visor = new THREE.Mesh(
      figureGeo.visor,
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[actor.team] }),
    );
    visor.position.set(0, 1.56, -0.15);
    const gun = new THREE.Mesh(figureGeo.gun, gunMat);
    gun.position.set(0.22, 1.22, -0.3);
    const stripe = new THREE.Mesh(
      figureGeo.stripe,
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[actor.team] }),
    );
    stripe.position.y = 1.24;
    const flash = new THREE.Mesh(
      figureGeo.flash,
      new THREE.MeshBasicMaterial({ color: 0xff2a1e, transparent: true, opacity: 0 }),
    );
    flash.position.y = 1.03;
    group.add(legs, torso, head, visor, gun, stripe, flash);
    group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    scene.add(group);
    f = { group, flash, fall: 0 };
    figures.set(actor.id, f);
    return f;
  }

  // Viewmodel: a low-poly gun riding the camera, with recoil and walk bob.
  const viewmodel = new THREE.Group();
  const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), gunMat);
  const vmBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 8), gunMat);
  vmBarrel.rotation.x = Math.PI / 2;
  vmBarrel.position.set(0, 0.02, -0.42);
  const vmMag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1), darkMat);
  vmMag.position.set(0, -0.13, -0.05);
  const vmSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), darkMat);
  vmSight.position.set(0, 0.1, -0.08);
  const vmGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.08), darkMat);
  vmGrip.position.set(0, -0.11, 0.18);
  vmGrip.rotation.x = 0.35;
  const flashCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.3, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0.95 }),
  );
  flashCone.rotation.x = -Math.PI / 2;
  flashCone.position.set(0, 0.02, -0.68);
  flashCone.visible = false;
  const flashLight = new THREE.PointLight(0xffc266, 0, 9, 1.6);
  flashLight.position.set(0, 0.1, -0.7);
  viewmodel.add(vmBody, vmBarrel, vmMag, vmSight, vmGrip, flashCone, flashLight);
  viewmodel.position.set(0.2, -0.22, -0.42);
  viewmodel.rotation.y = 0.1;
  viewmodel.scale.setScalar(0.85);
  camera.add(viewmodel);

  // Tracer pool: lines that live 70 ms.
  const tracers = [];
  for (let i = 0; i < 24; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerAt = 0;

  // Explosion pool: an expanding shell plus a light.
  const booms = [];
  for (let i = 0; i < 2; i += 1) {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff9a3d, transparent: true, opacity: 0, depthWrite: false }),
    );
    const light = new THREE.PointLight(0xff9a3d, 0, 16, 1.6);
    shell.add(light);
    shell.visible = false;
    scene.add(shell);
    booms.push({ shell, light, life: 0 });
  }

  // Grenade meshes, keyed by their index in state.grenades.
  const grenadeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3d5a34, emissive: 0x1a2a12, metalness: 0.3, roughness: 0.6 });
  const grenadeMeshes = [];
  // The demolition charge, shown when dropped or planted.
  const bombGroup = new THREE.Group();
  const bombBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), gunMat);
  bombBox.position.y = 0.1;
  const bombLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2211 }),
  );
  bombLamp.position.set(0.1, 0.23, 0);
  bombGroup.add(bombBox, bombLamp);
  bombGroup.visible = false;
  scene.add(bombGroup);

  let bobPhase = 0;
  let kick = 0;
  let fov = 74;
  const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  function addTracer(from, to) {
    const t = tracers[tracerAt];
    tracerAt = (tracerAt + 1) % tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from[0], from[1], from[2]);
    pos.setXYZ(1, to[0], to[1], to[2]);
    pos.needsUpdate = true;
    t.life = 0.07;
    t.line.visible = true;
    t.line.material.opacity = 0.9;
  }

  function explosion(x, y, z) {
    const b = booms.find((o) => o.life <= 0) || booms[0];
    b.shell.position.set(x, y, z);
    b.shell.visible = true;
    b.life = 0.45;
  }

  function sync(state, dt, view) {
    const subject = view.subject;
    // Camera follows the subject's eyes; shake decays each frame.
    const shake = view.shake;
    const sx = shake > 0 ? (Math.random() * 2 - 1) * shake * 0.02 : 0;
    const sy = shake > 0 ? (Math.random() * 2 - 1) * shake * 0.02 : 0;
    camera.position.set(subject.x, subject.y + eyeHeight(subject), subject.z);
    tmpEuler.set(subject.pitch + sy, subject.yaw + sx, 0);
    camera.quaternion.setFromEuler(tmpEuler);
    const wantFov = view.aiming ? 48 : 74;
    if (Math.abs(fov - wantFov) > 0.1) {
      fov += (wantFov - fov) * Math.min(1, dt * 12);
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // Viewmodel: bob with the walk, kick with the shot.
    kick = Math.max(0, kick - dt * 6);
    if (subject.isPlayer && subject.alive) {
      const speed = Math.hypot(subject.vx, subject.vz);
      bobPhase += dt * speed * 1.6;
      viewmodel.visible = true;
      viewmodel.position.set(
        (view.aiming ? 0 : 0.2) + Math.sin(bobPhase) * 0.006 * Math.min(1, speed / 5),
        -0.22 + Math.abs(Math.sin(bobPhase)) * 0.012 * Math.min(1, speed / 5),
        -0.42 + kick * 0.09,
      );
      viewmodel.rotation.x = kick * 0.35;
      viewmodel.rotation.y = view.aiming ? 0 : 0.1;
    } else {
      viewmodel.visible = false;
    }
    if (flashCone.visible && view.time - view.flashT > 0.05) {
      flashCone.visible = false;
      flashLight.intensity = 0;
    }
    // Actors.
    for (const a of state.actors) {
      if (a.isPlayer) continue;
      const f = figureFor(a);
      f.group.position.set(a.x, a.y, a.z);
      f.group.rotation.y = a.yaw;
      if (a.alive) {
        f.group.scale.y = a.crouch ? 0.72 : 1;
        f.group.rotation.x = 0;
        f.fall = 0;
        f.flash.material.opacity = a.flash * 0.55;
      } else {
        f.fall = Math.min(1, f.fall + dt * 3);
        f.group.rotation.x = -Math.PI / 2 * f.fall;
        f.group.position.y = a.y + 0.25 * f.fall - Math.max(0, a.deadT - 4) * 0.15;
        f.flash.material.opacity = 0;
      }
    }
    // Tracers fade out.
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    // Explosions expand and fade.
    for (const b of booms) {
      if (b.life > 0) {
        b.life -= dt;
        const p = 1 - Math.max(0, b.life) / 0.45;
        const s = 0.5 + p * 5;
        b.shell.scale.set(s, s, s);
        b.shell.material.opacity = (1 - p) * 0.7;
        b.light.intensity = (1 - p) * 120;
        if (b.life <= 0) b.shell.visible = false;
      }
    }
    // Grenades.
    while (grenadeMeshes.length < state.grenades.length) {
      const m = new THREE.Mesh(grenadeGeo, grenadeMat);
      scene.add(m);
      grenadeMeshes.push(m);
    }
    state.grenades.forEach((g, i) => {
      grenadeMeshes[i].visible = true;
      grenadeMeshes[i].position.set(g.x, g.y, g.z);
    });
    for (let i = state.grenades.length; i < grenadeMeshes.length; i += 1) grenadeMeshes[i].visible = false;
    // Bomb.
    if (state.bomb.mode === 'dropped' || state.bomb.mode === 'planted') {
      bombGroup.visible = true;
      bombGroup.position.set(state.bomb.x, 0, state.bomb.z);
      const blink = state.bomb.mode === 'planted' ? (Math.sin(view.time * 9) > 0 ? 1 : 0.15) : 0.6;
      bombLamp.material.color.setRGB(1, 0.13 * blink, 0.07 * blink);
    } else {
      bombGroup.visible = false;
    }
    // Site ring pulses while the charge is planted.
    const pulse = state.bomb.mode === 'planted' ? 0.55 + Math.sin(view.time * 6) * 0.35 : 0.75;
    ring.material.opacity = pulse;
    renderer.render(scene, camera);
  }

  function muzzle() {
    flashCone.visible = true;
    flashLight.intensity = 14;
    kick = 1;
  }

  // Hide every transient effect (tracers, explosions): used before a staged
  // frame so only the effects the staging itself creates are in the picture.
  function clearFx() {
    for (const t of tracers) {
      t.life = 0;
      t.line.visible = false;
    }
    for (const b of booms) {
      b.life = 0;
      b.shell.visible = false;
    }
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  window.addEventListener('resize', resize);
  return {
    dom: renderer.domElement,
    sync,
    addTracer,
    explosion,
    muzzle,
    clearFx,
    resize,
  };
}
