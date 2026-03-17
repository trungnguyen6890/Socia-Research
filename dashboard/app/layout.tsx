import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Socia Research',
  description: 'Research Bot Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
