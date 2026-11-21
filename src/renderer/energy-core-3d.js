import * as THREE from 'three';

window.createEdenEnergyCore = function createEdenEnergyCore(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  camera.position.set(0, 0, 4.7);

  const core = new THREE.Group();
  scene.add(core);

  const tau = Math.PI * 2;
  let seed = 731;

  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function point(radius, longitude, latitude) {
    return [
      radius * Math.cos(latitude) * Math.cos(longitude),
      radius * Math.sin(latitude),
      radius * Math.cos(latitude) * Math.sin(longitude)
    ];
  }

  function geometry(vertices) {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return result;
  }

  function lineMaterial(color, opacity) {
    return new THREE.LineBasicMaterial({
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
  }

  const shells = [];

  for (let layer = 0; layer < 3; layer++) {
    const shell = new THREE.Group();
    core.add(shell);
    shells.push(shell);

    const radius = 0.64 + layer * 0.16;
    const panels = [];
    const borders = [];
    const circuits = [];
    const lights = [];

    for (let row = 0; row < 9; row++) {
      for (let column = 0; column < 17; column++) {
        if (random() < 0.34) continue;

        const lon = (column + (row % 2) * 0.5) * tau / 17;
        const lat = -1.21 + row * 0.29;
        const span = 0.22 + random() * 0.13;
        const high = lat + 0.11 + random() * 0.10;

        let a = point(radius, lon, lat);
        let b = point(radius, lon, high);

        // Tessellate each fragment so it curves around the shell.
        for (let part = 1; part <= 5; part++) {
          const theta = lon + span * part / 5;
          const c = point(radius, theta, lat);
          const d = point(radius, theta, high);
          panels.push(...a, ...b, ...c, ...c, ...b, ...d);
          borders.push(...a, ...c, ...b, ...d);
          if (part === 1) borders.push(...a, ...b);
          if (part === 5) borders.push(...c, ...d);
          a = c;
          b = d;
        }

        for (let trace = 0; trace < 5; trace++) {
          const y = THREE.MathUtils.lerp(lat, high, (trace + 1) / 6);
          const start = lon + span * random() * 0.3;
          const bend = start + span * 0.29;
          const end = Math.min(lon + span * 0.94, bend + span * random() * 0.4);
          const r = radius + 0.004;
          const p = point(r, start, y);
          const q = point(r, bend, y);
          const s = point(r, bend + 0.018, y + 0.018);
          const u = point(r, end, y + 0.018);
          circuits.push(...p, ...q, ...q, ...s, ...s, ...u);
          if (random() < 0.48) lights.push(...u);
        }
      }
    }

    shell.add(new THREE.Mesh(geometry(panels), new THREE.MeshBasicMaterial({
      color: layer === 2 ? 0x1456d6 : 0x082c84,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })));

    shell.add(new THREE.LineSegments(geometry(borders), lineMaterial(0x388fff, 0.58)));
    shell.add(new THREE.LineSegments(geometry(circuits), lineMaterial(0x6fcbff, 0.68)));
    shell.add(new THREE.Points(geometry(lights), new THREE.PointsMaterial({
      color: 0xc4f8ff,
      size: 0.015,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })));
  }

  const rings = [];

  for (let index = 0; index < 3; index++) {
    const ring = new THREE.Group();
    const radius = 0.45 + index * 0.19;
    ring.rotation.set(0.5 + index * 0.63, index * 0.82, 0);

    for (let segment = 0; segment < 5; segment++) {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.013, 6, 28, 0.68 + random() * 0.28),
        new THREE.MeshBasicMaterial({
          color: index === 0 ? 0x79d9ff : 0x296cff,
          transparent: true,
          opacity: 0.86,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );
      arc.rotation.z = segment * tau / 5 + random() * 0.16;
      ring.add(arc);
    }

    core.add(ring);
    rings.push(ring);
  }

  const nucleus = new THREE.Mesh(
    new THREE.SphereGeometry(0.116, 32, 20),
    new THREE.MeshBasicMaterial({ color: 0xdafaff })
  );
  core.add(nucleus);

  const haloMaterial = new THREE.ShaderMaterial({
    uniforms: { strength: { value: 0.72 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 imageUV;
      void main() {
        imageUV = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 imageUV;
      uniform float strength;
      void main() {
        float d = length(imageUV - vec2(0.5));
        float glow = exp(-d * 9.0) * (1.0 - smoothstep(0.28, 0.50, d));
        gl_FragColor = vec4(0.15, 0.57, 1.0, glow * strength);
      }
    `
  });

  core.add(new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), haloMaterial));

  // Each pulse has points distributed around a 3D sphere.
  const pulses = Array.from({ length: 2 }, () => {
    const vertices = [];

    for (let i = 0; i < 190; i++) {
      const lon = random() * tau;
      const lat = Math.asin(random() * 2 - 1);
      vertices.push(...point(1, lon, lat));
    }

    const pulse = new THREE.Points(geometry(vertices), new THREE.PointsMaterial({
      color: 0x94eaff,
      size: 0.022,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));

    core.add(pulse);
    return pulse;
  });

  let previousTime = null;
  let spin = 0;
  let energy = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  return {
    draw({ width, height, time, elapsed, state, heard, motion }) {
      if (!width || !height) return;

      if (width !== lastWidth || height !== lastHeight) {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        lastWidth = width;
        lastHeight = height;
      }

      const dt = previousTime === null ? 0 : Math.min(0.05, Math.max(0, time - previousTime));
      previousTime = time;

      const listening = state === 'listening';
      const thinking = state === 'thinking';
      const speaking = state === 'speaking';
      const wake = motion && listening && elapsed < 0.85;

      if (motion) spin += dt * (thinking ? 1.6 : speaking ? 1.2 : 0.55);

      const targetEnergy = listening ? heard : speaking ? 0.65 : thinking ? 0.34 : 0.08;
      energy = THREE.MathUtils.damp(energy, targetEnergy, 10, dt);

      core.rotation.set(
        motion ? Math.sin(spin * 0.5) * 0.14 : 0.08,
        motion ? Math.sin(spin * 0.4) * 0.27 : 0.12,
        -0.12
      );

      shells.forEach((shell, i) => {
        const direction = i === 1 ? -1 : 1;
        shell.rotation.set(
          0.19 * i + spin * 0.13 * direction,
          0.38 * i + spin * (0.29 + 0.08 * i) * direction,
          0.12 * i + spin * 0.06
        );
      });

      rings.forEach((ring, i) => {
        ring.rotation.z = spin * (i === 1 ? -0.72 : 0.39 + i * 0.13) + i * 0.6;
        ring.rotation.x = 0.5 + i * 0.63 - (wake ? 0.30 * Math.exp(-elapsed * 5) : 0);
      });

      nucleus.scale.setScalar(1 + energy * 0.20);
      haloMaterial.uniforms.strength.value = 0.65 + energy * 0.65;

      pulses.forEach((pulse, i) => {
        pulse.visible = motion && (thinking || speaking || (wake && i === 0));
        if (!pulse.visible) return;

        const progress = wake ? elapsed / 0.85
          : (elapsed * (speaking ? 1.05 : 0.65) + i * 0.5) % 1;
        const travel = thinking ? 1 - progress : progress;

        pulse.scale.setScalar(0.12 + travel * 0.94);
        pulse.rotation.y = spin * 0.22 + i;
        pulse.material.opacity = Math.sin(progress * Math.PI) * (speaking ? 0.84 : 0.60);
      });

      renderer.render(scene, camera);
    }
  };
};