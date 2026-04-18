import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Crypto Swarm Command',
  description: '7-Agent Institutional Research Platform · Stage 1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#050b16' }}>
        {children}
      </body>
    </html>
  )
}
