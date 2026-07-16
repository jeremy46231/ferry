import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ferry · Next.js sandbox",
  description: "Ferry integration sandbox for Next.js (App Router)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
