import * as THREE from 'three';

export function createFormTransition({
  stage,
  avatar,
  reducedMotion
}) {
  const layer = document.createElement('canvas');
  layer.className = 'eden-form-particles';
  layer.hidden = true;
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);

  let renderer = null;
  let running = null;

  function finish(job, completed) {
    if (running !== job) return;

    running = null;
    cancelAnimationFrame(job.frame);

    for (const animation of job.animations) {
      animation.cancel();
    }

    for (const object of job.objects) {
      object.geometry?.dispose();
      object.material?.dispose();
    }

    renderer?.clear();

    stage.classList.remove('eden-transforming');
    layer.hidden = true;

    job.resolve(completed);
  }

  function cancel() {
    if (running) finish(running, false);
  }

  const pathShader = `
    uniform float uP;
    uniform float uTime;
    uniform float uRadius;
    uniform float uSpan;
    uniform float uBottom;
    uniform vec2 uCenter;

    attribute vec3 aTarget;
    attribute vec4 aSeed;
    attribute float aAlong;

    varying vec3 vColor;
    varying float vAlpha;

    vec3 travel(float p) {
      float order = clamp(
        (aTarget.y - uBottom) / uSpan,
        0.0,
        1.0
      );

      float q = clamp(
        (p - 0.06 - order * 0.26) / 0.66,
        0.0,
        1.0
      );

      q = q * q * (3.0 - 2.0 * q);

      float a =
        aSeed.x * 6.2831853 +
        uTime * (1.0 - q) * 1.7 +
        q * 11.0;

      float latitude = aSeed.y * 2.0 - 1.0;

      float ring = sqrt(
        max(0.0, 1.0 - latitude * latitude)
      );

      float r = uRadius *
        (0.45 + aSeed.z * 0.55);

      vec3 core = vec3(
        cos(a) * ring * r,
        latitude * r,
        sin(a) * ring * r
      );

      core.xy += uCenter;

      vec3 point = mix(core, aTarget, q);
      float spread = sin(q * 3.14159265);

      point.x += cos(a + aSeed.w * 3.0) *
        spread * uRadius * 1.65;

      point.y += sin(a * 0.7) *
        spread * uRadius * 0.55;

      point.z += sin(a) *
        spread * uRadius * 1.8;

      return point;
    }
  `;

  function buildScene(targets, rect, width, height) {
    const scene = new THREE.Scene();

    const camera = new THREE.OrthographicCamera(
      -width / 2,
      width / 2,
      height / 2,
      -height / 2,
      0.1,
      4000
    );

    camera.position.z = 2000;

    const radius = Math.max(
      25,
      Math.min(95, rect.width * 0.25)
    );

    const cx =
      rect.left + rect.width / 2 - width / 2;

    const cy =
      height / 2 - rect.top - rect.height / 2;

    const count = targets.length ? 9000 : 2400;

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);

    let bottom = Infinity;
    let top = -Infinity;

    for (let i = 0; i < count; i++) {
      const target =
        targets[i % Math.max(1, targets.length)];

      const x = target
        ? target.x - width / 2
        : cx + Math.sin(i * 2.4) * radius;

      const y = target
        ? height / 2 - target.y
        : cy + Math.cos(i * 2.4) * radius;

      positions.set([
        x + (Math.random() - 0.5) * 2,
        y + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 8
      ], i * 3);

      seeds.set([
        Math.random(),
        Math.random(),
        Math.random(),
        Math.random()
      ], i * 4);

      bottom = Math.min(bottom, y);
      top = Math.max(top, y);
    }

    const uniforms = {
      uP: { value: 0 },
      uTime: { value: 0 },
      uRadius: { value: radius },
      uSpan: { value: Math.max(1, top - bottom) },
      uBottom: { value: bottom },
      uCenter: {
        value: new THREE.Vector2(cx, cy)
      },
      uGlow: { value: 0 },
      uPixelRatio: {
        value: Math.min(
          window.devicePixelRatio || 1,
          1.5
        )
      }
    };

    const objects = [];
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );

    geometry.setAttribute(
      'aTarget',
      new THREE.BufferAttribute(positions, 3)
    );

    geometry.setAttribute(
      'aSeed',
      new THREE.BufferAttribute(seeds, 4)
    );

    geometry.setAttribute(
      'aAlong',
      new THREE.BufferAttribute(
        new Float32Array(count),
        1
      )
    );

    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,

      vertexShader: pathShader + `
        uniform float uGlow;
        uniform float uPixelRatio;

        void main() {
          vec3 point = travel(uP);

          vColor = mix(
            vec3(0.12, 0.48, 1.0),
            vec3(0.42, 0.96, 1.0),
            aSeed.z
          );

          if (aSeed.w > 0.9) {
            vColor = vec3(0.8, 0.66, 1.0);
          }

          vAlpha = uGlow *
            (0.45 + aSeed.z * 0.5);

          gl_Position =
            projectionMatrix *
            modelViewMatrix *
            vec4(point, 1.0);

          gl_PointSize =
            (2.5 + aSeed.w * 4.0) * uPixelRatio;
        }
      `,

      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          float r =
            length(gl_PointCoord - 0.5) * 2.0;

          if (r > 1.0) discard;

          float glow = exp(-r * r * 5.0);
          float center = exp(-r * r * 55.0);

          gl_FragColor = vec4(
            vColor + center * 0.35,
            (glow * 0.65 + center * 0.35) *
              vAlpha
          );
        }
      `
    });

    const points = new THREE.Points(
      geometry,
      material
    );

    points.frustumCulled = false;
    scene.add(points);
    objects.push(points);

    // Light streaks follow the particle paths.
    const trailCount = Math.min(1600, count);

    const trailPositions =
      new Float32Array(trailCount * 6);

    const trailSeeds =
      new Float32Array(trailCount * 8);

    const along =
      new Float32Array(trailCount * 2);

    for (let i = 0; i < trailCount; i++) {
      const source = Math.floor(
        i * count / trailCount
      );

      for (let end = 0; end < 2; end++) {
        trailPositions.set(
          positions.subarray(
            source * 3,
            source * 3 + 3
          ),
          (i * 2 + end) * 3
        );

        trailSeeds.set(
          seeds.subarray(
            source * 4,
            source * 4 + 4
          ),
          (i * 2 + end) * 4
        );

        along[i * 2 + end] = end;
      }
    }

    const trailGeometry =
      new THREE.BufferGeometry();

    trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        trailPositions,
        3
      )
    );

    trailGeometry.setAttribute(
      'aTarget',
      new THREE.BufferAttribute(
        trailPositions,
        3
      )
    );

    trailGeometry.setAttribute(
      'aSeed',
      new THREE.BufferAttribute(
        trailSeeds,
        4
      )
    );

    trailGeometry.setAttribute(
      'aAlong',
      new THREE.BufferAttribute(along, 1)
    );

    const trailMaterial =
      new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,

        vertexShader: pathShader + `
          uniform float uGlow;

          void main() {
            vec3 point = travel(
              clamp(
                uP - aAlong * 0.025,
                0.0,
                1.0
              )
            );

            vColor = vec3(0.18, 0.62, 1.0);

            vAlpha = uGlow *
              (1.0 - aAlong * 0.85) * 0.25;

            gl_Position =
              projectionMatrix *
              modelViewMatrix *
              vec4(point, 1.0);
          }
        `,

        fragmentShader: `
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            gl_FragColor = vec4(
              vColor,
              vAlpha
            );
          }
        `
      });

    const trails = new THREE.LineSegments(
      trailGeometry,
      trailMaterial
    );

    trails.frustumCulled = false;
    scene.add(trails);
    objects.push(trails);

    // Rotating energy rings have different 3D planes.
    const rings = new THREE.Group();
    rings.position.set(cx, cy, 0);
    scene.add(rings);

    for (let i = 0; i < 7; i++) {
      const vertices = [];

      for (let j = 0; j <= 180; j++) {
        const a = j / 180 * Math.PI *
          (i % 2 ? 1.65 : 2);

        const r = radius * (1.1 + i * 0.1);

        vertices.push(
          Math.cos(a) * r,
          Math.sin(a) * r,
          0
        );
      }

      const ringGeometry =
        new THREE.BufferGeometry();

      ringGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          vertices,
          3
        )
      );

      const ring = new THREE.Line(
        ringGeometry,
        new THREE.LineBasicMaterial({
          color: i % 3 === 0
            ? 0xa5edff
            : 0x328fff,
          transparent: true,
          opacity: 0,
          depthTest: false,
          blending: THREE.AdditiveBlending
        })
      );

      ring.rotation.set(
        i * 0.51,
        i * 0.73,
        i * 0.38
      );

      rings.add(ring);
      objects.push(ring);
    }

    return {
      scene,
      camera,
      uniforms,
      rings,
      objects
    };
  }

  function play(showHuman, targets) {
    cancel();

    const quiet = reducedMotion.matches;
    const duration = quiet ? 180 : 2400;

    const width = window.innerWidth;
    const height = window.innerHeight;

    let effect = null;

    if (!quiet) {
      try {
        if (!renderer) {
          renderer = new THREE.WebGLRenderer({
            canvas: layer,
            alpha: true,
            antialias: false,
            powerPreference: 'high-performance'
          });

          renderer.setClearColor(0x000000, 0);
          renderer.outputColorSpace =
            THREE.SRGBColorSpace;
        }

        renderer.setPixelRatio(
          Math.min(
            window.devicePixelRatio || 1,
            1.5
          )
        );

        renderer.setSize(width, height, false);

        effect = buildScene(
          targets,
          stage.getBoundingClientRect(),
          width,
          height
        );
      } catch (error) {
        console.warn(
          'EDEN transformation: using fade fallback.',
          error.message
        );
      }
    }

    stage.classList.add('eden-transforming');
    layer.hidden = !effect;

    const animations = [];

    function fade(element, frames) {
      if (!element) return;

      const animation = element.animate(
        frames,
        { duration, fill: 'both' }
      );

      animation.pause();
      animations.push(animation);
    }

    const reveal = [
      {
        offset: 0,
        opacity: 0,
        clipPath: 'inset(100% 0 0 0)'
      },
      {
        offset: 0.28,
        opacity: 0,
        clipPath: 'inset(100% 0 0 0)'
      },
      {
        offset: 0.52,
        opacity: 0.55,
        clipPath: 'inset(60% 0 0 0)'
      },
      {
        offset: 0.82,
        opacity: 0.9,
        clipPath: 'inset(10% 0 0 0)'
      },
      {
        offset: 1,
        opacity: 1,
        clipPath: 'inset(0% 0 0 0)'
      }
    ];

    const humanFrames = quiet || !effect
      ? [
          { opacity: showHuman ? 0 : 1 },
          { opacity: showHuman ? 1 : 0 }
        ]
      : showHuman
        ? reveal
        : reveal.map(frame => ({
            ...frame,
            offset: 1 - frame.offset
          })).reverse();

    fade(avatar, humanFrames);

    const coreFrames = [
      { opacity: 1, offset: 0 },
      { opacity: 0, offset: 0.35 },
      { opacity: 0, offset: 1 }
    ];

    fade(
      stage.querySelector('#reactor'),
      showHuman
        ? coreFrames
        : coreFrames.map(frame => ({
            ...frame,
            offset: 1 - frame.offset
          })).reverse()
    );

    return new Promise(resolve => {
      const job = {
        resolve,
        animations,
        objects: effect?.objects || [],
        frame: 0,
        started: performance.now()
      };

      running = job;

      function frame(now) {
        if (running !== job) return;

        const t = Math.min(
          1,
          Math.max(
            0,
            (now - job.started) / duration
          )
        );

        for (const animation of animations) {
          animation.currentTime = t * duration;
        }

        if (effect) {
          effect.uniforms.uP.value =
            showHuman ? t : 1 - t;

          effect.uniforms.uTime.value =
            (now - job.started) / 1000;

          effect.uniforms.uGlow.value =
            Math.pow(Math.sin(Math.PI * t), 0.7);

          const bloom = Math.sin(Math.PI * t);

          effect.rings.scale.setScalar(
            1 + bloom * 1.6
          );

          effect.rings.children.forEach(
            (ring, index) => {
              ring.rotation.x =
                index * 0.51 +
                t * (index % 2 ? 1 : -1) * 1.8;

              ring.rotation.y =
                index * 0.73 + t * 2.1;

              ring.rotation.z =
                index * 0.38 +
                t * (index % 2 ? -3 : 3);

              ring.material.opacity =
                bloom *
                (index % 2 ? 0.28 : 0.5);
            }
          );

          renderer.render(
            effect.scene,
            effect.camera
          );
        }

        if (t < 1) {
          job.frame =
            requestAnimationFrame(frame);
        } else {
          finish(job, true);
        }
      }

      job.frame = requestAnimationFrame(frame);
    });
  }

  return {
    play,
    cancel,

    dispose() {
      cancel();
      renderer?.dispose();
      layer.remove();
    }
  };
}