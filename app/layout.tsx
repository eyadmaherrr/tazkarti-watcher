import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

const cairo = Cairo({ subsets: ["latin", "arabic"], weight: ["400", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Tazkarti Watch",
  description: "Live watcher for new matches on Tazkarti, with browser notifications.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cairo.className}>
      <body>{children}</body>
    </html>
  );
}
