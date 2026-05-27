import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: { default: "ENT Ready", template: "%s | ENT Ready" },
  description: "Платформа для подготовки к ЕНТ",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "ENT Ready" },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#26C0BD",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${geist.variable} h-full`}>
      <body className="h-full bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
