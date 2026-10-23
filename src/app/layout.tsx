import type { Metadata } from "next";
import { Newsreader, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://readback-virid.vercel.app";
const DESCRIPTION =
  "Readback checks marketing drafts against brand rules and approved facts, and shows what six simulated readers come away believing. Try the demo, no sign-up.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Readback: catch misleading ad claims before they publish", template: "%s | Readback" },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Readback",
    title: "Readback: catch misleading ad claims before they publish",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "Readback", description: DESCRIPTION },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${interTight.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen bg-paper text-ink text-[15px] leading-normal">{children}</body>
    </html>
  );
}
