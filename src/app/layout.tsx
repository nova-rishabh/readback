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

export const metadata: Metadata = {
  title: { default: "Readback", template: "%s | Readback" },
  description:
    "Readback checks a marketing draft against your brand rules and shows what six simulated readers come away believing, before it goes live.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${interTight.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen bg-paper text-ink text-[15px] leading-normal">{children}</body>
    </html>
  );
}
