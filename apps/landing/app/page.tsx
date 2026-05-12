import { createElement } from "react";

export default function Home() {
  return createElement(
    "main",
    { className: "landing-shell" },
    createElement(
      "section",
      { className: "hero" },
      createElement(
        "p",
        { className: "eyebrow" },
        "Public Alpha for crypto derivatives teams",
      ),
      createElement("div", { "aria-hidden": "true", className: "accent-line" }),
      createElement("h1", null, "Stop venue hopping."),
      createElement(
        "p",
        { className: "lede" },
        "Track venue-wide options flow, term structure, and volatility context from one calm command center.",
      ),
      createElement(
        "button",
        { className: "cta", type: "button" },
        "Request Access",
      ),
    ),
  );
}
