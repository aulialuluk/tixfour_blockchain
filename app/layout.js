import "./globals.css";
import NavBar from "@/components/NavBar";
import SwRegister from "@/components/SwRegister";

export const metadata = {
  title: "TixFour — Temukan acara berikutnya",
  description: "Temukan konser dan acara favoritmu. Tiket digital aman, praktis, dan selalu siap di genggaman.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "TixFour" },
};
export const viewport = { themeColor: "#403f46", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NavBar />
        <main>{children}</main>
        <SwRegister />
      </body>
    </html>
  );
}
