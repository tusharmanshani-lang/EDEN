import { createOutfitLightingProfile } from './avatar-lighting.js';
import { createReactorTransformation } from './reactor-transformation.js';
import { createAvatarWardrobe, parseOutfitCommand } from './avatar-wardrobe.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip
} from '@pixiv/three-vrm-animation';

import {
  createAvatarReactions,
  parseEmotionCommand
} from './avatar-reactions.js';

import {
  loadAlfaazDance,
  loadVaroonDance
} from './avatar-dance.js';

import {
  createFormTransition
} from './avatar-transition.js';

(() => {
  const stage = document.querySelector('.reactor-stage');
  const app = document.querySelector('.app');
  if (!stage || !app) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'eden-avatar';
  canvas.hidden = true;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'EDEN human avatar');
  stage.appendChild(canvas);

  const reducedMotion = matchMedia(
    '(prefers-reduced-motion: reduce)'
  );

  const reactorTransformation = createReactorTransformation({ stage, reducedMotion });

  const formTransition = createFormTransition({
  stage,
  avatar: canvas,
  reducedMotion
});

let formTransitionRequest = 0;
  const motions = {
      alfaaz: {
  file: 'alfaaz.fbx',
  audio: 'alfaaz.mp3',
  reply: 'Here’s the Alfaaz choreography.'
},
varoon: {
  file: 'varoon.fbx',
  audio: 'varoon.mp3',
  reply: 'Here’s the Varoon choreography.'
},
    greeting: {
      file: 'VRMA_02.vrma',
      reply: 'Hi, Tushar!'
    },
    peace: {
      file: 'VRMA_03.vrma',
      reply: 'Here’s a peace sign.'
    },
    spin: {
      file: 'VRMA_05.vrma',
      reply: 'Here’s a little turn.'
    },
    pose: {
      file: 'VRMA_06.vrma',
      reply: 'How’s this pose?'
    }
  };

  let renderer = null;
  let scene = null;
  let camera = null;
  let vrm = null;
  let reactions = null;
  let loading = null;
  let wardrobe = null;
  let outfitCommandEpoch = 0;

  let mixer = null;
  let restAction = null;
  let currentAction = null;
  let motionEndsAt = Infinity;
  let motionRequest = 0;
  let danceAudio = null;
let danceAudioAction = null;

function stopDanceAudio() {
  const audio = danceAudio;

  danceAudio = null;
  danceAudioAction = null;

  if (!audio) return;

  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

  const motionCache = new Map();
  const bones = [];

  let visible = false;
  let desiredForm = 'energy';
  let activity = 'idle';
  let taraPlaying = false;

  let previousFrame = performance.now();
  let animationTime = 0;
  let nextBlink = 3;
  let blinkStarted = -10;

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  // Fit using the standing pose, rather than refitting during gestures.
  let standingBounds = null;
    const danceBounds = new THREE.Box3();
  const danceFrame = new THREE.Box3();
  const dancePoint = new THREE.Vector3();
  const danceCenter = new THREE.Vector3();
  const danceSize = new THREE.Vector3();
  let danceCameraActive = false;
    const standingHipRotation = new THREE.Quaternion();
  const currentHipRotation = new THREE.Quaternion();
  const danceCameraDirection = new THREE.Vector3(0, 0, 1);
  const desiredCameraDirection = new THREE.Vector3(0, 0, 1);
  let danceCameraUpdatedAt = 0;
    let dancePlaceholder = null;

  function enterDanceView() {
    if (dancePlaceholder) return;

    // Remember the stage's original position in the interface.
    dancePlaceholder = document.createComment(
      'EDEN stage original position'
    );

    stage.before(dancePlaceholder);

    // Move outside the panel layout so the stage can use
    // the entire EDEN window.
    document.body.appendChild(stage);

    stage.classList.add('eden-dance-stage');
    document.body.classList.add('eden-dance-view');

    resize();
  }

  function exitDanceView() {
    if (!dancePlaceholder) return;

    stage.classList.remove('eden-dance-stage');
    document.body.classList.remove('eden-dance-view');

    dancePlaceholder.replaceWith(stage);
    dancePlaceholder = null;

    resize();
  }

  window.addEventListener('keydown', event => {
    if (
      event.key !== 'Escape' ||
      !dancePlaceholder
    ) {
      return;
    }

    event.preventDefault();

    motionRequest++;
    returnToRest(0);
    mixer?.update(0);

    danceCameraActive = false;
    danceBounds.makeEmpty();

    exitDanceView();
  });

  function fitDanceCamera() {
    if (!vrm || !camera || !standingBounds) return;

   const clipName = currentAction?.getClip()?.name;

const dancing =
  clipName === 'EDEN Alfaaz dance' ||
  clipName === 'EDEN Varoon dance' || String(clipName || '').startsWith('EDEN generated:');

    if (!dancing) {
            exitDanceView();
      if (danceCameraActive) {
        danceCameraActive = false;
        danceBounds.makeEmpty();
        resize();
      }

      return;
    }

    if (!danceCameraActive) {
            enterDanceView();
      danceCameraActive = true;
      danceBounds.copy(standingBounds);
    }

    vrm.scene.updateMatrixWorld(true);
    danceFrame.makeEmpty();

    // Include the animated head, hands, fingers, legs and feet.
    for (const bone of Object.values(
      vrm.humanoid.rawHumanBones
    )) {
      if (!bone?.node) continue;

      bone.node.getWorldPosition(dancePoint);
      danceFrame.expandByPoint(dancePoint);
    }

    if (danceFrame.isEmpty()) return;

    standingBounds.getSize(danceSize);

    // Extra room for hair, clothing and the top of her head.
    danceFrame.expandByScalar(
      Math.max(0.05, danceSize.y * 0.15)
    );

    // Remember the space used during this performance.
    // The camera widens instead of zooming in and out
    // with every hand movement.
    danceBounds.union(danceFrame);

    danceBounds.getCenter(danceCenter);
    danceBounds.getSize(danceSize);

    const halfFov = THREE.MathUtils.degToRad(
      camera.fov / 2
    );

    const fitHeight = danceSize.y /
      (2 * Math.tan(halfFov));

    const fitWidth = danceSize.x /
      (2 * Math.tan(halfFov) * camera.aspect);

    const distance =
      Math.max(fitHeight, fitWidth) * 1.12 +
      danceSize.z / 2;

        const hips = vrm.humanoid.getRawBoneNode('hips');

    if (hips) {
      hips.getWorldQuaternion(currentHipRotation);

      currentHipRotation.multiply(
        standingHipRotation.clone().invert()
      );

      desiredCameraDirection
        .set(0, 0, 1)
        .applyQuaternion(currentHipRotation);

      // Follow horizontal turns without tilting the camera.
      desiredCameraDirection.y = 0;

      if (desiredCameraDirection.lengthSq() > 0.001) {
        desiredCameraDirection.normalize();
      } else {
        desiredCameraDirection.copy(
          danceCameraDirection
        );
      }
    }

    const now = performance.now();

    const elapsed = danceCameraUpdatedAt
      ? Math.min(
          (now - danceCameraUpdatedAt) / 1000,
          0.05
        )
      : 0.016;

    danceCameraUpdatedAt = now;

    // Smooth horizontal rotation, including a full turn.
    const currentAngle = Math.atan2(
      danceCameraDirection.x,
      danceCameraDirection.z
    );

    const desiredAngle = Math.atan2(
      desiredCameraDirection.x,
      desiredCameraDirection.z
    );

    const angleDifference = Math.atan2(
      Math.sin(desiredAngle - currentAngle),
      Math.cos(desiredAngle - currentAngle)
    );

    const nextAngle = currentAngle +
      angleDifference * (1 - Math.exp(-4 * elapsed));

    danceCameraDirection.set(
      Math.sin(nextAngle),
      0,
      Math.cos(nextAngle)
    );

    // Allow enough room as the camera moves around the stage.
    const horizontalSpan = Math.hypot(
      danceSize.x,
      danceSize.z
    );

    const orbitDistance = Math.max(
      distance,
      horizontalSpan /
        (2 * Math.tan(halfFov) * camera.aspect) *
        1.12 +
        horizontalSpan / 2
    );

    camera.position.copy(danceCenter).addScaledVector(
      danceCameraDirection,
      orbitDistance
    );

    camera.lookAt(danceCenter);
    camera.near = Math.max(0.01, orbitDistance / 100);
    camera.far = Math.max(20, orbitDistance * 10);
    camera.updateProjectionMatrix();
  }

  function resize() {
    if (!renderer || !camera) return;

    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 2)
    );
    renderer.setSize(width, height, false);

    camera.aspect = width / height;

    if (standingBounds) {
      standingBounds.getCenter(center);
      standingBounds.getSize(size);

      const halfFov = THREE.MathUtils.degToRad(
        camera.fov / 2
      );

      const fitHeight = size.y /
        (2 * Math.tan(halfFov));

      const fitWidth = size.x /
        (2 * Math.tan(halfFov) * camera.aspect);

      const distance =
        Math.max(fitHeight, fitWidth) * 1.02 +
        size.z / 2;

      camera.position.set(
        center.x,
        center.y,
        center.z + distance
      );

      camera.lookAt(center);
      camera.near = Math.max(0.01, distance / 100);
      camera.far = Math.max(20, distance * 10);
    }

    camera.updateProjectionMatrix();
  }

  function returnToRest(duration = 0.65) {
    stopDanceAudio();

    if (!restAction || !mixer) return;

    motionEndsAt = Infinity;

    if (currentAction === restAction) return;

    const previous = currentAction;

    restAction.reset();
    restAction.enabled = true;
    restAction.setEffectiveWeight(1);
    restAction.setEffectiveTimeScale(1);
    restAction.play();

    if (previous) {
      restAction.crossFadeFrom(previous, duration, false);
    }

    currentAction = restAction;
  }

  function setVisible(show) {
        if (!show) {
      danceCameraActive = false;
      danceBounds.makeEmpty();
      exitDanceView();
    }
    visible = show;
    stage.toggleAttribute('data-avatar-lit', show);
    canvas.hidden = !show;
    app.classList.toggle('eden-human-form', show);

    previousFrame = performance.now();

    if (show) {
      resize();
      renderer?.setAnimationLoop(animate);
    } else {
      // Invalidate an animation that is still loading.
      motionRequest++;
      returnToRest(0);
      mixer?.update(0);
      renderer?.setAnimationLoop(null);
    }
  }

  function sampleAvatarParticles() {
  if (!vrm || !camera) return [];

  const rect = stage.getBoundingClientRect();

  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  const meshes = [];
  let totalVertices = 0;

  vrm.scene.traverseVisible(object => {
    const positions = object.geometry?.attributes?.position;

    if (
      !object.isMesh ||
      !positions ||
      typeof object.getVertexPosition !== 'function'
    ) {
      return;
    }

    object.skeleton?.update();

    meshes.push({
      object,
      count: positions.count,
      start: totalVertices
    });

    totalVertices += positions.count;
  });

  if (!totalVertices) return [];

  const count = Math.min(1200, totalVertices);
  const point = new THREE.Vector3();
  const targets = [];
  let meshIndex = 0;

  for (let index = 0; index < count; index++) {
    const vertex = Math.floor(
      (index + 0.5) * totalVertices / count
    );

    while (
      meshIndex < meshes.length - 1 &&
      vertex >=
        meshes[meshIndex].start +
        meshes[meshIndex].count
    ) {
      meshIndex++;
    }

    const mesh = meshes[meshIndex];

    mesh.object.getVertexPosition(
      vertex - mesh.start,
      point
    );

    point.applyMatrix4(mesh.object.matrixWorld);
    point.project(camera);

    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.z < -1 ||
      point.z > 1
    ) {
      continue;
    }

    targets.push({
      x: rect.left + (point.x + 1) * rect.width / 2,
      y: rect.top + (1 - point.y) * rect.height / 2
    });
  }

  return targets;
}

async function transformForm(showHuman) {
  const request = ++formTransitionRequest;

  formTransition.cancel();

  if (showHuman === visible) {
    return true;
  }

  if (!vrm || !renderer || !camera) {
    setVisible(showHuman);
    return true;
  }

  // End any dance before changing forms.
  motionRequest++;
  returnToRest(0);
  mixer?.update(0);

  danceCameraActive = false;
  danceBounds.makeEmpty();
  danceCameraUpdatedAt = 0;

  exitDanceView();

  // Keep the avatar rendering during either direction.
  setVisible(true);
  resize();

  let targets = [];

  try {
    targets = sampleAvatarParticles();
  } catch (error) {
    console.warn(
      'EDEN particle sampling:',
      error.message
    );
  }

  const transition = formTransition.play(
    showHuman,
    targets
  );

  // Render the avatar while its transition opacity is zero.
  animate(performance.now());

  const completed = await transition;

  if (
    !completed ||
    request !== formTransitionRequest
  ) {
    return false;
  }

  setVisible(showHuman);
  return true;
}
  function createMotionController() {
    bones.length = 0;

    for (const bone of Object.values(
      vrm.humanoid.normalizedHumanBones
    )) {
      if (!bone?.node) continue;

      const node = bone.node;

      bones.push({
        node,
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(),
        savedPosition: new THREE.Vector3(),
        savedQuaternion: new THREE.Quaternion(),
        savedScale: new THREE.Vector3()
      });
    }

    const tracks = [];

    for (const bone of bones) {
      const q = bone.quaternion.toArray();
      const p = bone.position.toArray();

      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${bone.node.uuid}.quaternion`,
          [0, 1],
          [...q, ...q]
        )
      );

      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${bone.node.uuid}.position`,
          [0, 1],
          [...p, ...p]
        )
      );
    }

    mixer = new THREE.AnimationMixer(vrm.scene);

    const restClip = new THREE.AnimationClip(
      'EDEN relaxed standing',
      1,
      tracks
    );

    restAction = mixer.clipAction(restClip);
    restAction.setLoop(THREE.LoopRepeat, Infinity);
    restAction.play();

    currentAction = restAction;
  }

  async function loadMotion(name) {
    if (!motions[name]) {
      throw new Error('Unknown avatar motion.');
    }

    if (motionCache.has(name)) {
      return motionCache.get(name);
    }

    const promise = (async () => {
           if (name === 'alfaaz') {
  return loadAlfaazDance(vrm);
}

if (name === 'varoon') {
  return loadVaroonDance(vrm);
}
      const url = new URL(
        `./vrma/${motions[name].file}`,
        document.baseURI
      );

      const loader = new GLTFLoader();

      loader.register(
        parser => new VRMAnimationLoaderPlugin(parser)
      );

      const gltf = await loader.loadAsync(url.href);
      const animation = gltf.userData.vrmAnimations?.[0];

      if (!animation) {
        throw new Error(
          `${motions[name].file} contains no VRM animation.`
        );
      }

      const clip = createVRMAnimationClip(animation, vrm);

      // Keep facial expressions and lip movement under EDEN's
      // existing expression controller.
      const boneTargets = new Set();

      for (const bone of bones) {
        boneTargets.add(bone.node.uuid);
        if (bone.node.name) {
          boneTargets.add(bone.node.name);
        }
      }

      clip.tracks = clip.tracks.filter(track => {
        const binding = THREE.PropertyBinding.parseTrackName(
          track.name
        );

        return boneTargets.has(binding.nodeName) &&
          (
            binding.propertyName === 'quaternion' ||
            binding.propertyName === 'position'
          );
      });

      if (!clip.tracks.length) {
        throw new Error(
          'The animation could not be mapped to EDEN’s skeleton.'
        );
      }

      if (!(clip.duration > 0)) {
        throw new Error('The animation has no playable duration.');
      }

      clip.name = `EDEN ${name}`;
      return clip;
    })();

    motionCache.set(name, promise);

    try {
      return await promise;
    } catch (error) {
      motionCache.delete(name);
      throw error;
    }
  }

  async function playMotion(name) {
  // Public release: imported motion assets are not distributed.
  return false;

  stage.removeAttribute('data-generated-motion');
  const request = ++motionRequest;

  if (reducedMotion.matches) {
    return false;
  }

  const clip = await loadMotion(name);

  if (
    request !== motionRequest ||
    !visible ||
    desiredForm !== 'human'
  ) {
    return false;
  }

  const action = mixer.clipAction(clip);

  // Finish any previous performance before starting another.
  returnToRest(0);
  mixer.update(0);

  let audio = null;

  if (motions[name].audio) {
    audio = new Audio(
      new URL(
        './dances/' + motions[name].audio,
        document.baseURI
      ).href
    );

    audio.preload = 'auto';
    audio.loop = false;
    audio.volume = 1;

    danceAudio = audio;

    try {
      await audio.play();
    } catch (error) {
      if (
        request !== motionRequest ||
        danceAudio !== audio
      ) {
        return false;
      }

      stopDanceAudio();

      throw new Error(
        'Could not play ' + motions[name].audio +
        '. Check its filename and that it is a playable audio file. ' +
        error.message
      );
    }

    if (
      request !== motionRequest ||
      !visible ||
      desiredForm !== 'human' ||
      danceAudio !== audio
    ) {
      if (danceAudio === audio) {
        stopDanceAudio();
      }

      return false;
    }
  }

  const previous = currentAction;

  action.reset();
  action.enabled = true;
  action.clampWhenFinished = true;
  action.setLoop(THREE.LoopOnce, 1);
  action.setEffectiveWeight(1);
  action.setEffectiveTimeScale(1);

  // For dances, the audio clock controls the animation.
  action.paused = Boolean(audio);
  action.time = audio
    ? Math.min(audio.currentTime, clip.duration)
    : 0;

  action.play();

  if (previous && previous !== action) {
    action.crossFadeFrom(previous, 0.45, false);
  }

  currentAction = action;

  if (audio) {
    danceAudioAction = action;
    motionEndsAt = Infinity;

    const finish = () => {
      if (
        danceAudio !== audio ||
        currentAction !== action
      ) {
        return;
      }

      motionRequest++;
      returnToRest();
    };

    audio.onended = finish;

    audio.onerror = () => {
      console.error(
        'EDEN dance audio:',
        motions[name].audio,
        audio.error
      );

      finish();
    };

    // The file may have ended while playback was starting.
    if (audio.ended) {
      finish();
    }
  } else {
    motionEndsAt = mixer.time +
      Math.max(0.1, clip.duration - 0.55);
  }

  return true;
}

  async function loadAvatar() {
    if (loading) return loading;
    if (vrm) return;

    loading = (async () => {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power'
      });

      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.9;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(
        30, 1, 0.01, 100
      );

      scene.add(
        new THREE.HemisphereLight(
          0xfff5eb,
          0x59647a,
          0.65
        )
      );

      const keyLight = new THREE.DirectionalLight(
        0xfff5ee,
        0.8
      );

      keyLight.position.set(2, 3, 4);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(
        0xa8cfff,
        0.25
      );

      rimLight.position.set(-2, 2, -2);
      scene.add(rimLight);

      // Fill the legs and feet without washing out the whole interface.
      const lowerFill = new THREE.DirectionalLight(0xddeaff, 0.75);
      lowerFill.position.set(1.2, 0.45, 2.5);
      lowerFill.target.position.set(0, 0.45, 0);
      scene.add(lowerFill, lowerFill.target);

      const softFill = new THREE.DirectionalLight(0xffefdc, 0.35);
      softFill.position.set(-2, 1, 1);
      softFill.target.position.set(0, 0.7, 0);
      scene.add(softFill, softFill.target);

      const loader = new GLTFLoader();

      loader.register(
        parser => new VRMLoaderPlugin(parser)
      );

      const modelURL = new URL(
        './eden.vrm',
        document.baseURI
      );

      const response = await fetch(modelURL.href);

      if (!response.ok) {
        throw new Error('Could not read eden.vrm.');
      }

      const modelData = await response.arrayBuffer();

      if (modelData.byteLength < 12) {
        throw new Error('eden.vrm is incomplete.');
      }

      const binaryView = new DataView(modelData);

      if (
        binaryView.getUint32(0, true) !== 0x46546c67
      ) {
        throw new Error(
          'eden.vrm is not a valid binary glTF file.'
        );
      }

      let documentData = null;
      let binaryChunk = null;
      let offset = 12;

      while (offset + 8 <= modelData.byteLength) {
        const length = binaryView.getUint32(
          offset, true
        );

        const type = binaryView.getUint32(
          offset + 4, true
        );

        const start = offset + 8;

        if (start + length > modelData.byteLength) {
          throw new Error(
            'The VRM file contains an incomplete data chunk.'
          );
        }

        const chunk = modelData.slice(
          start,
          start + length
        );

        if (type === 0x4e4f534a) {
          documentData = JSON.parse(
            new TextDecoder().decode(chunk)
          );
        } else if (type === 0x004e4942) {
          binaryChunk = chunk;
        }

        offset = start + length;
      }

      if (!documentData || !binaryChunk) {
        throw new Error(
          'The VRM model data or textures are missing.'
        );
      }

      function toDataURL(data, mimeType) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();

          reader.onload = () => resolve(reader.result);

          reader.onerror = () => reject(
            reader.error ||
            new Error('Could not decode a model texture.')
          );

          reader.readAsDataURL(
            new Blob([data], { type: mimeType })
          );
        });
      }

      await Promise.all(
        (documentData.images || []).map(
          async image => {
            if (image.bufferView === undefined) return;

            const view =
              documentData.bufferViews[image.bufferView];

            if (view.buffer !== 0) {
              throw new Error(
                'An unexpected external texture buffer was found.'
              );
            }

            const start = view.byteOffset || 0;

            image.uri = await toDataURL(
              binaryChunk.slice(
                start,
                start + view.byteLength
              ),
              image.mimeType || 'image/png'
            );

            delete image.bufferView;
          }
        )
      );

      documentData.buffers[0].uri = await toDataURL(
        binaryChunk.slice(
          0,
          documentData.buffers[0].byteLength
        ),
        'application/octet-stream'
      );

      const gltf = await loader.parseAsync(
        JSON.stringify(documentData),
        new URL('./', modelURL).href
      );

      const loaded = gltf.userData.vrm;

      if (!loaded) {
        VRMUtils.deepDispose(gltf.scene);

        throw new Error(
          'The file did not contain a supported VRM model.'
        );
      }

      vrm = loaded;
      VRMUtils.rotateVRM0(vrm);
      scene.add(vrm.scene);

      const anisotropy = Math.min(
        8,
        renderer.capabilities.getMaxAnisotropy()
      );

      vrm.scene.traverse(object => {
        object.frustumCulled = false;

        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];

        for (const material of materials) {
          if (!material) continue;

          for (const value of Object.values(material)) {
            if (value?.isTexture) {
              value.anisotropy = anisotropy;
              value.needsUpdate = true;
            }
          }
        }
      });

      const leftArm = vrm.humanoid
        .getNormalizedBoneNode('leftUpperArm');

      const rightArm = vrm.humanoid
        .getNormalizedBoneNode('rightUpperArm');

     if (leftArm) leftArm.rotation.z = -1.45;
if (rightArm) rightArm.rotation.z = 1.45;

      vrm.expressionManager?.setValue('happy', 0.08);

      vrm.update(0);
      vrm.scene.updateMatrixWorld(true);

      standingBounds = new THREE.Box3()
        .setFromObject(vrm.scene);

              const standingHips = vrm.humanoid
        .getRawBoneNode('hips');

      standingHips?.getWorldQuaternion(
        standingHipRotation
      );
      reactions = createAvatarReactions(vrm);
      createMotionController();
      const applyOutfitLighting = createOutfitLightingProfile({
        renderer,
        hemisphere: scene.children.find(light => light.isHemisphereLight),
        key: keyLight,
        rim: rimLight,
        lower: lowerFill,
        soft: softFill
      });
      wardrobe = createAvatarWardrobe({
        vrm,
        baseURL: document.baseURI,
        onOutfitChanged: applyOutfitLighting
      });

      console.log(
        'EDEN VRM: model and motion controller loaded.'
      );
    })();

    try {
      await loading;
    } catch (error) {
      mixer?.stopAllAction();

      wardrobe?.dispose();
      wardrobe = null;
      if (vrm) {
        VRMUtils.deepDispose(vrm.scene);
      }

      renderer?.setAnimationLoop(null);
      renderer?.dispose();

      vrm = null;
      renderer = null;
      scene = null;
      camera = null;
      reactions = null;
      mixer = null;
      restAction = null;
      currentAction = null;
      standingBounds = null;
      bones.length = 0;
      motionCache.clear();
      loading = null;

      throw error;
    }
  }

  function updateExpressions(delta, speaking, moving) {
    // Preserve the body pose while letting the existing
    // reactions module update facial expression weights.
    for (const bone of bones) {
      bone.savedPosition.copy(bone.node.position);
      bone.savedQuaternion.copy(bone.node.quaternion);
      bone.savedScale.copy(bone.node.scale);
    }

    try {
      reactions?.update(
        delta,
        speaking ? 'speaking' : activity,
        moving
      );
    } finally {
      for (const bone of bones) {
        bone.node.position.copy(bone.savedPosition);
        bone.node.quaternion.copy(bone.savedQuaternion);
        bone.node.scale.copy(bone.savedScale);
      }
    }

    const t = animationTime;

    if (moving && t >= nextBlink) {
      blinkStarted = t;
      nextBlink = t + 3 + Math.random() * 4;
    }

    const progress = (t - blinkStarted) / 0.18;

    const blink =
      moving && progress >= 0 && progress <= 1
        ? Math.sin(progress * Math.PI)
        : 0;

    const mouth = speaking && moving
      ? 0.12 + Math.abs(Math.sin(t * 10)) * 0.38
      : 0;

    vrm.expressionManager?.setValue('blink', blink);
    vrm.expressionManager?.setValue('aa', mouth);
  }

  function animate(now) {
    if (!visible || !vrm || !renderer) return;

    const delta = Math.max(
      0,
      Math.min((now - previousFrame) / 1000, 0.05)
    );

    previousFrame = now;
    animationTime += delta;

    const moving = !reducedMotion.matches;

    const speaking =
      taraPlaying || activity === 'speaking';

    if (!moving && currentAction !== restAction) {
      motionRequest++;
      returnToRest(0);
    }

if (
  moving &&
  danceAudio &&
  danceAudioAction &&
  currentAction === danceAudioAction
) {
  const duration = danceAudioAction.getClip().duration;

  if (
    danceAudio.ended ||
    danceAudio.currentTime >= duration
  ) {
    motionRequest++;
    returnToRest();
  } else {
    danceAudioAction.time = Math.min(
      danceAudio.currentTime,
      duration
    );
  }
}

mixer?.update(moving ? delta : 0);

    if (
      mixer &&
      currentAction !== restAction &&
      mixer.time >= motionEndsAt
    ) {
      returnToRest();
    }

    updateExpressions(delta, speaking, moving);

    // Updates humanoid retargeting, expressions and the model's
    // existing spring bones, including supported hair physics.
    vrm.update(delta);

fitDanceCamera();

renderer.render(scene, camera);
  }

  const stageAPI = window.edenStage;

  if (stageAPI) {
    const previousActivity =
      stageAPI.activity?.bind(stageAPI);

    stageAPI.activity = next => {
      activity = next;
      previousActivity?.(next);
    };
  }

  const unsubscribePlayback =
    window.eden?.onTaraPlayback?.(playing => {
      taraPlaying = playing === true;
    });

  const humanCommand =
  /^(?:(?:show|use|activate|become|switch to|change to|return to|turn into|transform into)\s+)?(?:your\s+|the\s+|a\s+)?(?:human|avatar|vrm)(?:\s+form)?$|^show yourself$/i;

  const energyCommand =
  /^(?:(?:show|use|activate|switch to|change to|return to|go back to|turn into|transform into)\s+)?(?:your\s+|the\s+)?(?:energy|core|energy core)(?:\s+form)?$/i;

  function normalizeCommand(message) {
    return String(message || '')
      .trim()
      .replace(
        /^(?:(?:hey|hi|hello)[,\s]+)?(?:eden|aiden|hayden)\b[\s,.!?]*/i,
        ''
      )
      .replace(
        /^(?:(?:please|can you|could you|would you)\s+)+/i,
        ''
      )
      .replace(/[.!?]+$/, '')
      .trim();
  }

  function parseMotionCommand(text) {
  const dance = text.match(
  /^(?:dance(?:\s+(?:to|on))?|perform|show\s+(?:me\s+)?(?:the\s+)?|play\s+(?:the\s+)?)\s+(alfaaz|alfaz|alphaaz|alphaz|varoon|varun|varoun|waroon|warun)(?:\s+(?:dance|choreography|song))?$/i
);

if (dance) {
  const name = dance[1].toLowerCase();

  return /^(?:varoon|varun|varoun|waroon|warun)$/.test(name)
    ? 'varoon'
    : 'alfaaz';
}

  if (
    /^(?:stop dancing|stop the dance|stop dance)$/i.test(text)
  ) {
    return 'rest';
  }

  if (
    /^(?:wave(?: to me)?|wave hello|say hello|greet me|show (?:your |the )?greeting)$/i.test(text)
  ) {
    return 'greeting';
  }

  if (
    /^(?:show|make|do|give me)\s+(?:a\s+)?peace sign$/i.test(text)
  ) {
    return 'peace';
  }

  if (
    /^(?:spin|spin around|turn around|do a spin)$/i.test(text)
  ) {
    return 'spin';
  }

  if (
    /^(?:pose|strike a pose|show (?:me )?(?:a |your )?(?:model )?pose)$/i.test(text)
  ) {
    return 'pose';
  }

  if (
    /^(?:stop (?:the )?(?:gesture|animation)|stand normally|relax your arms)$/i.test(text)
  ) {
    return 'rest';
  }

  return null;
}

  

function validateGeneratedMotion(raw) {
  const ranges = {
    head: [[-20,20],[-35,35],[-18,18]],
    neck: [[-12,12],[-18,18],[-12,12]],
    spine: [[-12,18],[-18,18],[-12,12]],
    chest: [[-15,20],[-20,20],[-15,15]],
    upperChest: [[-10,12],[-12,12],[-10,10]],
    leftShoulder: [[-20,20],[-20,20],[-15,25]],
    rightShoulder: [[-20,20],[-20,20],[-25,15]],
    leftUpperArm: [[-70,70],[-65,65],[-12,135]],
    rightUpperArm: [[-70,70],[-65,65],[-135,12]],
    leftLowerArm: [[-20,20],[-135,12],[-20,20]],
    rightLowerArm: [[-20,20],[-12,135],[-20,20]],
    leftHand: [[-25,25],[-25,25],[-30,30]],
    rightHand: [[-25,25],[-25,25],[-30,30]]
  };

  const bodyRanges = {
    crouch: [0,0.4],
    bow: [-8,40],
    lean: [-12,12],
    turn: [-12,12],
    sway: [-0.08,0.08]
  };

  if (
    !raw ||
    typeof raw !== 'object' ||
    !Number.isFinite(raw.duration) ||
    raw.duration < 3 ||
    raw.duration > 20 ||
    !Array.isArray(raw.frames) ||
    raw.frames.length < 2 ||
    raw.frames.length > 40
  ) {
    throw new Error('Use a 3–20 second animation with 2–40 poses.');
  }

  const clamp = (value, range) =>
    Math.max(range[0], Math.min(range[1], value));

  let previousTime = 0;
  let moved = false;

  const held = {};
  const heldBody = {
    crouch: 0,
    bow: 0,
    lean: 0,
    turn: 0,
    sway: 0
  };

  for (const name of Object.keys(ranges)) {
    held[name] = [0,0,0];
  }

  const frames = raw.frames.map(frame => {
    if (
      !frame ||
      !Number.isFinite(frame.time) ||
      frame.time < previousTime + 0.15 ||
      frame.time > raw.duration - 0.4
    ) {
      throw new Error(
        'Pose times must increase and leave room to return to standing.'
      );
    }

    const joints = frame.joints ?? {};
    const body = frame.body ?? {};

    for (const map of [joints, body]) {
      if (
        !map ||
        typeof map !== 'object' ||
        Array.isArray(map)
      ) {
        throw new Error('Invalid pose data.');
      }
    }

    for (const [name, angles] of Object.entries(joints)) {
      if (!Object.hasOwn(ranges, name)) {
        throw new Error(
          'Unsupported joint: ' + name +
          '. Use body controls for hips and legs.'
        );
      }

      if (
        !Array.isArray(angles) ||
        angles.length !== 3 ||
        !angles.every(Number.isFinite)
      ) {
        throw new Error('Joint angles must be finite XYZ numbers.');
      }

      held[name] = angles.map(
        (angle, axis) => clamp(angle, ranges[name][axis])
      );
    }

    for (const [name, value] of Object.entries(body)) {
      if (
        !Object.hasOwn(bodyRanges, name) ||
        !Number.isFinite(value)
      ) {
        throw new Error('Invalid body control: ' + name);
      }

      heldBody[name] = clamp(value, bodyRanges[name]);
    }

    const pose = {};

    for (const [name, angles] of Object.entries(held)) {
      pose[name] = [...angles];

      if (angles.some(value => Math.abs(value) > 0.5)) {
        moved = true;
      }
    }

    if (
      Object.values(heldBody).some(
        value => Math.abs(value) > 0.001
      )
    ) {
      moved = true;
    }

    previousTime = frame.time;

    return {
      time: frame.time,
      joints: pose,
      body: { ...heldBody }
    };
  });

  if (!moved) {
    throw new Error('The generated animation contains no movement.');
  }

  return {
    version: 2,
    name: String(raw.name || 'Original movement')
      .replace(/[\x00-\x1f]/g, '')
      .slice(0, 70),
    duration: raw.duration,
    frames,
    emotion: [
      'happy', 'sad', 'angry',
      'relaxed', 'surprised', 'neutral'
    ].includes(raw.emotion) ? raw.emotion : null
  };
}


  // EDEN generated motion: data becomes bounded animation tracks.
  let generatedMotionEpoch = 0;
  let lastGeneratedMotion = null;
  let generatedMotionClip = null;

  function isGeneratedMotionCommand(message) {
    const text = normalizeCommand(message);
    if (
      /^(?:bend(?: down| forward)?|crouch|squat|bow|lean (?:left|right))(?:\s.*)?$/i
        .test(text)
    ) return true;

    // Preserve the existing imported dances and emotion commands.
    if (
      parseMotionCommand(text) !== null ||
      parseEmotionCommand(text) !== null
    ) return false;

    if (
      /^(?:repeat|replay) (?:your |the |my )?(?:last |own |generated )?animation$/i
        .test(text)
    ) return true;

    return /^(?:create|make|generate|invent|design|perform)\b/i
      .test(text) &&
      /\b(?:animation|gesture|reaction|dance|movement)\b/i
        .test(text);
  }

  
  // Continuous, bounded curves instead of stopping at every pose.
  function generatedCurve(times, values) {
    const slopes = values.slice(1).map(
      (value, index) =>
        (value - values[index]) /
        (times[index + 1] - times[index])
    );

    const tangent = values.map((value, index) => {
      if (!index || index === values.length - 1) return 0;

      const a = slopes[index - 1];
      const b = slopes[index];

      if (a * b <= 0) return 0;

      const h0 = times[index] - times[index - 1];
      const h1 = times[index + 1] - times[index];

      return 3 * (h0 + h1) /
        ((2 * h1 + h0) / a + (h1 + 2 * h0) / b);
    });

    return time => {
      let index = 0;

      while (
        index < times.length - 2 &&
        time > times[index + 1]
      ) index++;

      const h = times[index + 1] - times[index];

      const t = Math.max(
        0,
        Math.min(1, (time - times[index]) / h)
      );

      const t2 = t * t;
      const t3 = t2 * t;

      return (
        (2*t3 - 3*t2 + 1) * values[index] +
        (t3 - 2*t2 + t) * h * tangent[index] +
        (-2*t3 + 3*t2) * values[index + 1] +
        (t3 - t2) * h * tangent[index + 1]
      );
    };
  }

  async function buildGeneratedMotionClip(
    plan,
    cancelled = () => false
  ) {
    const frames = [
      { time: 0, joints: {}, body: {} },
      ...plan.frames,
      { time: plan.duration, joints: {}, body: {} }
    ];

    const frameTimes = frames.map(frame => frame.time);
    const bodyNames = ['crouch', 'bow', 'lean', 'turn', 'sway'];
    const curves = new Map();

    for (const name of bodyNames) {
      curves.set(
        name,
        generatedCurve(
          frameTimes,
          frames.map(frame => frame.body?.[name] || 0)
        )
      );
    }

    // Use an independent skeleton while calculating the animation.
    const clones = new Map();

    function cloneNode(node) {
      if (clones.has(node)) return clones.get(node);

      const copy = new THREE.Object3D();

      copy.position.copy(node.position);
      copy.quaternion.copy(node.quaternion);
      copy.scale.copy(node.scale);

      clones.set(node, copy);

      if (node.parent) cloneNode(node.parent).add(copy);

      return copy;
    }

    const rig = bones.map(bone => ({
      base: bone,
      node: cloneNode(bone.node),
      rotations: [],
      positions: []
    }));

    const byName = new Map();

    for (
      const [name, bone] of Object.entries(
        vrm.humanoid.normalizedHumanBones
      )
    ) {
      if (!bone?.node || !clones.has(bone.node)) continue;

      byName.set(name, clones.get(bone.node));

      for (let axis = 0; axis < 3; axis++) {
        curves.set(
          name + axis,
          generatedCurve(
            frameTimes,
            frames.map(frame => frame.joints[name]?.[axis] || 0)
          )
        );
      }
    }

    let root = rig[0]?.node;

    if (!root) {
      throw new Error('The avatar has no animation bones.');
    }

    while (root.parent) root = root.parent;

    const reset = () => {
      for (const item of rig) {
        item.node.position.copy(item.base.position);
        item.node.quaternion.copy(item.base.quaternion);
        item.node.scale.copy(item.base.scale);
      }

      root.updateMatrixWorld(true);
    };

    reset();

    const hips = byName.get('hips');

    const legs = ['left', 'right'].map(side => ({
      upper: byName.get(side + 'UpperLeg'),
      lower: byName.get(side + 'LowerLeg'),
      foot: byName.get(side + 'Foot')
    }));

    const hasLegs = hips &&
      legs.every(leg => leg.upper && leg.lower && leg.foot);

    const bodyRequested = plan.frames.some(frame =>
      bodyNames.some(name =>
        Math.abs(frame.body?.[name] || 0) > 0.001
      )
    );

    if (bodyRequested && !hasLegs) {
      throw new Error(
        'This avatar needs hips, knees and feet mapped for full-body movement.'
      );
    }

    const point = node =>
      node.getWorldPosition(new THREE.Vector3());

    const rotation = node =>
      node.getWorldQuaternion(new THREE.Quaternion());

    let legLength = 1;

    if (hasLegs) {
      for (const leg of legs) {
        leg.target = point(leg.foot);
        leg.flat = rotation(leg.foot);

        leg.length =
          point(leg.upper).distanceTo(point(leg.lower)) +
          point(leg.lower).distanceTo(leg.target);
      }

      legLength = (legs[0].length + legs[1].length) / 2;
    }

    const hipBase = hips
      ? rotation(hips)
      : new THREE.Quaternion();

    const forward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(hipBase).normalize();

    const right = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(hipBase).normalize();

    const up = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(hipBase).normalize();

    function worldRotation(node, quaternion) {
      const parent = node.parent
        ? rotation(node.parent).invert()
        : new THREE.Quaternion();

      node.quaternion.copy(
        parent.multiply(quaternion)
      ).normalize();

      root.updateMatrixWorld(true);
    }

    function aim(node, from, to) {
      if (
        from.lengthSq() < 1e-10 ||
        to.lengthSq() < 1e-10
      ) return;

      const delta = new THREE.Quaternion()
        .setFromUnitVectors(from.normalize(), to.normalize());

      worldRotation(
        node,
        delta.multiply(rotation(node))
      );
    }

    // Two-bone leg solver keeps the ankle at its standing target.
    function plant(leg) {
      const hip = point(leg.upper);
      const kneeNow = point(leg.lower);
      const ankleNow = point(leg.foot);

      const upperLength = hip.distanceTo(kneeNow);
      const lowerLength = kneeNow.distanceTo(ankleNow);

      const direction = leg.target.clone().sub(hip);

      const distance = Math.max(
        Math.abs(upperLength - lowerLength) + 1e-6,
        Math.min(
          upperLength + lowerLength - 1e-6,
          direction.length()
        )
      );

      direction.normalize();

      const pole = forward.clone().addScaledVector(
        direction,
        -forward.dot(direction)
      );

      if (pole.lengthSq() < 1e-8) {
        pole.copy(right).addScaledVector(
          direction,
          -right.dot(direction)
        );
      }

      pole.normalize();

      const along = (
        upperLength * upperLength -
        lowerLength * lowerLength +
        distance * distance
      ) / (2 * distance);

      const bend = Math.sqrt(
        Math.max(0, upperLength * upperLength - along * along)
      );

      const kneeTarget = hip.clone()
        .addScaledVector(direction, along)
        .addScaledVector(pole, bend);

      aim(
        leg.upper,
        kneeNow.clone().sub(hip),
        kneeTarget.sub(hip)
      );

      const newKnee = point(leg.lower);

      aim(
        leg.lower,
        point(leg.foot).sub(newKnee),
        leg.target.clone().sub(newKnee)
      );

      worldRotation(leg.foot, leg.flat.clone());
    }

    const times = [];
    const radians = Math.PI / 180;
    const sampleCount = Math.ceil(plan.duration * 30);

    for (let index = 0; index <= sampleCount; index++) {
      if (cancelled()) throw new Error('Animation cancelled.');

      const time = plan.duration * index / sampleCount;

      reset();

      const crouch = curves.get('crouch')(time);
      const bow = curves.get('bow')(time) + crouch * 12;
      const lean = curves.get('lean')(time);
      const turn = curves.get('turn')(time);
      const sway = curves.get('sway')(time);

      for (const [name, node] of byName) {
        const x = curves.get(name + '0')?.(time) || 0;
        const y = curves.get(name + '1')?.(time) || 0;
        const z = curves.get(name + '2')?.(time) || 0;

        let bendX = 0;
        let bendZ = 0;

        if (name === 'spine') {
          bendX = bow * .35;
          bendZ = lean * .4;
        }

        if (name === 'chest') {
          bendX = bow * (
            byName.has('upperChest') ? .45 : .65
          );
          bendZ = lean * .6;
        }

        if (name === 'upperChest') bendX = bow * .2;
        if (name === 'head') bendX = -bow * .15;

        node.quaternion.multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              (x + bendX) * radians,
              y * radians,
              (z + bendZ) * radians,
              'XYZ'
            )
          )
        ).normalize();
      }

      if (hasLegs) {
        hips.quaternion.multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(0, turn * radians, 0)
          )
        );

        root.updateMatrixWorld(true);

        const support =
          Math.sin(bow * radians) ** 2 * .03 +
          Math.sin(turn * radians) ** 2 * .02 +
          sway * sway * 2;

        const hipPosition = point(hips)
          .addScaledVector(up, -(crouch + support) * legLength)
          .addScaledVector(right, sway * legLength)
          .addScaledVector(
            forward,
            -(Math.sin(bow * radians) * .08 + crouch * .12) *
              legLength
          );

        hips.position.copy(
          hips.parent
            ? hips.parent.worldToLocal(hipPosition)
            : hipPosition
        );

        root.updateMatrixWorld(true);

        if (
          Math.abs(crouch) +
          Math.abs(bow) +
          Math.abs(lean) +
          Math.abs(turn) +
          Math.abs(sway) > 1e-7
        ) {
          legs.forEach(plant);
        }
      }

      times.push(time);

      for (const item of rig) {
        item.rotations.push(...item.node.quaternion.toArray());
        item.positions.push(...item.node.position.toArray());
      }

      if (index % 20 === 19) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const tracks = [];

    for (const item of rig) {
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          item.base.node.uuid + '.quaternion',
          times,
          item.rotations
        )
      );

      tracks.push(
        new THREE.VectorKeyframeTrack(
          item.base.node.uuid + '.position',
          times,
          item.positions
        )
      );
    }

    return new THREE.AnimationClip(
      'EDEN generated: ' + plan.name,
      plan.duration,
      tracks
    );
  }

  function cancelGeneratedMotion() {
    outfitCommandEpoch++;
    wardrobe?.cancel();
    reactorTransformation.cancel();
    generatedMotionEpoch++;
    motionRequest++;
    formTransitionRequest++;
    formTransition.cancel();

    returnToRest(0.25);

    danceCameraActive = false;
    danceBounds.makeEmpty();
    exitDanceView();
  }

  const unsubscribeGeneratedStop =
    window.eden?.onInterrupted?.(cancelGeneratedMotion);

  const generatedEscape = event => {
    if (event.key === 'Escape') cancelGeneratedMotion();
  };

  window.addEventListener('keydown', generatedEscape);

  window.addEventListener('beforeunload', () => {
    unsubscribeGeneratedStop?.();
    window.removeEventListener('keydown', generatedEscape);
  });

  async function performGeneratedMotion(message) {
    const epoch = ++generatedMotionEpoch;

    const cancelled = () =>
      epoch !== generatedMotionEpoch;

    if (reducedMotion.matches) {
      return 'Reduce Motion is enabled, so generated gestures are paused.';
    }

    const repeating = /^(?:repeat|replay)\b/i.test(
      normalizeCommand(message)
    );

    if (repeating && !lastGeneratedMotion) {
      return 'Create an animation first, then ask me to repeat it.';
    }

    try {
      desiredForm = 'human';

      await loadAvatar();

      if (cancelled()) return 'Animation cancelled.';

      const transformed = await transformForm(true);

      if (
        cancelled() ||
        !transformed ||
        desiredForm !== 'human'
      ) {
        return 'Animation cancelled.';
      }

      let plan = lastGeneratedMotion;

      if (!repeating) {
        const result = await window.eden.generateMotion(message);

        if (cancelled() || result?.cancelled) {
          return 'Animation cancelled.';
        }

        plan = validateGeneratedMotion(result?.plan);
      }

      if (
        cancelled() ||
        !visible ||
        desiredForm !== 'human' ||
        reducedMotion.matches
      ) {
        return 'Animation cancelled.';
      }

      const previous = currentAction;

      returnToRest(0);
      previous?.stop();
      mixer.update(0);

      if (generatedMotionClip) {
        mixer.uncacheClip(generatedMotionClip);
      }

      generatedMotionClip = await buildGeneratedMotionClip(
        plan,
        cancelled
      );

      if (
        cancelled() ||
        reducedMotion.matches ||
        !visible ||
        desiredForm !== 'human'
      ) {
        mixer.uncacheClip(generatedMotionClip);
        return 'Animation cancelled.';
      }

      stage.setAttribute(
        'data-generated-motion',
        'EDEN · Original movement · Say stop or press Esc'
      );

      const action = mixer.clipAction(generatedMotionClip);

      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(1);
      action.play();
      action.crossFadeFrom(restAction, 0.2, false);

      currentAction = action;
      motionEndsAt = mixer.time + plan.duration;
      lastGeneratedMotion = plan;

      if (plan.emotion) {
        reactions?.setEmotion(plan.emotion, plan.duration);
      }

      return repeating
        ? 'Replaying my generated gesture.'
        : 'Here is my new generated movement.';
    } catch (error) {
      if (cancelled()) return 'Animation cancelled.';

      return 'I couldn’t create that animation. ' +
        error.message;
    }
  }


  function reactorTransformationTargets() {
    if (!vrm || !camera) return null;
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const rect = stage.getBoundingClientRect();
    const project = point => {
      point.project(camera);
      return {
        x: (point.x + 1) * rect.width / 2,
        y: (1 - point.y) * rect.height / 2
      };
    };
    const joints = {};
    for (const name of [
      'head','neck','hips','leftUpperArm','rightUpperArm',
      'leftLowerArm','rightLowerArm','leftHand','rightHand',
      'leftUpperLeg','rightUpperLeg','leftLowerLeg','rightLowerLeg',
      'leftFoot','rightFoot'
    ]) {
      const node = vrm.humanoid.getRawBoneNode(name);
      if (node) joints[name] = project(node.getWorldPosition(new THREE.Vector3()));
    }
    const node = vrm.humanoid.getRawBoneNode('upperChest') ||
      vrm.humanoid.getRawBoneNode('chest');
    let chest = null;
    if (node) {
      const point = node.getWorldPosition(new THREE.Vector3());
      const height = standingBounds?.getSize(new THREE.Vector3()).y || 1.6;
      point.y += height * .012;
      chest = project(point);
    }
    return {
      joints, chest,
      points: sampleAvatarParticles().map(point => ({
        x: point.x - rect.left,
        y: point.y - rect.top
      }))
    };
  }

  async function performOutfitCommand(request) {
    const epoch = ++outfitCommandEpoch;
    reactorTransformation.cancel();
    const cancelled = () => epoch !== outfitCommandEpoch;
    const motion = request.motionText
      ? parseMotionCommand(request.motionText)
      : null;

    if (request.motionText && !motion) {
      return 'Which imported dance should I use? Try Alfaaz or Varoon.';
    }

    generatedMotionEpoch++;
    motionRequest++;
    desiredForm = 'human';

    try {
      await loadAvatar();
      if (cancelled() || desiredForm !== 'human') return 'Outfit change cancelled.';

      if (wardrobe.outfit !== request.outfit || !visible) {
        const from = visible ? 'human' : 'energy';
        formTransitionRequest++;
        formTransition.cancel();
        returnToRest(0);
        mixer?.update(0);
        danceCameraActive = false;
        danceBounds.makeEmpty();
        exitDanceView();
        resize();

        // Prepare the hidden meshes first, then switch during the assembly effect.
        await wardrobe.prepareOutfit(request.outfit);
        if (cancelled() || desiredForm !== 'human') return 'Outfit change cancelled.';

        const completed = await reactorTransformation.play({
          from,
          to: request.outfit,
          isCancelled: () => cancelled() || desiredForm !== 'human',
          getTargets: reactorTransformationTargets,
          begin: async () => {
            if (cancelled() || desiredForm !== 'human') return null;
            const reveal = await wardrobe.beginReveal(request.outfit, {
              renderer, camera, fromEnergy: from === 'energy'
            });
            if (!reveal || cancelled() || desiredForm !== 'human') {
              reveal?.cancel();
              return null;
            }
            setVisible(true);
            resize();
            return reveal;
          },
          onCancel: () => {
            if (from === 'energy') setVisible(false);
          }
        });
        if (!completed || cancelled() || wardrobe.outfit !== request.outfit) {
          return 'Outfit change cancelled.';
        }
      } else {
        const changed = await wardrobe.setOutfit(request.outfit);
        if (!changed || cancelled()) return 'Outfit change cancelled.';
        const completed = await transformForm(true);
        if (!completed || cancelled() || desiredForm !== 'human') {
          return 'Outfit change cancelled.';
        }
      }

      if (motion) {
        const played = await playMotion(motion);
        if (!played || cancelled()) {
          return reducedMotion.matches
            ? 'The outfit is selected. Reduce Motion is enabled, so gestures are paused.'
            : 'The performance was cancelled.';
        }
        return motions[motion].reply +
          (request.outfit === 'reactor'
            ? ' Wearing my reactor outfit.'
            : ' Wearing my original outfit.');
      }

      return request.outfit === 'reactor'
        ? 'My reactor outfit is on.'
        : 'Back in my original outfit.';
    } catch (error) {
      if (cancelled()) return 'Outfit change cancelled.';
      console.error('EDEN wardrobe:', error);
      return 'I could not change the outfit. ' + error.message;
    }
  }

window.edenAvatar = {
    isFormCommand(message) {
      const text = normalizeCommand(message);
      if (parseOutfitCommand(text)) return true;
      if (isGeneratedMotionCommand(text)) return true;

      return humanCommand.test(text) ||
        energyCommand.test(text) ||
        parseMotionCommand(text) !== null ||
        parseEmotionCommand(text) !== null;
    },

    reactToMessage(message) {
      const text = normalizeCommand(message);

      // Hair-touching needs its own animation clip.
      if (parseEmotionCommand(text) === 'hair') return;

      reactions?.reactToMessage(message);
    },

    async handleCommand(message) {
      const text = normalizeCommand(message);
      const outfitRequest = parseOutfitCommand(text);
      if (outfitRequest) return performOutfitCommand(outfitRequest);
      outfitCommandEpoch++;
      wardrobe?.cancel();
      reactorTransformation.cancel();
      if (isGeneratedMotionCommand(text)) return performGeneratedMotion(text);
      generatedMotionEpoch++;
      const requestedMotion = parseMotionCommand(text);
      if (requestedMotion && requestedMotion !== 'rest') {
        return 'Imported performances are not included in this version. '
          + 'You can ask me to create a new animation instead.';
      }

      const requestedEmotion = parseEmotionCommand(text);

      if (energyCommand.test(text)) {
  desiredForm = 'energy';

  const completed = await transformForm(false);

  return completed
    ? 'Energy form is active.'
    : 'The form change was superseded.';
}

      if (
        !humanCommand.test(text) &&
        !requestedMotion &&
        !requestedEmotion
      ) {
        return null;
      }

      if (requestedEmotion === 'hair') {
        return 'I need a hair-touch animation clip for that movement.';
      }

      desiredForm = 'human';

      try {
        await loadAvatar();

        if (desiredForm !== 'human') {
          return 'Energy form is active.';
        }

        const wasVisible = visible;

const completed = await transformForm(true);

if (!completed || desiredForm !== 'human') {
  return 'The form change was superseded.';
}

        if (requestedMotion === 'rest') {
          motionRequest++;
          returnToRest();
          return 'Back to my relaxed pose.';
        }

        if (requestedMotion) {
          try {
            const played = await playMotion(
              requestedMotion
            );

            if (!played) {
              return reducedMotion.matches
                ? 'Reduce Motion is enabled, so gestures are paused.'
                : 'The gesture was cancelled.';
            }

            return motions[requestedMotion].reply;
          } catch (error) {
            console.error('EDEN avatar motion:', error);

            const motion = motions[requestedMotion];
const folder = motion.audio ? 'dances' : 'vrma';

return 'I couldn’t start the performance. ' +
  error.message +
  ' Check the files inside src/renderer/' + folder + '.';
          }
        }

        if (requestedEmotion) {
          reactions?.setEmotion(requestedEmotion);

          const replies = {
            happy: 'Here’s a smile.',
            angry: 'Showing my angry expression.',
            sad: 'Showing my sad expression.',
            relaxed: 'Looking relaxed.',
            surprised: 'Showing my surprised expression.',
            neutral: 'Back to my usual expression.',
            jealous: 'A little jealous look, just for you.'
          };

          return replies[requestedEmotion] ||
            'Expression updated.';
        }

        // Greet once when appearing, rather than repeatedly
        // triggering gestures during every spoken response.
        if (!wasVisible && !reducedMotion.matches) {
          void playMotion('greeting').catch(error => {
            console.warn(
              'EDEN greeting could not load:',
              error.message
            );
          });
        }

        return 'Human form is active.';
      } catch (error) {
        formTransitionRequest++;
formTransition.cancel();

setVisible(false);
console.error('EDEN VRM:', error);

        return 'I couldn’t load my human form. Check the avatar error in the console.';
      }
    }
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);

  window.addEventListener('beforeunload', () => {
    motionRequest++;
    formTransitionRequest++;
formTransition.dispose();
    reactorTransformation.dispose();
    stopDanceAudio();
    resizeObserver.disconnect();
    unsubscribePlayback?.();

    renderer?.setAnimationLoop(null);
    wardrobe?.dispose();
    wardrobe = null;

    if (mixer) {
      mixer.stopAllAction();

      if (vrm) {
        mixer.uncacheRoot(vrm.scene);
      }
    }

    if (vrm) {
      VRMUtils.deepDispose(vrm.scene);
    }

    renderer?.dispose();
  });
})();