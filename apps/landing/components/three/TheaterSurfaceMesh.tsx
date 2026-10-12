"use client";

import { useFrame } from "@react-three/fiber";
import type { MotionValue } from "framer-motion";
import { useMemo, useRef } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, type Group, type ShaderMaterial } from "three";

const SEGMENTS_X = 96;
const SEGMENTS_Y = 64;
const PLANE_WIDTH = 5.6;
const PLANE_DEPTH = 3.9;
const SURFACE_LIFT = -0.85;

const sceneCameras = [
  { yaw: -0.62, tilt: 0.0 },
  { yaw: -0.18, tilt: 0.12 },
  { yaw: 0.34, tilt: 0.26 },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function sampleScene(progress: number) {
  const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const last = sceneCameras.length - 1;
  const scaled = clamped * last;
  const lower = Math.floor(scaled);
  const upper = Math.min(lower + 1, last);
  const t = scaled - lower;
  const a = sceneCameras[lower]!;
  const b = sceneCameras[upper]!;
  return { yaw: lerp(a.yaw, b.yaw, t), tilt: lerp(a.tilt, b.tilt, t) };
}

// Shared by both shaders so the lit surface and the analytic normals agree.
const ivModel = /* glsl */ `
  const float IV_MIN = 30.0;
  const float IV_MAX = 55.0;
  const float Z_SCALE = 0.075;

  // uv.x: put wing (0) → call wing (1); uv.y: front tenor (0) → back tenor (1).
  float computeIv(vec2 p, float t) {
    float k = p.x * 2.0 - 1.0;
    float tenor = mix(0.02, 1.0, p.y);
    float rootT = sqrt(tenor + 0.04);
    float atm = 34.0 + 8.0 * (1.0 - exp(-tenor * 2.5))
      + sin(t * 0.35 + p.y * 4.0) * 0.8;
    float skew = (-1.6 + sin(t * 0.21) * 0.9) / rootT;
    float curvature = 2.8 / rootT;
    return atm + skew * k + curvature * k * k;
  }
`;

const vertexShader = /* glsl */ `
  uniform float uTime;

  varying vec2 vUv;
  varying float vIv;
  varying vec3 vNormal;

  ${ivModel}

  float heightAt(vec2 p) {
    return (computeIv(p, uTime) - IV_MIN) * Z_SCALE;
  }

  void main() {
    vUv = uv;
    vIv = computeIv(uv, uTime);

    const float EPS = 0.004;
    float dzdx = (heightAt(uv + vec2(EPS, 0.0)) - heightAt(uv - vec2(EPS, 0.0)))
      / (2.0 * EPS * ${PLANE_WIDTH.toFixed(2)});
    float dzdy = (heightAt(uv + vec2(0.0, EPS)) - heightAt(uv - vec2(0.0, EPS)))
      / (2.0 * EPS * ${PLANE_DEPTH.toFixed(2)});
    vNormal = normalize(normalMatrix * vec3(-dzdx, -dzdy, 1.0));

    vec3 displaced = vec3(position.xy, heightAt(uv));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uScan;

  varying vec2 vUv;
  varying float vIv;
  varying vec3 vNormal;

  ${ivModel}

  const vec3 STOP0 = vec3(0.118, 0.251, 0.686);
  const vec3 STOP1 = vec3(0.376, 0.647, 0.980);
  const vec3 STOP2 = vec3(0.961, 0.961, 0.961);
  const vec3 STOP3 = vec3(0.984, 0.573, 0.235);
  const vec3 STOP4 = vec3(0.918, 0.345, 0.047);

  vec3 thermal(float t) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.25) return mix(STOP0, STOP1, t / 0.25);
    if (t < 0.5) return mix(STOP1, STOP2, (t - 0.25) / 0.25);
    if (t < 0.7) return mix(STOP2, STOP3, (t - 0.5) / 0.2);
    return mix(STOP3, STOP4, (t - 0.7) / 0.3);
  }

  float line(float f, float width) {
    float d = abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1e-4);
    return 1.0 - clamp(d / width, 0.0, 1.0);
  }

  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;

    vec3 lightDir = normalize(vec3(0.35, 0.85, 0.6));
    float diffuse = max(dot(n, lightDir), 0.0);
    float rim = pow(1.0 - max(n.z, 0.0), 2.0);

    vec3 albedo = thermal((vIv - IV_MIN) / (IV_MAX - IV_MIN));
    vec3 color = albedo * (0.32 + 0.78 * diffuse) + albedo * rim * 0.25;

    float grid = max(line(vUv.x * 12.0, 1.1), line(vUv.y * 8.0, 1.1));
    color = mix(color, vec3(0.03, 0.04, 0.05), grid * 0.6);

    float contour = line(vIv / 2.5, 0.9);
    color += vec3(1.0) * contour * 0.08;

    float scanDist = vUv.y - uScan;
    float scan = exp(-(scanDist * scanDist) / 0.00035);
    color = mix(color, vec3(1.0), scan * 0.45);

    float edge = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x)
      * smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.97, vUv.y);
    color = mix(vec3(0.03, 0.04, 0.05), color, 0.35 + 0.65 * edge);

    gl_FragColor = vec4(color, 1.0);
  }
`;

function buildFloorGrid() {
  const halfW = PLANE_WIDTH / 2;
  const halfD = PLANE_DEPTH / 2;
  const points: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const x = -halfW + (PLANE_WIDTH * i) / 12;
    points.push(x, -halfD, 0, x, halfD, 0);
  }
  for (let i = 0; i <= 8; i++) {
    const y = -halfD + (PLANE_DEPTH * i) / 8;
    points.push(-halfW, y, 0, halfW, y, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return geometry;
}

export function TheaterSurfaceMesh({
  scrollProgress,
}: {
  scrollProgress: MotionValue<number>;
}) {
  const rigRef = useRef<Group>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const smoothed = useRef(sampleScene(0));

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uScan: { value: 0 } }), []);
  const floorGrid = useMemo(buildFloorGrid, []);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;

    if (materialRef.current) {
      materialRef.current.uniforms.uTime!.value = elapsed;
      materialRef.current.uniforms.uScan!.value = (elapsed * 0.09) % 1.15;
    }

    const rig = rigRef.current;
    if (!rig) return;

    const target = sampleScene(scrollProgress.get());
    smoothed.current.yaw = lerp(smoothed.current.yaw, target.yaw, 0.08);
    smoothed.current.tilt = lerp(smoothed.current.tilt, target.tilt, 0.08);

    const { width, height } = state.viewport;
    const wide = width / height > 1.1;
    const scale = Math.min(1, width / (wide ? 10.5 : 7.2));

    rig.scale.setScalar(scale);
    rig.position.x = wide ? width * 0.22 : 0;
    rig.position.y = (wide ? 0 : -height * 0.2) + Math.sin(elapsed * 0.22) * 0.04;
    rig.rotation.y = smoothed.current.yaw + Math.sin(elapsed * 0.12) * 0.05;
    rig.rotation.x = smoothed.current.tilt;
  });

  return (
    <group ref={rigRef}>
      <group rotation-x={-Math.PI / 2} position-y={SURFACE_LIFT}>
        <mesh frustumCulled={false}>
          <planeGeometry args={[PLANE_WIDTH, PLANE_DEPTH, SEGMENTS_X, SEGMENTS_Y]} />
          <shaderMaterial
            ref={materialRef}
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            uniforms={uniforms}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
        <lineSegments geometry={floorGrid} position-z={-0.02}>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.07} />
        </lineSegments>
      </group>
    </group>
  );
}
