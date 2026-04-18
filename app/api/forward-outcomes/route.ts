import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { COINGECKO_IDS } from '@/lib/agents'

export const runtime = 'nodejs'
export const maxDuration = 60

async function fetchPrice(asset: string): Promise<number | null> {
  const id = COINGECKO_IDS[asset.toUpperCase()]
  if (!id) return null
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`)
    const d = await r.json()
    return d[id]?.usd || null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServiceClient()

  // Find pending forward outcomes
  const { data: pending } = await db
    .from('forward_outcomes')
    .select('scan_id, asset, price_at_scan, directional_bias, created_at, price_1h, price_4h, price_24h')
    .is('price_24h', null)
    .gte('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())

  if (!pending?.length) {
    return NextResponse.json({ processed: 0, updated: 0 })
  }

  // Batch price fetches by unique asset
  const uniqueAssets = [...new Set(pending.map((p: any) => p.asset))]
  const prices: Record<string, number | null> = {}
  await Promise.all(uniqueAssets.map(async (asset: any) => {
    prices[asset] = await fetchPrice(asset)
  }))

  let updated = 0
  const now = Date.now()

  for (const row of pending as any[]) {
    const price = prices[row.asset]
    if (!price || !row.price_at_scan || row.price_at_scan <= 0) continue

    const scanTime = new Date(row.created_at).getTime()
    const elapsed = now - scanTime
    const ret = (price - row.price_at_scan) / row.price_at_scan * 100
    const dirCorrect = row.directional_bias === 'bullish' ? price > row.price_at_scan
      : row.directional_bias === 'bearish' ? price < row.price_at_scan : null

    const updates: Record<string, any> = {}

    if (!row.price_1h && elapsed >= 3600 * 1000) {
      updates.price_1h = price
      updates.return_1h_pct = ret
      updates.direction_correct_1h = dirCorrect
      updates.fetched_1h_at = new Date().toISOString()
    }
    if (!row.price_4h && elapsed >= 4 * 3600 * 1000) {
      updates.price_4h = price
      updates.return_4h_pct = ret
      updates.direction_correct_4h = dirCorrect
      updates.fetched_4h_at = new Date().toISOString()
    }
    if (!row.price_24h && elapsed >= 24 * 3600 * 1000) {
      updates.price_24h = price
      updates.return_24h_pct = ret
      updates.direction_correct_24h = dirCorrect
      updates.fetched_24h_at = new Date().toISOString()
    }

    if (Object.keys(updates).length > 0) {
      await db.from('forward_outcomes').update(updates).eq('scan_id', row.scan_id)
      updated++
    }
  }

  return NextResponse.json({ processed: pending.length, updated })
}
