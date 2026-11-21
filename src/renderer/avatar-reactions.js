import * as THREE from 'three';

export function parseEmotionCommand(text) {
  const value = String(text || '').trim().toLowerCase();

  const commands = {
    smile: 'happy',
    'give me a smile': 'happy',
    'stop smiling': 'neutral',
    'reset your expression': 'neutral',
    'play with your hair': 'hair',
    'touch your hair': 'hair',
    'fix your hair': 'hair',
    'adjust your hair': 'hair'
  };

  if (commands[value]) return commands[value];

  return value.match(
    /^(?:look|act|be|feel|show(?: me)?(?: your)?)\s+(happy|angry|sad|relaxed|surprised|neutral|jealous)(?:\s+(?:face|expression|reaction))?$/
  )?.[1] || null;
}

export function createAvatarReactions(vrm) {
  const bones = new Map();

  const names = [
    'head', 'neck', 'spine', 'chest',
    'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand'
  ];

  for (const name of names) {
    const node = vrm.humanoid.getNormalizedBoneNode(name);

    if (node) {
      bones.set(name, {
        node,
        base: node.quaternion.clone(),
        current: node.quaternion.clone()
      });
    }
  }

  const rotation = new THREE.Euler();
  const offset = new THREE.Quaternion();
  const target = new THREE.Quaternion();

  const weights = {
    happy: 0.08,
    angry: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0
  };

  let emotion = 'neutral';
  let emotionUntil = 0;
  let elapsed = 0;
  let state = 'idle';
  let stateSince = 0;
  let hairStarted = -100;
  let nextHairGesture = 12;
  let hairAmount = 0;

  function startHairGesture() {
    hairStarted = elapsed;
    nextHairGesture = elapsed + 25 + Math.random() * 20;
  }

  function setEmotion(next, seconds = 12) {
    if (next === 'hair') {
      startHairGesture();
      return;
    }

    if (![
      'happy', 'angry', 'sad', 'relaxed',
      'surprised', 'neutral', 'jealous'
    ].includes(next)) {
      return;
    }

    emotion = next;
    emotionUntil = elapsed + seconds;
  }

  function reactToMessage(message) {
    const text = String(message || '').toLowerCase();

    if (
      /\b(?:don't|do not|stop being)\s+(?:be\s+)?(?:angry|sad|jealous)\b/.test(text)
    ) {
      setEmotion('neutral');
    } else if (/\bjealous(?:y)?\b/.test(text)) {
      setEmotion('jealous');
    } else if (/\b(?:angry|furious)\b/.test(text)) {
      setEmotion('angry');
    } else if (/\b(?:sad|upset|heartbroken)\b/.test(text)) {
      setEmotion('sad');
    } else if (/\b(?:surprised|amazing|wow)\b/.test(text)) {
      setEmotion('surprised', 5);
    } else if (/\b(?:happy|smile|joke|funny|thank you|love you)\b/.test(text)) {
      setEmotion('happy');
    } else if (/\b(?:relax|calm)\b/.test(text)) {
      setEmotion('relaxed');
    }
  }

  function pose(name, x, y, z, amount) {
    const bone = bones.get(name);
    if (!bone) return;

    rotation.set(x, y, z);
    offset.setFromEuler(rotation);
    target.copy(bone.base).multiply(offset);

    bone.current.slerp(target, amount);
    bone.node.quaternion.copy(bone.current);
  }

  function smoothStep(value) {
    const clamped = THREE.MathUtils.clamp(value, 0, 1);
    return clamped * clamped * (3 - 2 * clamped);
  }

  function update(delta, nextState, moving) {
    elapsed += delta;

    if (state !== nextState) {
      state = nextState;
      stateSince = elapsed;
    }

    if (elapsed > emotionUntil) emotion = 'neutral';

    const smoothing = moving ? 1 - Math.exp(-delta * 5) : 1;
    const speaking = moving && state === 'speaking' ? 1 : 0;
    const listening = state === 'listening' ? 1 : 0;
    const thinking = state === 'thinking' ? 1 : 0;
    const t = moving ? elapsed : 0;

    const targetWeights = {
      happy: emotion === 'happy' ? 0.65 : 0.08,
      angry: emotion === 'angry' ? 0.6 : 0,
      sad: emotion === 'sad' ? 0.6 : 0,
      relaxed: emotion === 'relaxed' ? 0.5 : 0,
      surprised: emotion === 'surprised' ? 0.65 : 0
    };

    if (emotion === 'jealous') {
      targetWeights.happy = 0.08;
      targetWeights.angry = 0.25;
      targetWeights.sad = 0.12;
    }

    for (const name of Object.keys(weights)) {
      weights[name] += (targetWeights[name] - weights[name]) *
        smoothing;

      vrm.expressionManager?.setValue(name, weights[name]);
    }

    // Occasionally adjust her hair while she is idle.
    if (
      moving &&
      state === 'idle' &&
      emotion === 'neutral' &&
      elapsed >= nextHairGesture
    ) {
      startHairGesture();
    }

    const hairTime = elapsed - hairStarted;
    const hairTarget = moving && hairTime >= 0 && hairTime < 5
      ? smoothStep(hairTime / 1.4) *
        (1 - smoothStep((hairTime - 3.4) / 1.6))
      : 0;

    hairAmount += (hairTarget - hairAmount) * smoothing;

    // Uneven gesture rhythm with rests, rather than constant swinging.
    const rightBeat = speaking *
      Math.pow(Math.max(0, Math.sin(t * 1.65)), 2);

    const leftBeat = speaking *
      Math.pow(Math.max(0, Math.sin(t * 1.3 + 2.1)), 3) * 0.7;

    const jealous = emotion === 'jealous' ? 1 : 0;
    const sad = emotion === 'sad' ? 1 : 0;
    const happy = emotion === 'happy' ? 1 : 0;

    const listeningNod = moving
      ? listening * Math.exp(-(elapsed - stateSince) * 2.5) *
        Math.sin((elapsed - stateSince) * 7) * 0.055
      : 0;

    pose(
      'head',
      0.055 * sad + listeningNod +
        (moving ? Math.sin(t * 1.1) * 0.012 : 0),
      0.16 * jealous - 0.06 * hairAmount +
        (moving ? Math.sin(t * 0.55) * 0.035 : 0),
      0.045 * listening - 0.04 * happy + 0.055 * hairAmount,
      smoothing
    );

    pose('neck', -0.02 * thinking, 0, 0, smoothing);

    pose(
      'spine',
      moving ? Math.sin(t * 1.5) * 0.008 : 0,
      0.025 * jealous,
      moving ? Math.sin(t * 0.6) * 0.009 : 0,
      smoothing
    );

    pose(
      'chest',
      -0.015 * speaking,
      moving ? Math.sin(t * 0.75) * speaking * 0.018 : 0,
      0,
      smoothing
    );

    // The base pose already has the upper arms lowered.
    // Bend the elbows forward even when resting.
    const rightUpper = [
      -0.1 * rightBeat,
      -0.08 * rightBeat,
      -0.32 * rightBeat
    ];

    const rightElbow = [
      0,
      0.35 + 0.55 * rightBeat,
      0.18 + 0.18 * rightBeat
    ];

    const rightWrist = [
      0.08 * rightBeat,
      0.18 * rightBeat,
      -0.12 * rightBeat
    ];

    // Raise and fold the right arm toward the side of her hair.
    const hairUpper = [0.02, 0.12, -1.5];
    const hairElbow = [0, 0.12, -1.85];
    const hairWrist = [
      0.15,
      0.15,
      moving ? -0.18 + Math.sin(t * 2.5) * 0.045 : -0.18
    ];

    for (let index = 0; index < 3; index++) {
      rightUpper[index] = THREE.MathUtils.lerp(
        rightUpper[index], hairUpper[index], hairAmount
      );

      rightElbow[index] = THREE.MathUtils.lerp(
        rightElbow[index], hairElbow[index], hairAmount
      );

      rightWrist[index] = THREE.MathUtils.lerp(
        rightWrist[index], hairWrist[index], hairAmount
      );
    }

    pose('rightUpperArm', ...rightUpper, smoothing);
    pose('rightLowerArm', ...rightElbow, smoothing);
    pose('rightHand', ...rightWrist, smoothing);

    pose(
      'leftUpperArm',
      -0.07 * leftBeat,
      0.05 * jealous,
      0.22 * leftBeat + 0.07 * jealous,
      smoothing
    );

    pose(
      'leftLowerArm',
      0,
      -0.3 - 0.45 * leftBeat,
      -0.16 - 0.14 * leftBeat,
      smoothing
    );

    pose(
      'leftHand',
      0.06 * leftBeat,
      -0.12 * leftBeat,
      0.09 * leftBeat,
      smoothing
    );
  }

  return { setEmotion, reactToMessage, update };
}