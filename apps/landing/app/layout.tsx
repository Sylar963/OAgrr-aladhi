import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter_Tight } from "next/font/google";

import "./globals.css";

const displayFont = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-display",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Oggregator Landing",
  description: "Institutional crypto options intelligence without venue hopping.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${monoFont.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
