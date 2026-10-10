import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "looot-mentions", template: "%s | looot-mentions" },
  description: "Brand and keyword listening with sentiment, intent and a daily digest. Built on looot.",
  icons: { icon: "/brand/looot-mark.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1512" },
  ],
};

// Sets the theme class before the first paint. ?theme=dark or ?theme=light overrides the saved choice for one view.
const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/looot-mark.svg" alt="" width={20} height={20} className="dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/looot-mark-white.svg" alt="" width={20} height={20} className="hidden dark:block" />
              looot-mentions
            </Link>
            <nav className="flex gap-4 text-mute">
              <Link href="/" className="hover:text-ink">Feed</Link>
              <Link href="/digest" className="hover:text-ink">Digest</Link>
              <Link href="/run" className="hover:text-ink">Run</Link>
            </nav>
            {process.env.NEXT_PUBLIC_DEMO === "1" && <span className="ml-auto rounded bg-amber-soft px-2 py-0.5 text-12 text-amber">Demo data, no looot calls</span>}
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
