import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-terminal",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "NoiseGuard AI",
  description: "Real-time AI-powered urban noise monitoring system",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={jetBrainsMono.variable}>
      <body>
        <div className="crt-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}