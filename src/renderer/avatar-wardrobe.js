import { createNanotechReveal } from './nanotech-reveal.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const outfitName = '(reactor|arc reactor|black|tony stark|original|default|normal|usual|previous|old|white)';
const outfitTail = '(?:\\s+(?:outfit|suit|mode|costume|armor|armour|clothes|clothing|look|dress))?';
const outfitPrefix = '(?:(?:your|the|my)\\s+)?';
const identify = name => /^(?:original|default|normal|usual|previous|old|white)$/i.test(name)
  ? 'original' : 'reactor';

export function parseOutfitCommand(input) {
  const text = String(input || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    // Speech recognition and pasted commands can leave an unmatched closing quote.
    .replace(/[.!?,;:"'“”‘’]+$/gu, '')
    .trim();
  const direct = text.match(new RegExp(
    '^(?:wear|put on|transform into|activate|equip|shift to|shift into|switch to|switch into|switch back to|change into|change to|change back to|return to|go back to|use|show)' +
    '\\s+' + outfitPrefix + outfitName + outfitTail + '$', 'i'
  ));
  if (direct) return { outfit: identify(direct[1]), motionText: null };

  const reversed = text.match(new RegExp(
    '^(?:change|switch)\\s+' + outfitPrefix +
    '(?:outfit|suit|clothes|clothing)\\s+(?:back\\s+)?to\\s+' +
    outfitPrefix + outfitName + outfitTail + '$', 'i'
  ));
  if (reversed) return { outfit: identify(reversed[1]), motionText: null };


  const combined = text.match(new RegExp(
    '^(.+?)\\s+(?:in|wearing)\\s+' + outfitPrefix + outfitName + outfitTail + '$', 'i'
  ));
  if (combined && /^(?:dance|perform|play|wave|spin|pose|show)\b/i.test(combined[1])) {
    return { outfit: identify(combined[2]), motionText: combined[1].trim() };
  }
  return null;
}

// Move only the Body meshes onto the avatar's existing raw skeleton.
// Animation tracks and facial-expression references keep their original nodes.
export function bindOutfitBody(body, activeScene) {
  const activeBones = new Map();
  activeScene.traverse(node => {
    if (node.isBone && node.name) {
      if (activeBones.has(node.name)) throw new Error('Duplicate avatar bone name.');
      activeBones.set(node.name, node);
    }
  });

  const copy = body.clone(true);
  const skeletons = new Map();
  let meshCount = 0;
  copy.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    meshCount++;
    const original = mesh.skeleton;
    let skeleton = skeletons.get(original);
    if (!skeleton) {
      const bones = original.bones.map(bone => {
        const active = activeBones.get(bone.name);
        if (!active) throw new Error('Outfit bone is missing: ' + bone.name);
        return active;
      });
      skeleton = new THREE.Skeleton(
        bones, original.boneInverses.map(matrix => matrix.clone())
      );
      skeletons.set(original, skeleton);
    }
    mesh.bind(skeleton, mesh.bindMatrix.clone());
    mesh.frustumCulled = false;
  });
  if (!meshCount) throw new Error('The outfit contains no skinned body meshes.');
  return { body: copy, skeletons: [...skeletons.values()] };
}

async function readOutfit(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not read the reactor outfit.');
  const bytes = await response.arrayBuffer();
  const view = new DataView(bytes);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('The outfit is not a valid VRM file.');
  }
  let data;
  let binary;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.byteLength) throw new Error('Incomplete outfit file.');
    if (type === 0x4e4f534a) {
      data = JSON.parse(new TextDecoder().decode(bytes.slice(start, start + length)));
    }
    if (type === 0x004e4942) binary = bytes.slice(start, start + length);
    offset = start + length;
  }
  if (!data || !binary) throw new Error('Outfit data is missing.');
  const asURL = (bytes, type) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Texture decoding failed.'));
    reader.readAsDataURL(new Blob([bytes], { type }));
  });
  await Promise.all((data.images || []).map(async image => {
    if (image.bufferView === undefined) return;
    const buffer = data.bufferViews[image.bufferView];
    if (buffer.buffer !== 0) throw new Error('External outfit texture buffer.');
    const offset = buffer.byteOffset || 0;
    image.uri = await asURL(
      binary.slice(offset, offset + buffer.byteLength), image.mimeType || 'image/png'
    );
    delete image.bufferView;
  }));
  data.buffers[0].uri = await asURL(
    binary.slice(0, data.buffers[0].byteLength), 'application/octet-stream'
  );
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(JSON.stringify(data), new URL('./', url).href);
  return gltf;
}

function syncOutfitTheme(name) {
  if (typeof document !== 'undefined') {
    document.body?.classList.toggle('eden-reactor-theme', name === 'reactor');
  }
}

function applyReactorPalette(body) {
  const seen = new Set();
  body.traverse(mesh => {
    for (const material of [].concat(mesh.material || [])) {
      if (seen.has(material)) continue;
      seen.add(material);
      const name = String(material.name || '');
      let lit;
      let shade;
      if (name.includes('EDEN fitted black')) {
        lit = 0x202630; shade = 0x0b1018;
      } else if (name.includes('EDEN tapered charcoal')) {
        lit = 0x252e3a; shade = 0x0d141e;
      } else if (name.includes('EDEN black knit socks')) {
        lit = 0x10161e; shade = 0x06090e;
      } else if (name.includes('EDEN dark ribbed')) {
        lit = 0x141c27; shade = 0x070b12;
      }
      if (lit !== undefined) {
        // Hex colours are sRGB; Three converts them to linear shader values.
        material.color?.setHex(lit);
        material.shadeColorFactor?.setHex(shade);
        material.needsUpdate = true;
      }
      if (name.includes('EDEN reactor cyan') || name.includes('EDEN reactor ice-white')) {
        material.toneMapped = false;
        if (typeof material.emissiveIntensity === 'number') {
          material.emissiveIntensity = 1.25;
        }
        material.needsUpdate = true;
      }
    }
  });
}

export function createAvatarWardrobe({ vrm, baseURL, loadAsset = readOutfit, onOutfitChanged = () => {} }) {
  const original = vrm.scene.getObjectByName('Body');
  if (!original?.parent) throw new Error('The original Body group was not found.');
  const parent = original.parent;
  let current = original;
  let selected = 'original';
  onOutfitChanged('original');
  syncOutfitTheme('original');
  let asset = null;
  let reactor = null;
  let loading = null;
  let epoch = 0;
  let disposed = false;
  let ownedSkeletons = [];
  let activeReveal = null;

  async function prepare() {
    if (reactor) return reactor;
    if (loading) return loading;
    loading = (async () => {
      const loaded = await loadAsset(new URL('./eden-reactor.vrm', baseURL).href);
      if (disposed) {
        VRMUtils.deepDispose(loaded.scene);
        throw new Error('Outfit loading was cancelled.');
      }
      try {
        const body = loaded.scene.getObjectByName('Body');
        if (!body) throw new Error('Reactor Body group was not found.');
        const result = bindOutfitBody(body, vrm.scene);
        applyReactorPalette(result.body);
        asset = loaded;
        reactor = result.body;
        ownedSkeletons = result.skeletons;
        return reactor;
      } catch (error) {
        VRMUtils.deepDispose(loaded.scene);
        throw error;
      }
    })();
    try { return await loading; }
    finally { loading = null; }
  }

  return {
    cancel() {
      epoch++;
      activeReveal?.cancel();
      activeReveal = null;
    },
    async beginReveal(name, { renderer, camera, fromEnergy = false }) {
      if (!['original', 'reactor'].includes(name)) throw new Error('Unknown outfit.');
      activeReveal?.cancel();
      activeReveal = null;
      const request = ++epoch;
      const next = name === 'original' ? original : await prepare();
      if (disposed || request !== epoch) return null;
      activeReveal = createNanotechReveal({
        vrm, source: current, target: next, renderer, camera, fromEnergy, to: name,
        onCommit: () => {
          activeReveal = null;
          return this.setOutfit(name);
        }
      });
      return activeReveal;
    },
    async prepareOutfit(name) {
      if (disposed) throw new Error('The wardrobe has been disposed.');
      if (name === 'original') return original;
      if (name === 'reactor') return prepare();
      throw new Error('Unknown outfit.');
    },
    async setOutfit(name) {
      if (!['original', 'reactor'].includes(name)) throw new Error('Unknown outfit.');
      activeReveal?.cancel();
      activeReveal = null;
      const request = ++epoch;
      const next = name === 'original' ? original : await prepare();
      if (disposed || request !== epoch) return false;
      if (next !== current) {
        current.removeFromParent();
        parent.add(next);
        current = next;
      }
      next.visible = true;
      vrm.scene.updateMatrixWorld(true);
      const inactive = name === 'reactor' ? original : reactor;
      const attached = next.parent === parent &&
        vrm.scene.getObjectByProperty('uuid', next.uuid) === next;
      if (!attached || (inactive && inactive.parent === parent)) {
        throw new Error('The outfit switch was not verified.');
      }
      selected = name;
      onOutfitChanged(name);
      syncOutfitTheme(name);
      console.info('EDEN wardrobe verified:', name);
      return true;
    },
    get outfit() { return selected; },
    dispose() {
      if (disposed) return;
      activeReveal?.cancel();
      activeReveal = null;
      disposed = true;
      onOutfitChanged('original');
  syncOutfitTheme('original');
      epoch++;
      // Restore the original so the caller can dispose its normal VRM tree.
      if (current !== original) {
        current.removeFromParent();
        parent.add(original);
      }
      ownedSkeletons.forEach(skeleton => skeleton.dispose());
      if (asset) VRMUtils.deepDispose(asset.scene);
      reactor = null;
      asset = null;
    }
  };
}
