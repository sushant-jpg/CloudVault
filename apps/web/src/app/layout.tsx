import type { Metadata } from 'next';
import { Manrope, Newsreader } from 'next/font/google';
import '@/app/globals.css';

const manrope = Manrope({ subsets: ['latin'], variable: '--font-sans' });
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
  title: { default: 'CloudVault — Private files, controlled sharing', template: '%s · CloudVault' },
  description: 'Security-first private file storage with expiring, revocable, recipient-controlled sharing.',
  applicationName: 'CloudVault',
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body className={`${manrope.variable} ${newsreader.variable}`}>{children}</body></html>;
}
