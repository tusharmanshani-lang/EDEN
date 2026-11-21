
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

module.exports = { validateGeneratedMotion };
