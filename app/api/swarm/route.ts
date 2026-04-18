import { NextRequest } from 'next/server'
import { runSwarmAgents, runChiefStrategist, calcWeightedConfidence } from '@/lib/swarm'
import { supabase } from '@/lib/supabase'
import { WEIGHTS, COINGECKO_IDS } from '@/lib/agents'

export const runtime = 'nodejs'
export const maxDuration = 120 // 2 min max for full swarm

const CONF_TIER = (n: number) => {
  if (n >= 90) return 'Exceptional'
  if (n >= 80) return 'High Quality'
  if (n >= 70) return 'Conditional'
  if (n >= 60) return 'Watch Only'
  return 'No Trade'
}

function normalise(s: string, map: Record<string, string>, fallback: string): string {
  const v = s.toLowerCase().trim()
  for (const [k, val] of Object.entries(map)) {
    if (v.includes(k)) return val
  }
  return fallback
}

function parseNum(text: string, rx: RegExp): number | null {
  const m = text.match(rx)
  return m ? parseFloat(m[1].replace(/,/g, '')) : null
}

function genUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

async function fetchPrice(asset: string): Promise<number | null> {
  const id = COINGECKO_IDS[asset.toUpperCase()]
  if (!id) return null
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`)
    const d = await r.json()
    return d[id]?.usd || null
  } catch { return null }
}

async function getConfHistory(asset: string): Promise<number[]> {
  const { data } = await supabase
    .from('confidence_history')
    .select('weighted_confidence')
    .eq('asset', asset)
    .order('created_at', { ascending: false })
    .limit(10)
  return (data || []).reverse().map((r: any) => r.weighted_confidence)
}

function calcConfTrend(history: number[], current: number): string {
  if (!history.length) return 'First Scan'
  const recent = history.slice(-3)
  const avg = Math.round(recent.reduce((s, c) => s + c, 0) / recent.length)
  if (current > avg + 3) return 'Rising'
  if (current < avg - 3) return 'Falling'
  return 'Stable'
}

export async function POST(req: NextRequest) {
  const { asset, threshold = 70 } = await req.json()
  const t = (asset || '').trim().toUpperCase()
  if (!t) return new Response('Asset required', { status: 400 })

  // SSE stream
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const send = (event: string, data: object) => {
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  }

  // Run in background so we can return the stream immediately
  ;(async () => {
    try {
      // 1. Fetch price — hard block if missing
      send('status', { step: 'price', msg: `Fetching ${t} price...` })
      const priceData = await fetchPrice(t)

      if (!priceData || priceData <= 0) {
        send('error', { code: 'PRICE_MISSING_BLOCKED', msg: `No live price for ${t}. Scan blocked.` })
        writer.close()
        return
      }

      send('price', { asset: t, price: priceData })

      // 2. Fetch DB confidence history for trend
      send('status', { step: 'history', msg: 'Fetching confidence history...' })
      const confHistory = await getConfHistory(t)
      send('history', { asset: t, count: confHistory.length })

      // 3. Build prompt
      const ctx = `LIVE DATA — Price: $${priceData.toLocaleString()} · Asset: ${t}`
      const geo = `MACRO CONTEXT: Current geopolitical and macro environment. Fed policy. Risk-on/off regime.`
      const prompt = `Asset: ${t}. Date: ${new Date().toISOString()}. ${ctx}. ${geo}. Specialist analysis for investment committee. Specific price levels. Under 160 words.`

      // 4. Run 6 agents in parallel
      send('status', { step: 'agents', msg: 'Deploying 6 specialist agents...' })
      const agentResults = await runSwarmAgents(prompt)

      // Stream each agent result as it comes
      agentResults.forEach(r => send('agent', r))

      // 5. Confidence model
      const model = calcWeightedConfidence(agentResults)
      const confTrend = calcConfTrend(confHistory, model.score)
      const confTierLabel = CONF_TIER(model.score)

      send('confidence', {
        score: model.score,
        tier: confTierLabel,
        trend: confTrend,
        activeAgents: model.activeAgents,
        excludedAgents: model.excludedAgents,
        effectiveWeights: model.effectiveWeights,
      })

      // 6. Veto rules
      const vetoes: Array<{code: string, detail: string}> = []
      const riskAgent = agentResults.find(r => r.id === 'risk')
      if (riskAgent?.signal === 'REJECTED')
        vetoes.push({ code: 'RISK_MANAGER_REJECT', detail: `Risk agent confidence: ${riskAgent.confidence}%` })
      if (model.score < 60)
        vetoes.push({ code: 'LOW_CONFIDENCE', detail: `Score: ${model.score}% (minimum 60%)` })
      if (model.excludedAgents.length > 0)
        vetoes.push({ code: 'AGENT_EXCLUDED', detail: `Excluded: ${model.excludedAgents.join(',')}. Weights re-normalised.` })

      send('vetoes', { vetoes })

      // 7. Chief Strategist
      send('status', { step: 'chief', msg: 'Chief Strategist synthesising...' })
      const vetoCodes = vetoes.map(v => `${v.code}: ${v.detail}`)
      const chiefText = await runChiefStrategist(agentResults, t, model.score, confTierLabel, confTrend, vetoCodes, ctx, geo)

      // 8. Parse chief output
      const getField = (label: string) => {
        const m = chiefText.match(new RegExp(label + '[:\\s]+([^\\n]+)', 'i'))
        return m?.[1]?.trim() || null
      }
      const approvalStatus =
        chiefText.toUpperCase().includes('APPROVAL STATUS: APPROVED') ? 'APPROVED'
        : chiefText.toUpperCase().includes('APPROVAL STATUS: REJECTED') ? 'REJECTED'
        : 'CONDITIONAL'
      const regime = normalise(getField('REGIME') || '', {
        'trend': 'trending-up', 'down': 'trending-down', 'rang': 'ranging', 'break': 'breakout', 'breakdown': 'breakdown'
      }, 'unknown')
      const bias = normalise(getField('DIRECTIONAL BIAS') || '', { 'bull': 'bullish', 'bear': 'bearish' }, 'neutral')
      const strategyType = normalise(getField('STRATEGY TYPE') || '', {
        'trend': 'trend-continuation', 'range': 'range-reversion', 'break': 'breakout-confirmation', 'risk': 'risk-off-defensive'
      }, '')
      const thesis = getField('INVESTMENT THESIS') || chiefText.slice(0, 400)
      const avoidReason = getField('MAIN REASON TO AVOID')
      const entry = parseNum(chiefText, /ENTRY[^$\n]*\$?([\d,]+\.?\d*)/i)
      const stop = parseNum(chiefText, /STOP\s*(?:LOSS)?[^$\n]*\$?([\d,]+\.?\d*)/i)
      const tp1 = parseNum(chiefText, /(?:TARGET|TP)\s*1[^$\n]*\$?([\d,]+\.?\d*)/i)
      const tp2 = parseNum(chiefText, /(?:TARGET|TP)\s*2[^$\n]*\$?([\d,]+\.?\d*)/i)
      const rr = parseNum(chiefText, /R(?:ISK)?[\/\-]R(?:EWARD)?[:\s]+([\d.]+)/i)
      const posSize = parseNum(chiefText, /POSITION\s*SIZE[^$\n]*\$?([\d,]+\.?\d*)/i)

      send('chief', {
        text: chiefText,
        approvalStatus,
        regime,
        bias,
        strategyType: strategyType || null,
        thesis,
        avoidReason,
        entry, stop, tp1, tp2, rr, posSize,
      })

      // 9. Write to Supabase
      send('status', { step: 'db', msg: 'Saving to Supabase...' })
      const idempotencyKey = genUUID()
      const dqFlag = model.excludedAgents.length > 0 ? 'agent_failure_partial' : 'clean'

      const scanPayload = {
        asset: t,
        price_at_scan: priceData,
        data_quality_flag: dqFlag,
        regime: regime || 'unknown',
        directional_bias: bias || 'neutral',
        strategy_type: strategyType || null,
        weighted_confidence: model.score,
        approval_status: approvalStatus,
        veto_reasons: vetoes.map(v => `${v.code}: ${v.detail}`),
        veto_count: vetoes.length,
        strategist_thesis: thesis,
        avoid_reason: avoidReason || null,
        entry_zone: entry || null,
        stop_loss: stop || null,
        take_profit_1: tp1 || null,
        take_profit_2: tp2 || null,
        risk_reward: rr || null,
        position_size_usd: posSize || null,
        has_agent_failure: model.excludedAgents.length > 0,
        excluded_agents: model.excludedAgents,
        active_agent_count: model.activeAgents.length,
        scan_source: 'manual',
        client_idempotency_key: idempotencyKey,
      }

      const agentPayloads = agentResults.map(a => ({
        agent_id: a.id,
        agent_label: a.label,
        weight: WEIGHTS[a.id] || 0,
        raw_text: a.text,
        signal: a.signal,
        confidence: a.confidence,
        weighted_contribution: a.confidence != null ? Math.round(a.confidence * (model.effectiveWeights[a.id] || 0)) : null,
        error: a.failCategory || null,
        fail_category: a.failCategory || null,
      }))
      agentPayloads.push({
        agent_id: 'chief',
        agent_label: 'Chief Strategist',
        weight: 0,
        raw_text: chiefText,
        signal: approvalStatus,
        confidence: model.score,
        weighted_contribution: null,
        error: null,
        fail_category: null,
      })

      try {
        const { data: scanId, error } = await supabase.rpc('insert_scan_with_agents', {
          p_scan: scanPayload,
          p_agents: agentPayloads,
        })
        if (error) throw new Error(error.message)

        send('saved', { scanId, asset: t, score: model.score, approvalStatus, dqFlag })

        // Write alert if threshold met
        if (model.score >= threshold && (approvalStatus === 'APPROVED' || approvalStatus === 'CONDITIONAL')) {
          await supabase.from('alerts').insert({
            scan_id: scanId,
            asset: t,
            signal: approvalStatus,
            confidence: model.score,
            confidence_tier: confTierLabel,
            regime: regime || 'unknown',
            reason: avoidReason?.slice(0, 200) || null,
            price_at_alert: priceData,
            entry_zone: entry || null,
            stop_loss: stop || null,
            take_profit_1: tp1 || null,
            alert_type: bias === 'bullish' ? 'buy' : bias === 'bearish' ? 'sell' : 'watch',
            acknowledged: false,
            acted_on: false,
          })
        }

        // Log veto risk events
        for (const v of vetoes) {
          await supabase.from('risk_events').insert({
            scan_id: scanId,
            asset: t,
            event_type: 'veto_triggered',
            severity: v.code === 'RISK_MANAGER_REJECT' || v.code === 'LOW_CONFIDENCE' ? 'high' : 'medium',
            description: `${v.code}: ${v.detail}`,
            metadata: { veto_code: v.code, weighted_confidence: model.score },
            resolved: false,
          })
        }

      } catch (dbErr: any) {
        send('db_error', { msg: dbErr.message, idempotencyKey })
      }

      send('done', { asset: t, score: model.score, approvalStatus })

    } catch (err: any) {
      send('error', { msg: err.message || 'Swarm failed' })
    } finally {
      writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
