import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Video Agent Studio',
  description: 'Multi-agent workflow platform for idea-to-video production.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

