"use client";

import { useFrame } from "@react-three/fiber";
import type { MotionValue } from "framer-motion";
import { useRef, useState } from "react";
import type { Mesh } from "three";
import { DoubleSide, PlaneGeometry } from "three";

function createSurfaceGeometry() {
  const geometry = new PlaneGeometry(11.2, 6.8, 60, 38);
  const positions = geometry.attributes.position;

  if (!positions) {
    return geometry;
  }

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const strike = x / 5.6;
    const tenor = (y + 3.4) / 6.8;
    const smile = 0.96 * strike * strike;
    const termSlope = 0.78 * tenor;
    const wingPressure =
      Math.exp(-((strike - 0.36) * (strike - 0.36)) * 7) * 0.28;
    const localDip =
      Math.exp(-((strike + 0.42) * (strike + 0.42)) * 9) * 0.2;
    const ripple = Math.sin((tenor + 0.08) * Math.PI * 2.1) * 0.09;

    positions.setZ(
      index,
      0.32 + smile + termSlope + wingPressure - localDip + ripple,
    );
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  return geometry;
}

const sceneCameras = [
  { rotX: -1.18, rotY: -0.32, posY: -0.7, posZ: 0 },
  { rotX: -1.02, rotY: 0.05, posY: -0.45, posZ: 0.12 },
  { rotX: -0.86, rotY: 0.34, posY: -0.2, posZ: 0.18 },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function sampleScene(progress: number) {
  const clamped = Math.min(Math.max(progress, 0), 1);
  const last = sceneCameras.length - 1;
  const scaled = clamped * last;
  const lower = Math.floor(scaled);
  const upper = Math.min(lower + 1, last);
  const t = scaled - lower;
  const a = sceneCameras[lower];
  const b = sceneCameras[upper];

  if (!a || !b) {
    return sceneCameras[0]!;
  }

  return {
    rotX: lerp(a.rotX, b.rotX, t),
    rotY: lerp(a.rotY, b.rotY, t),
    posY: lerp(a.posY, b.posY, t),
    posZ: lerp(a.posZ, b.posZ, t),
  };
}

export function TheaterSurfaceMesh({
  scrollProgress,
}: {
  scrollProgress: MotionValue<number>;
}) {
  const [geometry] = useState(createSurfaceGeometry);
  const surfaceRef = useRef<Mesh>(null);
  const wireRef = useRef<Mesh>(null);

  useFrame((state) => {
    const progress = scrollProgress.get();
    const target = sampleScene(progress);
    const breath = Math.sin(state.clock.elapsedTime * 0.22) * 0.05;
    const drift = Math.sin(state.clock.elapsedTime * 0.16) * 0.12;
    const bob = Math.sin(state.clock.elapsedTime * 0.28) * 0.06;

    const rotationX = target.rotX + breath;
    const rotationY = target.rotY + drift;
    const positionY = target.posY + bob;

    if (surfaceRef.current) {
      surfaceRef.current.rotation.x = rotationX;
      surfaceRef.current.rotation.y = rotationY;
      surfaceRef.current.position.y = positionY;
      surfaceRef.current.position.z = target.posZ;
    }

    if (wireRef.current) {
      wireRef.current.rotation.x = rotationX;
      wireRef.current.rotation.y = rotationY;
      wireRef.current.position.y = positionY;
      wireRef.current.position.z = target.posZ + 0.02;
    }
  });

  return (
    <group>
      <mesh ref={surfaceRef} geometry={geometry}>
        <meshStandardMaterial
          color="#2a1b16"
          emissive="#1d120f"
          emissiveIntensity={0.6}
          metalness={0.14}
          roughness={0.22}
          side={DoubleSide}
          transparent
          opacity={0.92}
        />
      </mesh>
      <mesh ref={wireRef} geometry={geometry}>
        <meshStandardMaterial
          color="#d77a52"
          emissive="#d77a52"
          emissiveIntensity={0.42}
          transparent
          opacity={0.7}
          wireframe
        />
      </mesh>
    </group>
  );
}
