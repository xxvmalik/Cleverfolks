import type { Metadata } from "next";
import { Inter, DM_Sans } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["600", "700"],
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cleverfolks",
  description: "Cleverfolks – AI-powered SaaS platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${dmSans.variable} antialiased`}>
        <div className="flex h-screen overflow-hidden bg-[#131619]">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-[#1C1F24]">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
