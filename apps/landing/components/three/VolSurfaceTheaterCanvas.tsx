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
        className="absolute inset-0 bg-[radial-gradient(circle_at_22%_38%,_rgba(215,122,82,0.28),_transparent_38%),_radial-gradient(circle_at_78%_70%,_rgba(80,210,193,0.08),_transparent_42%),_linear-gradient(180deg,_#0a0d10_0%,_#0f1115_100%)]"
      />
    );
  }

  return (
    <Canvas
      camera={{ fov: 32, position: [0, 4.2, 9.2] }}
      className="absolute inset-0 h-full w-full"
      dpr={[1, 1.6]}
    >
      <color attach="background" args={["#0a0c0f"]} />
      <fog attach="fog" args={["#0a0c0f", 10, 19]} />
      <ambientLight intensity={0.55} />
      <directionalLight color="#f3f0e8" intensity={1.1} position={[5, 6, 6]} />
      <directionalLight color="#d77a52" intensity={2} position={[-5, 3.5, 2]} />
      <directionalLight color="#50d2c1" intensity={0.45} position={[0, -4, 4]} />
      <TheaterSurfaceMesh scrollProgress={scrollProgress} />
    </Canvas>
  );
}
