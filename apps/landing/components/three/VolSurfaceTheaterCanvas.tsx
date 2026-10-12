"use client";

import { Canvas } from "@react-three/fiber";
import type { MotionValue } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { SurfaceFallback } from "./SurfaceFallback";
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
  // Resolve capability synchronously on first render (the component is ssr:false,
  // so window exists here). Defaulting to false would render SurfaceFallback for
  // one paint before the effect flips it — a visible poster flicker on every load.
  const [canRenderCanvas, setCanRenderCanvas] = useState(
    () =>
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      canRenderInteractiveSurface(),
  );
  const [inView, setInView] = useState(true);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setInView(entry.isIntersecting);
      },
      { rootMargin: "120px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!canRenderCanvas) {
    return <SurfaceFallback />;
  }

  return (
    <div ref={wrapperRef} className="absolute inset-0">
      <Canvas
        camera={{ fov: 30, position: [0, 4.6, 11] }}
        className="h-full w-full"
        dpr={[1, 1.75]}
        frameloop={inView ? "always" : "never"}
        gl={{
          antialias: true,
          alpha: false,
          depth: true,
          stencil: false,
          powerPreference: "high-performance",
        }}
      >
        <color attach="background" args={["#080b0d"]} />
        <TheaterSurfaceMesh scrollProgress={scrollProgress} />
      </Canvas>
    </div>
  );
}
