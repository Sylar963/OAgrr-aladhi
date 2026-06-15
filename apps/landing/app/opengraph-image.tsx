import { ImageResponse } from "next/og";

export const alt = "Oggregator — options terminal for fragmented markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px",
        backgroundColor: "#080b0d",
        backgroundImage:
          "radial-gradient(circle at 28% 62%, rgba(30,64,175,0.5), transparent 52%), radial-gradient(circle at 74% 36%, rgba(234,88,12,0.42), transparent 46%)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "18px",
          color: "#edf4f6",
          fontSize: "28px",
          letterSpacing: "0.3em",
          textTransform: "uppercase",
        }}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderLeft: "26px solid transparent",
            borderBottom: "26px solid #edf4f6",
          }}
        />
        Oggregator
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div
          style={{
            color: "#edf4f6",
            fontSize: "72px",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          One terminal. Every venue.
        </div>
        <div style={{ color: "#aab4bc", fontSize: "30px" }}>
          Deribit · OKX · Binance · Bybit · Thalex · Derive · Coincall · Gate.io
        </div>
      </div>
    </div>,
    size,
  );
}
