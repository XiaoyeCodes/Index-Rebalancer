import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ASSETS } from './assets.js';

const PIVOT_Y = 3.7;      // beam pivot height
const ARM = 2.9;          // pivot to pan hook
const HANG = 1.7;         // hook to pan
const PAN_R = 1.0;
const STACK_R = 0.62;
const TARGET_H = 1.0;     // stack height when a pan holds exactly its target share
const MAX_ANGLE = 0.42;   // rad, beam travel either way
const GAIN = 4;           // rad of tilt per unit of high-risk overweight (5 pp ≈ 11°)
const STOP = MAX_ANGLE + 0.08; // mechanical stop: the beam can't swing past this
const STIFF = 3.2, DAMP = 1.5; // slow, slightly under-damped settle

const mat = {
  brass: new THREE.MeshStandardMaterial({ color: '#B39859', metalness: 0.85, roughness: 0.32 }),
  ink: new THREE.MeshStandardMaterial({ color: '#413F35', metalness: 0.3, roughness: 0.55 }),
  stone: new THREE.MeshStandardMaterial({ color: '#E6E1D5', metalness: 0, roughness: 0.85 }),
  accent: new THREE.MeshStandardMaterial({ color: '#BF6B50', metalness: 0.2, roughness: 0.4 }),
  tick: new THREE.MeshStandardMaterial({ color: '#8E897D', roughness: 0.6 }),
};

export function createBalance(container, { onHover, onDragChange }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#F7F5F0');
  scene.fog = new THREE.Fog('#F7F5F0', 16, 34);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(2.2, 4.4, 11.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2.5, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = 20;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.48;
  controls.autoRotateSpeed = 0.4;

  scene.add(new THREE.HemisphereLight('#FFFBF2', '#D8D2C2', 0.7));
  const sun = new THREE.DirectionalLight('#FFF6E8', 2.2);
  sun.position.set(4, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 25 });
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 4;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.13 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.04, 96), new THREE.MeshStandardMaterial({ color: '#EFECE4', roughness: 0.95 }));
  table.position.y = 0.02;
  table.receiveShadow = true;
  scene.add(table);

  const mesh = (geo, m, parent, cast = true) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = cast; o.receiveShadow = true;
    parent.add(o);
    return o;
  };

  // ---- stand ----
  const stand = new THREE.Group();
  scene.add(stand);
  mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.26, 72), mat.stone, stand).position.y = 0.17;
  mesh(new THREE.CylinderGeometry(0.62, 0.8, 0.16, 64), mat.ink, stand).position.y = 0.38;
  mesh(new THREE.CylinderGeometry(0.075, 0.11, PIVOT_Y - 0.46, 32), mat.ink, stand).position.y = (PIVOT_Y + 0.46) / 2;
  mesh(new THREE.SphereGeometry(0.13, 32, 16), mat.brass, stand).position.y = PIVOT_Y + 0.32;
  mesh(new THREE.ConeGeometry(0.06, 0.24, 24), mat.brass, stand).position.y = PIVOT_Y + 0.54;

  // scale arc the needle sweeps over: ticks every 5°, accent tick at level
  const SCALE_R = 1.05;
  const scale = new THREE.Group();
  scale.position.set(0, PIVOT_Y, 0.16);
  stand.add(scale);
  const arcSpan = MAX_ANGLE * 2 + 0.06;
  const arc = mesh(new THREE.TorusGeometry(SCALE_R, 0.012, 8, 96, arcSpan), mat.tick, scale, false);
  arc.rotation.z = -Math.PI / 2 - arcSpan / 2;
  for (let deg = -20; deg <= 20; deg += 5) {
    const a = THREE.MathUtils.degToRad(deg);
    const t = mesh(new THREE.BoxGeometry(0.018, deg === 0 ? 0.2 : 0.11, 0.02), deg === 0 ? mat.accent : mat.tick, scale, false);
    t.position.set(Math.sin(a) * SCALE_R, -Math.cos(a) * SCALE_R, 0);
    t.rotation.z = a;
  }

  // ---- beam ----
  const beam = new THREE.Group();
  beam.position.y = PIVOT_Y;
  scene.add(beam);
  for (const s of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.035, 0.075, ARM, 24), mat.brass, beam);
    arm.rotation.z = s * Math.PI / 2;
    arm.position.x = s * ARM / 2;
    mesh(new THREE.SphereGeometry(0.075, 24, 12), mat.brass, beam).position.x = s * ARM;
  }
  const hub = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.22, 48), mat.brass, beam);
  hub.rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 24), mat.ink, beam).rotation.x = Math.PI / 2;
  const needleMat = new THREE.MeshStandardMaterial({ color: '#5E8466', metalness: 0.3, roughness: 0.4 });
  const needle = mesh(new THREE.ConeGeometry(0.035, SCALE_R + 0.08, 16), needleMat, beam, false);
  needle.rotation.z = Math.PI;
  needle.position.set(0, -(SCALE_R + 0.08) / 2, 0.19);

  // ---- pans ----
  const bowl = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(PAN_R * 0.8, 0.0), new THREE.Vector2(PAN_R * 0.97, 0.05),
    new THREE.Vector2(PAN_R, 0.16), new THREE.Vector2(PAN_R * 0.985, 0.17), new THREE.Vector2(PAN_R * 0.95, 0.07),
    new THREE.Vector2(PAN_R * 0.78, 0.035), new THREE.Vector2(0, 0.035),
  ], 72);
  const layerGeo = new THREE.CylinderGeometry(STACK_R, STACK_R, 1, 64);
  layerGeo.translate(0, 0.5, 0);
  const pickable = [];

  const makePan = side => {
    const hanger = new THREE.Group();
    scene.add(hanger);
    const swing = new THREE.Group(); // pendulum sway, pivots at the hook
    hanger.add(swing);
    mesh(new THREE.TorusGeometry(0.07, 0.016, 8, 24), mat.brass, swing).rotation.y = Math.PI / 2;
    const top = new THREE.Vector3(0, -0.07, 0);
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3 + Math.PI / 6;
      const bottom = new THREE.Vector3(Math.cos(a) * PAN_R * 0.97, -HANG + 0.15, Math.sin(a) * PAN_R * 0.97);
      const len = top.distanceTo(bottom);
      const cord = mesh(new THREE.CylinderGeometry(0.009, 0.009, len, 6), mat.ink, swing);
      cord.position.copy(top).add(bottom).multiplyScalar(0.5);
      cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bottom.clone().sub(top).normalize());
      cord.userData.side = side;
      pickable.push(cord);
    }
    const dish = mesh(bowl, mat.brass, swing);
    dish.position.y = -HANG;
    dish.userData.side = side;
    pickable.push(dish);
    const stack = new THREE.Group();
    stack.position.y = -HANG + 0.035;
    swing.add(stack);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(STACK_R + 0.05, 0.008, 6, 72),
      new THREE.MeshBasicMaterial({ color: '#413F35', transparent: true, opacity: 0.45 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = TARGET_H;
    stack.add(ring);
    const el = document.createElement('div');
    el.className = 'pan-label';
    const label = new CSS2DObject(el);
    label.center.set(0.5, 1); // anchor the label's bottom edge, so it sits above the stack
    swing.add(label);
    return { side, hanger, swing, stack, ring, el, label, layers: new Map(), sway: 0, swayVel: 0 };
  };
  const pans = { [-1]: makePan(-1), [1]: makePan(1) };

  // ---- state ----
  let angle = 0, vel = 0, goal = 0;
  let drag = null, hovered = null;
  const tmp = new THREE.Vector3();

  function setPortfolio(a) {
    goal = THREE.MathUtils.clamp(a.tilt * GAIN, -MAX_ANGLE, MAX_ANGLE);
    // high-risk side is on the left (-1), so it dips (positive angle) when overweight
    for (const [side, grp] of [[-1, a.hi], [1, a.lo]]) {
      const pan = pans[side];
      const norm = grp.tgt > 0 ? TARGET_H / grp.tgt : TARGET_H; // stack reads TARGET_H tall at exactly target
      const seen = new Set();
      let y = 0;
      for (const r of [...grp.rows].sort((p, q) => q.tgt - p.tgt)) {
        seen.add(r.id);
        let layer = pan.layers.get(r.id);
        if (!layer) {
          layer = new THREE.Mesh(layerGeo, new THREE.MeshStandardMaterial({ color: ASSETS[r.id].color, roughness: 0.5, metalness: 0.08 }));
          layer.castShadow = layer.receiveShadow = true;
          layer.userData = { side, id: r.id };
          pan.stack.add(layer);
          pan.layers.set(r.id, layer);
          pickable.push(layer);
        }
        const h = Math.max(0.0001, Math.min(r.cur * norm, 2.6));
        layer.scale.y = Math.max(0.0001, h - 0.012);
        layer.position.y = y;
        layer.visible = h > 0.002;
        layer.userData.row = r;
        y += h;
      }
      for (const [id, layer] of pan.layers) if (!seen.has(id)) {
        pan.stack.remove(layer);
        layer.material.dispose();
        pickable.splice(pickable.indexOf(layer), 1);
        pan.layers.delete(id);
      }
      pan.ring.visible = grp.tgt > 0;
      const pct = v => (v * 100).toFixed(1) + '%';
      const d = (grp.cur - grp.tgt) * 100;
      pan.el.innerHTML = `<b>${side < 0 ? '高波动 · R4+' : '低波动 · R1–R3'}</b><span>${pct(grp.cur)} <i>目标 ${pct(grp.tgt)}</i></span>`
        + `<em class="${Math.abs(d) < 0.5 ? 'ok' : d > 0 ? 'over' : 'under'}">${Math.abs(d) < 0.05 ? '持平' : (d > 0 ? '+' : '') + d.toFixed(1) + ' pp'}</em>`;
      pan.labelY = y;
    }
  }

  // ---- pointer ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = e => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(pickable, false).find(h => h.object.visible) || null;
  };
  const setHover = obj => {
    if (hovered === obj) return;
    if (hovered?.material.emissive) hovered.material.emissive.setHex(0);
    hovered = obj;
    if (hovered?.userData.id) hovered.material.emissive.set('#3a2a18');
  };

  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => {
    const hit = pick(e);
    if (!hit) return;
    controls.enabled = false;
    el.setPointerCapture(e.pointerId);
    drag = { side: hit.object.userData.side, y: e.clientY, start: angle, last: angle, t: performance.now() };
    el.style.cursor = 'grabbing';
    onDragChange?.(true);
  });
  el.addEventListener('pointermove', e => {
    if (drag) {
      // dragging a pan down lowers that end of the beam; the scale is pixel-based so it feels the same at any zoom
      const next = THREE.MathUtils.clamp(drag.start - drag.side * (e.clientY - drag.y) * 0.0045, -STOP, STOP);
      const now = performance.now(), dt = Math.max(1, now - drag.t) / 1000;
      vel = THREE.MathUtils.lerp(vel, (next - drag.last) / dt, 0.5);
      drag.last = angle = next; drag.t = now;
      return;
    }
    const hit = pick(e);
    setHover(hit?.object.userData.id ? hit.object : null);
    el.style.cursor = hit ? 'grab' : '';
    onHover?.(hit?.object.userData.row || null, e.clientX, e.clientY);
  });
  const release = e => {
    if (!drag) return;
    // a flick carries into the release, but a pause before letting go doesn't
    vel = performance.now() - drag.t > 80 ? 0 : THREE.MathUtils.clamp(vel, -1.2, 1.2);
    drag = null;
    controls.enabled = true;
    el.style.cursor = '';
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    onDragChange?.(false);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', () => { if (!drag) { setHover(null); onHover?.(null); } });

  // ---- loop ----
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    // pull back on narrow screens so both pans stay in frame
    camera.fov = w / h < 0.9 ? 56 : 34;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  const clock = new THREE.Clock();
  const levelColor = new THREE.Color('#5E8466'), offColor = new THREE.Color('#BF6B50');
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const t = clock.elapsedTime;
    if (!drag) {
      const idle = Math.sin(t * 0.7) * 0.004; // the beam never quite stops breathing
      vel += (-(angle - goal - idle) * STIFF - vel * DAMP) * dt;
      angle += vel * dt;
      if (Math.abs(angle) > STOP) { angle = Math.sign(angle) * STOP; vel *= -0.3; } // knock against the stop
    }
    beam.rotation.z = angle;
    needleMat.color.copy(levelColor).lerp(offColor, Math.min(1, Math.abs(angle) / 0.12));

    for (const s of [-1, 1]) {
      const pan = pans[s];
      beam.localToWorld(tmp.set(s * ARM, 0, 0));
      pan.hanger.position.copy(tmp);
      // pans hang plumb; give them a little pendulum swing driven by the beam's motion
      pan.swayVel += (-pan.sway * 6 - pan.swayVel * 1.6 - vel * 1.4) * dt;
      pan.sway += pan.swayVel * dt;
      pan.swing.rotation.z = THREE.MathUtils.clamp(pan.sway, -0.25, 0.25);
      pan.label.position.y = -HANG + Math.max(pan.labelY || 0, TARGET_H) + 0.3;
    }

    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return {
    setPortfolio,
    get angle() { return angle; },
    setAutoRotate: on => { controls.autoRotate = on; },
    resetView: () => { camera.position.set(2.2, 4.4, 11.5); controls.target.set(0, 2.5, 0); },
  };
}
