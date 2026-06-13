// Full-bleed static poster for every degraded hero path: dynamic-import loading,
// no-WebGL clients, and reduced motion. Colors mirror the shader's thermal ramp.
export function SurfaceFallback() {
  const verticalGuides = [80, 160, 240, 320, 400, 480, 560];
  const horizontalGuides = [90, 150, 210, 270, 330];
  const contourRows = [
    "70,298 142,264 216,242 288,218 364,196 444,166 522,140 584,126",
    "70,320 142,286 216,262 288,240 364,214 444,184 522,156 584,140",
    "70,344 142,308 216,286 288,262 364,238 444,208 522,182 584,166",
    "70,366 142,334 216,310 288,290 364,266 444,240 522,216 584,200",
  ];

  return (
    <div aria-hidden className="absolute inset-0 bg-[#080b0d]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_55%,_rgba(30,64,175,0.25),_transparent_45%),_radial-gradient(circle_at_72%_40%,_rgba(234,88,12,0.18),_transparent_45%)]" />

      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 640 420"
      >
        <defs>
          <linearGradient id="surface-fill" x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(251,146,60,0.28)" />
            <stop offset="100%" stopColor="rgba(96,165,250,0.05)" />
          </linearGradient>
        </defs>

        {horizontalGuides.map((y) => (
          <line
            key={`h-${y}`}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
            x1="40"
            x2="600"
            y1={y}
            y2={y}
          />
        ))}

        {verticalGuides.map((x) => (
          <line
            key={`v-${x}`}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
            x1={x}
            x2={x}
            y1="60"
            y2="400"
          />
        ))}

        <path
          d="M70 366 L142 334 L216 310 L288 290 L364 266 L444 240 L522 216 L584 200 L584 400 L70 400 Z"
          fill="url(#surface-fill)"
        />

        {contourRows.map((row, index) => (
          <polyline
            key={row}
            fill="none"
            points={row}
            stroke="#fb923c"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={1 - index * 0.18}
            strokeWidth="2.2"
          />
        ))}

        <polyline
          fill="none"
          points="70,278 142,238 216,208 288,176 364,142 444,116 522,96 584,92"
          stroke="rgba(96,165,250,0.45)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>
    </div>
  );
}
