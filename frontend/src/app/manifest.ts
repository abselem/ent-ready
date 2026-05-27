import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ENT Ready",
    short_name: "ENT Ready",
    description: "Платформа для подготовки к ЕНТ",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#26C0BD",
    background_color: "#ffffff",
    icons: [
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
