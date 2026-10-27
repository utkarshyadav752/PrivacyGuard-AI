import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ShieldCheck, Sparkles, EyeOff } from 'lucide-react';

interface PrivacyShield3DProps {
  activeMode?: 'shield' | 'orb';
  onSelectAction?: (action: 'photo' | 'link') => void;
}

export const PrivacyShield3D: React.FC<PrivacyShield3DProps> = ({
  activeMode = 'shield',
  onSelectAction,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef<'shield' | 'orb'>(activeMode);
  const pulseRef = useRef<number>(0);
  const [inspectMode, setInspectMode] = useState<'shield' | 'orb'>(activeMode);

  useEffect(() => {
    modeRef.current = inspectMode;
    pulseRef.current = 1.0;
  }, [inspectMode]);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || 320;
    const height = container.clientHeight || 240;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
    camera.position.set(0, 0.35, 5.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Warm key light + Cool hemisphere light
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
    keyLight.position.set(3.5, 4.5, 4.0);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x8b5cf6, 1.6);
    rimLight.position.set(-3.5, 2.0, -3.0);
    scene.add(rimLight);

    // Multi-part procedural 3D assembly (8 parts across 3 silhouette scales)
    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 1. Primary Silhouette: Extruded Beveled Privacy Shield Crest
    const shieldShape = new THREE.Shape();
    shieldShape.moveTo(0, 1.25);
    shieldShape.quadraticCurveTo(0.95, 1.15, 1.05, 0.85);
    shieldShape.quadraticCurveTo(1.08, -0.35, 0, -1.25);
    shieldShape.quadraticCurveTo(-1.08, -0.35, -1.05, 0.85);
    shieldShape.quadraticCurveTo(-0.95, 1.15, 0, 1.25);

    const shieldGeo = new THREE.ExtrudeGeometry(shieldShape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.07,
      bevelSegments: 3,
      curveSegments: 24,
    });
    shieldGeo.center();

    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.85,
      roughness: 0.22,
    });
    const shieldMesh = new THREE.Mesh(shieldGeo, armorMat);
    rootGroup.add(shieldMesh);

    // 2. Secondary Read: Inner Cyan Vault Core Sphere
    const coreGeo = new THREE.IcosahedronGeometry(0.46, 2);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.35,
      metalness: 0.35,
      roughness: 0.5,
      wireframe: false,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.z = 0.14;
    rootGroup.add(coreMesh);

    // 3. Secondary Read: Outer Gyroscopic Privacy Ring A
    const ringGeoA = new THREE.TorusGeometry(1.42, 0.032, 16, 64);
    const ringMatA = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      metalness: 0.9,
      roughness: 0.15,
    });
    const ringA = new THREE.Mesh(ringGeoA, ringMatA);
    rootGroup.add(ringA);

    // 4. Secondary Read: Tilted Violet Encryption Ring B
    const ringGeoB = new THREE.TorusGeometry(1.62, 0.022, 14, 64);
    const ringMatB = new THREE.MeshStandardMaterial({
      color: 0xa78bfa,
      metalness: 0.85,
      roughness: 0.25,
    });
    const ringB = new THREE.Mesh(ringGeoB, ringMatB);
    ringB.rotation.x = Math.PI / 3;
    rootGroup.add(ringB);

    // 5. Accent Detail: Front Bezel Rim Crest
    const bezelGeo = new THREE.RingGeometry(0.54, 0.66, 32);
    const bezelMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.92,
      roughness: 0.18,
      side: THREE.DoubleSide,
    });
    const bezelMesh = new THREE.Mesh(bezelGeo, bezelMat);
    bezelMesh.position.z = 0.21;
    rootGroup.add(bezelMesh);

    // 6. Accent Detail: Instanced Data-Scrubbing Perimeter Nodes (24 instances)
    const nodeGeo = new THREE.OctahedronGeometry(0.055, 0);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: 0x67e8f9,
      metalness: 0.7,
      roughness: 0.2,
    });
    const nodeCount = 24;
    const nodesInstanced = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeCount);
    const dummyMatrix = new THREE.Matrix4();
    const dummyPos = new THREE.Vector3();
    const dummyQuat = new THREE.Quaternion();
    const dummyScale = new THREE.Vector3();
    const dummyColor = new THREE.Color();

    for (let i = 0; i < nodeCount; i++) {
      const angle = (i / nodeCount) * Math.PI * 2;
      const radius = i % 2 === 0 ? 1.42 : 1.62;
      dummyPos.set(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        (i % 3 - 1) * 0.12
      );
      const s = 0.85 + (i % 3) * 0.15;
      dummyScale.set(s, s, s);
      dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
      nodesInstanced.setMatrixAt(i, dummyMatrix);
      dummyColor.setHex(i % 2 === 0 ? 0x22d3ee : 0xa78bfa);
      nodesInstanced.setColorAt(i, dummyColor);
    }
    nodesInstanced.instanceMatrix.needsUpdate = true;
    if (nodesInstanced.instanceColor) nodesInstanced.instanceColor.needsUpdate = true;
    nodesInstanced.computeBoundingSphere();
    rootGroup.add(nodesInstanced);

    // 7. Ground Contact Shadow Disc
    const shadowGeo = new THREE.CircleGeometry(1.5, 32);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = -1.78;
    scene.add(shadowDisc);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let frameId = 0;
    const startMs = performance.now();
    let prevMs = startMs;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const poll = () => {
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      const nowMs = performance.now();
      const dt = Math.min((nowMs - prevMs) / 1000, 0.1);
      prevMs = nowMs;
      const elapsed = (nowMs - startMs) / 1000;

      // Smooth exponential damping based on mode
      const targetShieldScale = modeRef.current === 'shield' ? 1.0 : 0.72;
      const targetCoreScale = modeRef.current === 'orb' ? 1.45 : 1.0;

      const sScale = THREE.MathUtils.damp(shieldMesh.scale.x, targetShieldScale, 6, dt);
      shieldMesh.scale.set(sScale, sScale, sScale);

      const cScale = THREE.MathUtils.damp(coreMesh.scale.x, targetCoreScale, 6, dt);
      coreMesh.scale.set(cScale, cScale, cScale);

      pulseRef.current = THREE.MathUtils.damp(pulseRef.current, 0, 4, dt);

      rootGroup.rotation.y = Math.sin(elapsed * 0.65) * 0.35 + pulseRef.current * 0.6;
      rootGroup.position.y = Math.sin(elapsed * 1.4) * 0.06;

      ringA.rotation.z = elapsed * 0.35;
      ringA.rotation.x = Math.sin(elapsed * 0.5) * 0.25;
      ringB.rotation.y = -elapsed * 0.45;
      nodesInstanced.rotation.z = -elapsed * 0.2;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 240;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      shieldGeo.dispose();
      armorMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      ringGeoA.dispose();
      ringMatA.dispose();
      ringGeoB.dispose();
      ringMatB.dispose();
      bezelGeo.dispose();
      bezelMat.dispose();
      nodeGeo.dispose();
      nodeMat.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      data-testid="privacy-3d-viewport"
      className="relative flex flex-col items-center justify-between rounded-2xl border border-slate-800/90 bg-slate-900/70 p-4 overflow-hidden"
    >
      <div className="w-full flex items-center justify-between text-xs text-slate-400 z-10">
        <span className="font-medium text-slate-300 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
          Local Zero-Upload Engine
        </span>
        <span className="font-mono text-[11px] text-cyan-300">
          {inspectMode === 'shield' ? 'EXIF + Pixel Guard' : 'URL Parameter Filter'}
        </span>
      </div>

      {/* Isolated 3D WebGL Canvas Mount */}
      <div
        ref={canvasMountRef}
        onClick={() => {
          pulseRef.current = 1.2;
          setInspectMode((prev) => (prev === 'shield' ? 'orb' : 'shield'));
        }}
        className="w-full h-44 sm:h-48 cursor-pointer"
        title="Click to toggle 3D Privacy Shield & Link Orb"
        aria-label="Interactive 3D Privacy Shield and Orb"
      />

      {/* Unified Bottom Control Dock */}
      <div className="w-full flex items-center justify-center gap-2 pt-1 z-10">
        <button
          type="button"
          onClick={() => {
            setInspectMode('shield');
            onSelectAction?.('photo');
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            inspectMode === 'shield'
              ? 'bg-cyan-500 text-slate-950 font-semibold'
              : 'bg-slate-800/90 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <EyeOff className="w-3.5 h-3.5" />
          <span>Photo Shield</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setInspectMode('orb');
            onSelectAction?.('link');
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            inspectMode === 'orb'
              ? 'bg-violet-500 text-white font-semibold'
              : 'bg-slate-800/90 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Link Orb</span>
        </button>
      </div>
    </div>
  );
};
