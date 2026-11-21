import * as THREE from 'three';

// An actual fragment-level reveal on the skinned meshes, not an avatar-covering overlay.
export function createNanotechReveal({ vrm, source, target, renderer, camera, fromEnergy=false, to='reactor', onCommit }) {
  const parent = source.parent;
  if (!parent || !target) throw new Error('Outfit meshes are unavailable.');
  const sourceVisible = source.visible;
  const targetParent = target.parent;
  const targetVisible = target.visible;
  const reverse = to === 'original' && !fromEnergy;
  const records = [];
  const seenMeshes = new Set();
  const temporary = new Set();
  let done = false;
  let committed = false;
  let radius = 0;

  vrm.update(0);
  vrm.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  const height = Math.max(.5, bounds.getSize(new THREE.Vector3()).y);
  const chest = vrm.humanoid.getRawBoneNode('upperChest') || vrm.humanoid.getRawBoneNode('chest');
  const origin = chest ? chest.getWorldPosition(new THREE.Vector3()) : bounds.getCenter(new THREE.Vector3());
  const offset = new THREE.Vector3(0,.012,.075).multiplyScalar(height);
  offset.applyQuaternion(vrm.scene.getWorldQuaternion(new THREE.Quaternion()));
  origin.add(offset);
  let maximum = 0;
  for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
    maximum = Math.max(maximum, origin.distanceTo(new THREE.Vector3(x,y,z)));
  }
  maximum += height * .2;
  const field = { value: reverse ? maximum : -height*.04 };
  const edgeWidth = height * .006;
  const tint = new THREE.Color(to === 'reactor' ? 0x63dfff : 0xffd6a2);
  const samples = [];

  function instrument(root, side) {
    root.traverse(mesh => {
      if (!mesh.isMesh || !mesh.material || seenMeshes.has(mesh)) return;
      seenMeshes.add(mesh);
      const old = mesh.material;
      const list = [].concat(old).map(original => {
        const material = original.clone();
        const vertex = material.vertexShader;
        const fragment = material.fragmentShader;
        if (typeof vertex !== 'string' || !vertex.includes('#include <project_vertex>') ||
            typeof fragment !== 'string' || !/void\s+main\s*\(\s*\)/.test(fragment)) {
          material.dispose();
          throw new Error('This outfit material does not support the nanotech reveal.');
        }
        const previous = material.onBeforeCompile;
        const oldKey = material.customProgramCacheKey.bind(material);
        material.customProgramCacheKey = () => oldKey() + '|eden-nanotech-3|' + side;
        material.onBeforeCompile = function(shader, gpu) {
          previous?.call(this, shader, gpu);
          shader.uniforms.edenNanoOrigin = {value:origin};
          shader.uniforms.edenNanoRadius = field;
          shader.uniforms.edenNanoSide = {value:side};
          shader.uniforms.edenNanoWidth = {value:edgeWidth};
          shader.uniforms.edenNanoTint = {value:tint};
          shader.vertexShader = 'varying vec3 vEdenNanoWorld;\n' + shader.vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\nvEdenNanoWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
          );
          shader.fragmentShader = `varying vec3 vEdenNanoWorld;
            uniform vec3 edenNanoOrigin;
            uniform float edenNanoRadius;
            uniform float edenNanoSide;
            uniform float edenNanoWidth;
            uniform vec3 edenNanoTint;\n` + shader.fragmentShader.replace(
              /void\s+main\s*\(\s*\)\s*\{/,
              `void main() {
                vec3 edenNanoPoint = vEdenNanoWorld - edenNanoOrigin;
                float edenNanoNoise = sin(edenNanoPoint.x*95.0 + sin(edenNanoPoint.y*53.0))*sin(edenNanoPoint.z*81.0 + edenNanoPoint.y*73.0)*edenNanoWidth*0.22;
                float edenNanoDelta = length(edenNanoPoint) + edenNanoNoise - edenNanoRadius;
                if (edenNanoSide > 0.0 && edenNanoDelta > 0.0) discard;
                if (edenNanoSide < 0.0 && edenNanoDelta <= 0.0) discard;`
            );
          const end = shader.fragmentShader.lastIndexOf('}');
          shader.fragmentShader = shader.fragmentShader.slice(0,end) + `
            float edenNanoGlow = 1.0-smoothstep(0.0,edenNanoWidth,abs(edenNanoDelta));
            gl_FragColor.rgb = mix(gl_FragColor.rgb,edenNanoTint,edenNanoGlow*0.88);
          ` + shader.fragmentShader.slice(end);
        };
        material.needsUpdate = true;
        temporary.add(material);
        return material;
      });
      records.push({mesh,material:old});
      mesh.material = Array.isArray(old) ? list : list[0];
      mesh.skeleton?.update();
      const index = mesh.geometry.index;
      const count = index ? index.count : mesh.geometry.attributes.position?.count || 0;
      const stride = Math.max(1,Math.floor(count/90));
      for (let i=0;i<count;i+=stride) {
        const vertexIndex = index ? index.getX(i) : i;
        const point = new THREE.Vector3();
        if (typeof mesh.getVertexPosition === 'function') mesh.getVertexPosition(vertexIndex,point);
        else point.fromBufferAttribute(mesh.geometry.attributes.position,vertexIndex);
        point.applyMatrix4(mesh.matrixWorld);
        samples.push({point,distance:point.distanceTo(origin)});
      }
    });
  }

  function restore() {
    for (const record of records) record.mesh.material = record.material;
    temporary.forEach(material=>material.dispose());
    temporary.clear();
    source.visible = sourceVisible;
    if (target !== source) {
      target.removeFromParent();
      if (targetParent) targetParent.add(target);
      target.visible = targetVisible;
    }
    vrm.scene.updateMatrixWorld(true);
  }

  try {
    if (target !== source) parent.add(target);
    target.visible = true;
    source.visible = target === source || !fromEnergy;
    vrm.scene.updateMatrixWorld(true);
    const nextSide = reverse ? -1 : 1;
    if (target !== source && !fromEnergy) instrument(source,-nextSide);
    instrument(target,nextSide);
    if (fromEnergy) {
      const bodyNodes = new Set();
      source.traverse(node=>bodyNodes.add(node));
      target.traverse(node=>bodyNodes.add(node));
      // Face and hair reveal too when entering human form from the energy core.
      for (const child of [...vrm.scene.children]) {
        if (bodyNodes.has(child)) continue;
        const meshes = [];
        child.traverse(node=>{if(node.isMesh&&!bodyNodes.has(node)) meshes.push(node);});
        for (const mesh of meshes) instrument(mesh,nextSide);
      }
    }
  } catch(error) {restore();throw error;}

  function update(progress) {
    if (done) return [];
    const p = Math.max(0,Math.min(1,progress));
    const t = p*p*(3-2*p);
    radius = reverse ? maximum*(1-t)-height*.04*t : -height*.04*(1-t)+maximum*t;
    field.value = radius;
    temporary.forEach(material=>{ material.uniformsNeedUpdate = true; });
    const points=[];
    for (const sample of samples) {
      if (Math.abs(sample.distance-radius)>edgeWidth*2.8) continue;
      const point=sample.point.clone().project(camera);
      if(point.z < -1 || point.z > 1) continue;
      points.push({x:(point.x+1)/2,y:(1-point.y)/2});
      if(points.length>=70)break;
    }
    return points;
  }
  update(0);
  return {
    update,
    async complete() {
      if (done) return committed;
      update(1); done=true; restore();
      committed = (await onCommit()) !== false;
      return committed;
    },
    cancel() {if(done)return;done=true;restore();},
    get committed(){return committed;}
  };
}
