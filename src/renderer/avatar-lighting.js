// A separate original-outfit profile avoids washing out its pale skin textures.
// The reactor profile restores the exact lighting present before this adjustment.
export function createOutfitLightingProfile({ renderer, hemisphere, key, rim, lower, soft }) {
  const lights = { hemisphere, key, rim, lower, soft };
  const baseline = new Map();
  for (const light of Object.values(lights)) {
    if (!light) continue;
    baseline.set(light, {
      intensity: light.intensity,
      color: light.color?.clone(),
      groundColor: light.groundColor?.clone()
    });
  }
  const exposure = renderer.toneMappingExposure;
  const original = { hemisphere: .58, key: .72, rim: .16, lower: .12, soft: .12 };

  return outfit => {
    for (const [light, values] of baseline) {
      light.intensity = values.intensity;
      if (values.color) light.color.copy(values.color);
      if (values.groundColor) light.groundColor.copy(values.groundColor);
    }
    renderer.toneMappingExposure = exposure;
    if (outfit === 'reactor') return;

    for (const [name, intensity] of Object.entries(original)) {
      if (lights[name]) lights[name].intensity = intensity;
    }
    hemisphere?.color.setHex(0xfff4ec);
    hemisphere?.groundColor.setHex(0x6d6870);
    key?.color.setHex(0xfff1e7);
    lower?.color.setHex(0xfff4ec);
    soft?.color.setHex(0xfff3e9);
    renderer.toneMappingExposure = exposure * .95;
  };
}
