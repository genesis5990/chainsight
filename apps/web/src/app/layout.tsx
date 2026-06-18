import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ChainSight',
  description:
    'Autonomous, court-defensible blockchain investigation platform. The vendor is never a counterparty to your investigation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-context-100 text-context-700 antialiased">{children}</body>
    </html>
  );
}
