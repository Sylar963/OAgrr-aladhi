"use client";

import { Canvas } from "@react-three/fiber";
import type { MotionValue } from "framer-motion";
import { useEffect, useState } from "react";

import { TheaterSurfaceMesh } from "./TheaterSurfaceMesh";

function canRenderInteractiveSurface() {
  return (
    typeof window !== "undefined" &&
    typeof window.WebGLRenderingContext !== "undefined"
  );
}

export default function VolSurfaceTheaterCanvas({
  scrollProgress,
}: {
  scrollProgress: MotionValue<number>;
}) {
  const [canRenderCanvas, setCanRenderCanvas] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncPreference = () => {
      setCanRenderCanvas(!motionQuery.matches && canRenderInteractiveSurface());
    };

    syncPreference();

    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", syncPreference);
      return () => motionQuery.removeEventListener("change", syncPreference);
    }

    motionQuery.addListener(syncPreference);
    return () => motionQuery.removeListener(syncPreference);
  }, []);

  if (!canRenderCanvas) {
    return (
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_30%_52%,_rgba(64,128,255,0.18),_transparent_45%),_radial-gradient(circle_at_72%_42%,_rgba(251,146,60,0.22),_transparent_45%),_#0a0a0a]"
      />
    );
  }

  return (
    <Canvas
      camera={{ fov: 30, position: [4.6, -1.4, 6.8] }}
      className="absolute inset-0 h-full w-full"
      dpr={[1, 1.75]}
    >
      <color attach="background" args={["#0a0a0a"]} />
      <fog attach="fog" args={["#0a0a0a", 12, 22]} />
      <ambientLight intensity={0.9} />
      <directionalLight color="#ffffff" intensity={1.15} position={[6, 8, 6]} />
      <directionalLight color="#bcd6ff" intensity={0.5} position={[-6, 4, 3]} />
      <directionalLight color="#fcd9b5" intensity={0.35} position={[2, -3, 4]} />
      <TheaterSurfaceMesh scrollProgress={scrollProgress} />
    </Canvas>
  );
}
