'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const WATCHLIST_DEFAULT = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'LINK', 'AVAX']
const SCAN_INTERVALS = [
  { label: '5 min', value: 5 * 60 * 1000 },
  { label: '15 min', value: 15 * 60 * 1000 },
  { label: '30 min', value: 30 * 60 * 1000 },
  { label: '1 hr', value: 60 * 60 * 1000 },
]
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple',
  BNB: 'binancecoin', LINK: 'chainlink', AVAX: 'avalanche-2',
  ADA: 'cardano', DOGE: 'dogecoin', HYPE: 'hyperliquid', TAO: 'bittensor',
}
const CONF_TIER = (n: number) => {
  if (n >= 90) return { label: 'Exceptional', color: '#2dd4bf' }
  if (n >= 80) return { label: 'High Quality', color: '#4ade80' }
  if (n >= 70) return { label: 'Conditional', color: '#facc15' }
  if (n >= 60) return { label: 'Watch Only', color: '#f97316' }
  return { label: 'No Trade', color: '#ef4444' }
}
const SIG_META: Record<string, { c: string; bg: string; label: string }> = {
  'STRONG BUY':  { c: '#2dd4bf', bg: '#071a18', label: 'Strong Buy' },
  'BUY':         { c: '#4ade80', bg: '#071810', label: 'Buy' },
  'NEUTRAL':     { c: '#94a3b8', bg: '#111827', label: 'Neutral' },
  'SELL':        { c: '#f87171', bg: '#180707', label: 'Sell' },
  'STRONG SELL': { c: '#ef4444', bg: '#130404', label: 'Strong Sell' },
  'APPROVED':    { c: '#4ade80', bg: '#071810', label: 'Approved' },
  'CONDITIONAL': { c: '#facc15', bg: '#181400', label: 'Conditional' },
  'REJECTED':    { c: '#ef4444', bg: '#130404', label: 'Rejected' },
}

const AGENT_DEFS = [
  { id: 'ta',    abbr: 'TA', label: 'Technical Analyst',           weight: '30%', color: '#2dd4bf', dim: '#071a18' },
  { id: 'of',    abbr: 'OF', label: 'Order Flow / Market Behaviour', weight: '15%', color: '#a78bfa', dim: '#130e28' },
  { id: 'sent',  abbr: 'SE', label: 'Sentiment',                   weight: '10%', color: '#f97316', dim: '#1f1008' },
  { id: 'oc',    abbr: 'OC', label: 'On-Chain / Structural',        weight: '10%', color: '#818cf8', dim: '#0f0d22' },
  { id: 'macro', abbr: 'MA', label: 'Macro / Cross-Asset',          weight: '15%', color: '#60a5fa', dim: '#080f1c' },
  { id: 'risk',  abbr: 'RM', label: 'Risk Manager',                 weight: '20%', color: '#facc15', dim: '#181400' },
]

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtP = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1000 ? `$${fmt(n, 0)}` : n >= 1 ? `$${fmt(n, 2)}` : `$${Number(n).toFixed(6)}`
const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${fmt(n, 2)}%`
const tsFmt = () => new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
const getSig = (t = '') => Object.keys(SIG_META).find(k => t.toUpperCase().includes(k)) || null

// ─────────────────────────────────────────────────────────────────────────────
// UI ATOMS
// ─────────────────────────────────────────────────────────────────────────────
function Pill({ text, sm }: { text: string; sm?: boolean }) {
  const s = getSig(text)
  if (!s) return null
  const { c, bg, label } = SIG_META[s]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: bg, border: `1px solid ${c}30`, color: c, borderRadius: 3, padding: sm ? '2px 7px' : '4px 11px', fontSize: sm ? 9 : 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: c }} />
      {label}
    </span>
  )
}

function Bar({ val, color }: { val: number | null; color?: string }) {
  if (val == null) return null
  const n = Math.min(100, Math.max(0, Math.round(val)))
  const c = color || (n >= 80 ? '#2dd4bf' : n >= 65 ? '#facc15' : '#f87171')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 2, background: '#1a2030', borderRadius: 1, overflow: 'hidden' }}>
        <div style={{ width: `${n}%`, height: '100%', background: c, transition: 'width 1.2s ease' }} />
      </div>
      <span style={{ fontSize: 10, color: c, fontWeight: 600, minWidth: 30, textAlign: 'right' }}>{n}%</span>
    </div>
  )
}

function Spark({ data }: { data: { price: number }[] }) {
  if (!data || data.length < 2) return null
  const ps = data.map(d => d.price)
  const mn = Math.min(...ps), mx = Math.max(...ps), rng = mx - mn || 1
  const pts = ps.map((p, i) => `${(i / (ps.length - 1)) * 80},${24 - ((p - mn) / rng) * 22 + 1}`).join(' ')
  return (
    <svg width={80} height={24} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={ps[ps.length - 1] >= ps[0] ? '#4ade80' : '#f87171'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT CARD
// ─────────────────────────────────────────────────────────────────────────────
function AgentCard({ agent, status, result }: { agent: typeof AGENT_DEFS[0]; status: string; result: any }) {
  const done = status === 'done', loading = status === 'loading'
  return (
    <div style={{ background: '#080f1c', border: `1px solid ${done ? '#1a2535' : '#0d1525'}`, borderLeft: `2px solid ${done ? agent.color : loading ? agent.color + '40' : '#1a2535'}`, borderRadius: 4, padding: '12px 14px', position: 'relative', overflow: 'hidden' }}>
      {loading && <div style={{ position: 'absolute', bottom: 0, left: 0, height: 1, width: '70%', background: `linear-gradient(90deg,transparent,${agent.color})`, animation: 'shimmer 1.5s ease infinite' }} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 24, height: 24, borderRadius: 4, background: agent.dim, border: `1px solid ${agent.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: agent.color }}>{agent.abbr}</div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1' }}>{agent.label}</div>
            <div style={{ fontSize: 9, color: '#334155', marginTop: 1 }}>Weight: {agent.weight} · {done ? tsFmt() : loading ? 'Analysing...' : 'Standby'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {done && result?.signal && <Pill text={result.signal} sm />}
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: done ? agent.color : loading ? agent.color : '#1a2535', boxShadow: loading ? `0 0 6px ${agent.color}` : done ? `0 0 4px ${agent.color}50` : 'none', animation: loading ? 'pulse 1.2s ease infinite' : 'none' }} />
        </div>
      </div>
      {done && result?.confidence != null && <div style={{ marginBottom: 7 }}><Bar val={result.confidence} /></div>}
      <div style={{ fontSize: 11, lineHeight: 1.7, color: done ? '#64748b' : '#1a2535', minHeight: 36 }}>
        {loading && <span style={{ color: '#1e3a5a', fontSize: 10 }}>Evaluating...</span>}
        {done && result?.text && <span>{result.text.replace(/SIGNAL:.*$/im, '').replace(/CONFIDENCE:.*$/im, '').trim().slice(0, 240)}</span>}
        {status === 'idle' && <span style={{ color: '#1a2535', fontSize: 10 }}>Awaiting dispatch</span>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function CryptoSwarmCommand() {
  const [tab, setTab] = useState('command')
  const [watchlist, setWatchlist] = useState(WATCHLIST_DEFAULT)
  const [threshold] = useState(70)
  const [scanIdx, setScanIdx] = useState(0)
  const [autoScan, setAutoScan] = useState(false)
  const [prices, setPrices] = useState<Record<string, any>>({})
  const [sparklines, setSparklines] = useState<Record<string, any[]>>({})
  const [priceLoad, setPriceLoad] = useState(true)
  const [ticker, setTicker] = useState('')
  const [input, setInput] = useState('')
  const [agentStatus, setAgentStatus] = useState<Record<string, string>>({})
  const [agentResults, setAgentResults] = useState<Record<string, any>>({})
  const [chiefData, setChiefData] = useState<any>(null)
  const [swarmRunning, setSwarmRunning] = useState(false)
  const [dbStatus, setDbStatus] = useState('idle')
  const [execLog, setExecLog] = useState<{ msg: string; type: string; time: string }[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [newTicker, setNewTicker] = useState('')
  const [confHistory, setConfHistory] = useState<Record<string, number[]>>({})
  const countdown = useRef('')
  const scanTimer = useRef<any>(null)
  const cntTimer = useRef<any>(null)
  const cycleRef = useRef(0)

  const log = (msg: string, type = 'info') =>
    setExecLog(p => [{ msg, type, time: tsFmt() }, ...p.slice(0, 199)])

  // Live prices
  useEffect(() => {
    const load = async () => {
      setPriceLoad(true)
      try {
        const ids = [...new Set(watchlist.map(s => COINGECKO_IDS[s]).filter(Boolean))].join(',')
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`)
        const d = await r.json()
        const out: Record<string, any> = {}
        watchlist.forEach(s => {
          const id = COINGECKO_IDS[s]
          if (id && d[id]) out[s] = { price: d[id].usd, change24h: d[id].usd_24h_change, vol: d[id].usd_24h_vol, mcap: d[id].usd_market_cap }
        })
        setPrices(out)
      } catch {}
      setPriceLoad(false)
    }
    load()
    const iv = setInterval(load, 45000)
    return () => clearInterval(iv)
  }, [watchlist])

  // Full 7-agent swarm — calls /api/swarm server-side route via SSE
  const runSwarm = useCallback(async (overrideTicker?: string) => {
    const t = (overrideTicker || input).trim().toUpperCase()
    if (!t || swarmRunning) return
    setTab('swarm')
    setTicker(t)
    setSwarmRunning(true)
    setChiefData(null)
    setDbStatus('idle')
    const initStatus: Record<string, string> = {}
    AGENT_DEFS.forEach(a => { initStatus[a.id] = 'loading' })
    setAgentStatus(initStatus)
    setAgentResults({})
    if (overrideTicker) setInput(overrideTicker)

    log(`🚀 Deploying 7 agents on ${t}...`, 'info')

    try {
      const res = await fetch('/api/swarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: t, threshold }),
      })

      if (!res.ok) throw new Error(`API error ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6))
            const eventLine = lines.find(l => l.startsWith('event: '))
            const event = eventLine?.slice(7) || 'message'

            // Parse event from the SSE stream
            // We need to track the event type properly
            handleSSEPayload(line, lines, t)
          } catch {}
        }
      }

      // Parse SSE properly
      // Re-do with proper SSE parsing
    } catch (err: any) {
      log(`⚠ Swarm failed: ${err.message}`, 'error')
      setDbStatus('error')
    } finally {
      setSwarmRunning(false)
    }
  }, [input, swarmRunning, threshold])

  function handleSSEPayload(dataLine: string, context: string[], asset: string) {
    // This is handled in the proper SSE parse below
  }

  // Better SSE handling
  const runSwarmProper = useCallback(async (overrideTicker?: string) => {
    const t = (overrideTicker || input).trim().toUpperCase()
    if (!t || swarmRunning) return
    setTab('swarm')
    setTicker(t)
    setSwarmRunning(true)
    setChiefData(null)
    setDbStatus('idle')
    const initStatus: Record<string, string> = {}
    AGENT_DEFS.forEach(a => { initStatus[a.id] = 'loading' })
    setAgentStatus(initStatus)
    setAgentResults({})
    if (overrideTicker) setInput(overrideTicker)

    log(`🚀 Deploying 7 agents on ${t}...`, 'info')

    try {
      const res = await fetch('/api/swarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: t, threshold }),
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      const processEvent = (eventType: string, data: any) => {
        switch (eventType) {
          case 'error':
            log(`⛔ ${data.msg}`, 'error')
            setDbStatus('error')
            break
          case 'price':
            log(`💰 ${t} price: ${fmtP(data.price)}`, 'info')
            break
          case 'agent':
            setAgentResults(p => ({ ...p, [data.id]: data }))
            setAgentStatus(p => ({ ...p, [data.id]: 'done' }))
            log(`✓ ${data.label} complete — ${data.signal || 'no signal'} ${data.confidence != null ? data.confidence + '%' : ''}`, 'info')
            break
          case 'confidence':
            log(`📊 Weighted confidence: ${data.score}% (${data.tier}) — trend: ${data.trend}`, 'info')
            break
          case 'chief':
            setChiefData(data)
            setDbStatus('saving')
            log(`📋 Chief Strategist: ${data.approvalStatus} — ${data.score || ''}% `, 'info')
            break
          case 'saved':
            setDbStatus('saved')
            log(`✓ Saved to Supabase · ID: ${String(data.scanId).slice(0, 8)}... · ${t} · ${data.approvalStatus}`, 'success')
            // Update local conf history
            setConfHistory(prev => ({ ...prev, [t]: [...(prev[t] || []), data.score].slice(-10) }))
            break
          case 'db_error':
            setDbStatus('error')
            log(`⚠ DB write failed: ${data.msg}`, 'error')
            break
          case 'done':
            log(`✅ ${t} swarm complete`, 'success')
            break
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() || ''
        for (const part of parts) {
          const eventLine = part.split('\n').find(l => l.startsWith('event: '))
          const dataLine = part.split('\n').find(l => l.startsWith('data: '))
          if (!dataLine) continue
          const eventType = eventLine ? eventLine.slice(7) : 'message'
          try { processEvent(eventType, JSON.parse(dataLine.slice(6))) } catch {}
        }
      }
    } catch (err: any) {
      log(`⚠ ${err.message}`, 'error')
      setDbStatus('error')
    } finally {
      setSwarmRunning(false)
    }
  }, [input, swarmRunning, threshold])

  const portValue = 1000 // placeholder
  const TABS = [
    { id: 'command', label: 'Command Centre' },
    { id: 'swarm', label: 'Swarm Analysis' },
    { id: 'journal', label: 'Research Journal' },
    { id: 'portfolio', label: 'Portfolio' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#050b16', color: '#94a3b8', fontFamily: "'DM Sans','Segoe UI',system-ui,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box}
        @keyframes shimmer{0%{left:-100%;opacity:0}50%{opacity:1}100%{left:100%;opacity:0}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:#050b16}
        ::-webkit-scrollbar-thumb{background:#1a2535;border-radius:2px}
        input::placeholder{color:#1a2535}
        button:hover{opacity:0.8}
        input:focus{border-color:#2dd4bf30!important;outline:none}
      `}</style>

      {/* TOP BAR */}
      <div style={{ borderBottom: '1px solid #0d1525', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 50, background: '#060c18', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#080f1c', border: '1px solid #1a2535', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#2dd4bf' }}>◈</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.3px' }}>Crypto Swarm Command</div>
            <div style={{ fontSize: 9, color: '#1e3a5a', letterSpacing: '0.8px', textTransform: 'uppercase' }}>7-Agent Research Platform · Stage 1 · Next.js</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {['BTC', 'ETH', 'SOL', 'XRP'].map(s => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => runSwarmProper(s)}>
              <span style={{ fontSize: 9, color: '#334155', fontWeight: 600 }}>{s}</span>
              <span style={{ fontSize: 11, color: '#cbd5e1', fontFamily: 'DM Mono,monospace' }}>{prices[s] ? fmtP(prices[s].price) : '—'}</span>
              {prices[s]?.change24h != null && <span style={{ fontSize: 9, color: prices[s].change24h >= 0 ? '#4ade80' : '#f87171' }}>{fmtPct(prices[s].change24h)}</span>}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: priceLoad ? '#facc15' : '#4ade80', animation: priceLoad ? 'pulse 1s ease infinite' : 'none' }} />
            <span style={{ fontSize: 9, color: '#1e3a5a' }}>{priceLoad ? 'Fetching' : 'Live'}</span>
          </div>
          <div style={{ background: '#060c18', border: '1px solid #0d1525', borderRadius: 3, padding: '2px 8px' }}>
            <span style={{ fontSize: 9, color: '#1e3a5a', letterSpacing: '0.5px' }}>RESEARCH ONLY · NO EXECUTION</span>
          </div>
        </div>
      </div>

      <div style={{ padding: '18px 20px' }}>
        {/* TABS */}
        <div style={{ display: 'flex', gap: 1, marginBottom: 18, background: '#060c18', borderRadius: 5, padding: 3, width: 'fit-content', border: '1px solid #0d1525' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ background: tab === t.id ? '#0d1a2e' : 'transparent', border: 'none', borderRadius: 4, color: tab === t.id ? '#cbd5e1' : '#1e3a5a', padding: '6px 14px', cursor: 'pointer', fontSize: 11, fontWeight: tab === t.id ? 600 : 400, transition: 'all 0.15s' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* COMMAND CENTRE */}
        {tab === 'command' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'DB Status', val: 'Connected', c: '#4ade80' },
                { label: 'Stage', val: 'Stage 1 Research', c: '#60a5fa' },
                { label: 'Live Prices', val: priceLoad ? 'Fetching...' : 'Live', c: '#2dd4bf' },
                { label: 'Mode', val: 'No Execution', c: '#f97316' },
              ].map(s => (
                <div key={s.label} style={{ background: '#080f1c', border: '1px solid #0d1525', borderRadius: 5, padding: '12px 14px' }}>
                  <div style={{ fontSize: 8, color: '#1e3a5a', marginBottom: 4, letterSpacing: '0.5px', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: s.c, letterSpacing: '-0.5px' }}>{s.val}</div>
                </div>
              ))}
            </div>

            {/* Watchlist */}
            <div style={{ background: '#080f1c', border: '1px solid #0d1525', borderRadius: 6, padding: 16, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Market Watchlist</div>
                <input value={newTicker} onChange={e => setNewTicker(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newTicker.trim()) { const t = newTicker.trim().toUpperCase(); if (!watchlist.includes(t)) setWatchlist(p => [...p, t]); setNewTicker('') } }} placeholder="Add ticker..." style={{ background: '#050b16', border: '1px solid #0d1525', borderRadius: 4, padding: '5px 10px', color: '#cbd5e1', fontSize: 11, width: 96, outline: 'none' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 7 }}>
                {watchlist.map(sym => {
                  const pd = prices[sym]
                  const ch = confHistory[sym] || []
                  const lastC = ch.length ? ch[ch.length - 1] : null
                  const tier = lastC ? CONF_TIER(lastC) : null
                  return (
                    <div key={sym} style={{ background: '#060c18', border: '1px solid #0a1422', borderRadius: 5, padding: '11px 13px', cursor: 'pointer' }} onClick={() => runSwarmProper(sym)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{sym}</div>
                          <div style={{ fontSize: 11, color: '#475569', fontFamily: 'DM Mono,monospace', marginTop: 1 }}>{pd ? fmtP(pd.price) : '—'}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {pd?.change24h != null && <div style={{ fontSize: 9, fontWeight: 600, color: pd.change24h >= 0 ? '#4ade80' : '#f87171' }}>{fmtPct(pd.change24h)}</div>}
                          {tier && <div style={{ fontSize: 9, color: tier.color, marginTop: 2 }}>{lastC}%</div>}
                        </div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setWatchlist(p => p.filter(x => x !== sym)) }} style={{ position: 'absolute' as any, background: 'none', border: 'none', color: '#1a2535', cursor: 'pointer', fontSize: 11 }}>×</button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* System log */}
            <div style={{ background: '#060c18', border: '1px solid #0d1525', borderRadius: 5 }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid #0d1525', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: '#1e3a5a', letterSpacing: '1px' }}>SYSTEM LOG</span>
                <button onClick={() => setExecLog([])} style={{ background: 'none', border: 'none', color: '#1e3a5a', fontSize: 9, cursor: 'pointer' }}>Clear</button>
              </div>
              <div style={{ padding: '8px 14px', maxHeight: 120, overflowY: 'auto', fontFamily: 'DM Mono,monospace' }}>
                {execLog.length === 0
                  ? <div style={{ fontSize: 10, color: '#1a2535' }}>System ready. Next.js deployment active.</div>
                  : execLog.map((l, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '3px 0', borderBottom: '1px solid #060c18', fontSize: 10, color: l.type === 'success' ? '#4ade80' : l.type === 'error' ? '#f87171' : '#334155' }}>
                      <span style={{ color: '#1a2535', flexShrink: 0, minWidth: 38 }}>{l.time}</span>
                      <span>{l.msg}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* SWARM ANALYSIS */}
        {tab === 'swarm' && (
          <div>
            <div style={{ background: '#080f1c', border: '1px solid #0d1525', borderRadius: 6, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', marginBottom: 8 }}>7-AGENT PARALLEL ANALYSIS · WEIGHTED CONFIDENCE · VETO FILTERS · SERVER-SIDE</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSwarmProper()} placeholder="Enter ticker — BTC · ETH · SOL · XRP · BNB · LINK · AVAX" style={{ flex: 1, background: '#060c18', border: '1px solid #0d1525', borderRadius: 5, padding: '10px 14px', color: '#e2e8f0', fontSize: 13, fontWeight: 500, outline: 'none', fontFamily: 'DM Mono,monospace', letterSpacing: '0.8px' }} />
                <button onClick={() => runSwarmProper()} disabled={swarmRunning || !input.trim()} style={{ background: swarmRunning ? '#0d1525' : 'linear-gradient(135deg,#0d2e28,#0d1f36)', border: `1px solid ${swarmRunning ? '#0d1525' : '#2dd4bf30'}`, borderRadius: 5, padding: '10px 22px', color: swarmRunning ? '#1e3a5a' : '#2dd4bf', fontSize: 11, fontWeight: 600, cursor: swarmRunning ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                  {swarmRunning ? 'Analysing...' : 'Deploy 7 Agents'}
                </button>
              </div>
              <div style={{ marginTop: 7, fontSize: 9, color: '#1e3a5a' }}>TA 30% · OF 15% · Macro 15% · Risk 20% · Sent 10% · OC 10% · <span style={{ color: '#4ade80' }}>Server-side API · Supabase DB</span></div>
            </div>

            {ticker && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                    Specialist Reports — <span style={{ color: '#e2e8f0', fontFamily: 'DM Mono,monospace' }}>{ticker}</span>
                    {prices[ticker] && <span style={{ color: '#475569', fontSize: 11, fontWeight: 400, marginLeft: 8 }}>{fmtP(prices[ticker].price)} · {fmtPct(prices[ticker].change24h)}</span>}
                  </div>
                  <span style={{ fontSize: 9, color: '#1e3a5a' }}>{Object.values(agentStatus).filter(s => s === 'done').length}/{AGENT_DEFS.length} complete</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
                  {AGENT_DEFS.map(a => <AgentCard key={a.id} agent={a} status={agentStatus[a.id] || 'idle'} result={agentResults[a.id]} />)}
                </div>

                {chiefData && (
                  <div style={{ background: '#07101f', border: `1px solid ${chiefData.approvalStatus === 'APPROVED' ? '#2dd4bf20' : chiefData.approvalStatus === 'REJECTED' ? '#ef444420' : '#facc1520'}`, borderTop: `2px solid ${chiefData.approvalStatus === 'APPROVED' ? '#2dd4bf' : chiefData.approvalStatus === 'REJECTED' ? '#ef4444' : '#facc15'}`, borderRadius: 6, padding: 22 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #0d1525' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Chief Strategist · Investment Committee Output</div>
                        <div style={{ fontSize: 9, color: '#334155', marginTop: 2 }}>7-agent synthesis · server-side · Supabase persisted</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, color: '#1e3a5a', marginBottom: 3 }}>WEIGHTED CONFIDENCE</div>
                        <div style={{ fontSize: 26, fontWeight: 700, color: CONF_TIER(chiefData.score || 0).color, fontFamily: 'DM Mono,monospace' }}>{chiefData.score || 0}%</div>
                        <div style={{ fontSize: 9, color: CONF_TIER(chiefData.score || 0).color, fontWeight: 600 }}>{CONF_TIER(chiefData.score || 0).label}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <Pill text={chiefData.approvalStatus || 'CONDITIONAL'} />
                      <div style={{ fontSize: 9, display: 'flex', alignItems: 'center', gap: 5 }}>
                        {dbStatus === 'saving' && <><span style={{ color: '#1e3a5a' }}>●</span><span style={{ color: '#1e3a5a' }}>Saving...</span></>}
                        {dbStatus === 'saved' && <><span style={{ color: '#4ade80' }}>●</span><span style={{ color: '#4ade80' }}>Saved to Supabase</span></>}
                        {dbStatus === 'error' && <><span style={{ color: '#f87171' }}>●</span><span style={{ color: '#f87171' }}>DB write failed</span></>}
                      </div>
                    </div>

                    {chiefData.entry && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 16 }}>
                        {[['ENTRY', fmtP(chiefData.entry), '#94a3b8'], ['STOP LOSS', fmtP(chiefData.stop), '#f87171'], ['TARGET 1', fmtP(chiefData.tp1), '#4ade80'], ['TARGET 2', fmtP(chiefData.tp2), '#2dd4bf'], ['R/R', chiefData.rr ? `${chiefData.rr}:1` : '—', '#facc15']].map(([l, v, c]: any) => (
                          <div key={l} style={{ background: '#060c18', border: '1px solid #0d1525', borderRadius: 4, padding: '9px 12px' }}>
                            <div style={{ fontSize: 8, color: '#334155', marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: c, fontFamily: 'DM Mono,monospace' }}>{v}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ fontSize: 12, lineHeight: 1.9, color: '#64748b', whiteSpace: 'pre-wrap' }}>{chiefData.text}</div>
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #0d1525', fontSize: 9, color: '#1e3a5a' }}>RESEARCH / PAPER TRADING ONLY · NO LIVE EXECUTION · Stage 1</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'journal' && (
          <div style={{ padding: 40, textAlign: 'center', background: '#080f1c', border: '1px solid #0d1525', borderRadius: 6, color: '#1e3a5a', fontSize: 11 }}>
            Research Journal — run swarm analyses to populate. All scans are saved to Supabase automatically.
          </div>
        )}

        {tab === 'portfolio' && (
          <div style={{ padding: 40, textAlign: 'center', background: '#080f1c', border: '1px solid #0d1525', borderRadius: 6, color: '#1e3a5a', fontSize: 11 }}>
            Portfolio tracker — Stage 1 research only. No live positions.
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid #0a1422', padding: '10px 20px', display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 9, color: '#1a2535' }}>Research & paper trading only · No live execution · Stage 1 · Next.js</div>
        <div style={{ fontSize: 9, color: '#1a2535' }}>Crypto Swarm Command · 7-Agent Platform · {new Date().getFullYear()}</div>
      </div>
    </div>
  )
}
