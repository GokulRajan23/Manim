import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import Link from "next/link";
import { en } from "@/lib/i18n/en";
import "./globals.css";

/**
 * Two faces, with a rule about who is speaking.
 *
 * Inter reports: labels, controls, and every measured value the pipeline produces.
 * plan.md §3.4 already names it for prose, and the Docker image registers it so the
 * app and the rendered frames share one voice.
 *
 * EB Garamond speaks for the rulebook: the wordmark, section eyebrows, and the
 * numbers the rules files assert. That mirrors §3.4's own reasoning — prose in the
 * brand font, mathematics in a mathematical font — and makes the distinction between
 * *what the contract requires* and *what the render measured* visible at a glance.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const book = EB_Garamond({
  variable: "--font-book",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: en.brand.title,
  description: en.brand.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${book.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="border-b border-ink/10">
          <div className="mx-auto flex max-w-5xl items-baseline gap-8 px-6 py-5">
            <Link href="/" className="font-book text-2xl leading-none tracking-tight">
              {en.brand.name}
            </Link>
            <nav aria-label={en.nav.label} className="flex gap-6 text-sm">
              <Link href="/studio" className="text-primary hover:underline">
                {en.nav.studio}
              </Link>
              {/* Placeholders until the other two features exist. Marked disabled
                  rather than hidden, so the shape of the platform is legible. */}
              <span aria-disabled className="text-ink/35">
                {en.nav.library}
              </span>
              <span aria-disabled className="text-ink/35">
                {en.nav.rulebook}
              </span>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
