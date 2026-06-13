import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RootLayout, { metadata, viewport } from "./layout";

vi.mock("next/font/google", () => ({
  IBM_Plex_Mono: () => ({ variable: "font-mono" }),
  IBM_Plex_Sans: () => ({ variable: "font-sans" }),
  IBM_Plex_Sans_Condensed: () => ({ variable: "font-display" }),
}));

vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => <div data-testid="analytics" />,
}));

vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: () => <div data-testid="speed-insights" />,
}));

describe("RootLayout", () => {
  it("includes the analytics hooks in the document shell", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RootLayout,
        undefined,
        React.createElement("div", undefined, "child"),
      ),
    );

    expect(html).toContain('data-testid="analytics"');
    expect(html).toContain('data-testid="speed-insights"');
  });

  it("ships share/SEO metadata", () => {
    expect(String(metadata.metadataBase)).toContain("oggregator");
    expect(metadata.openGraph?.siteName).toBe("Oggregator");
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(metadata.alternates?.canonical).toBe("/");
    expect(viewport.themeColor).toBe("#080b0d");
  });
});
