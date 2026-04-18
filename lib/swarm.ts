import Anthropic from '@anthropic-ai/sdk'
import { AGENTS, WEIGHTS, SIG_SCORES, CHIEF_SYSTEM } from './agents'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const FAIL_TEXT = 'Analysis unavailable.'

export interface AgentResult {
  id: string
  label: string
  text: string
  confidence: number | null
  signal: string | null
  failCategory: 'timeout' | 'invalid_response' | 'upstream_api_error' | null
}

export interface ConfidenceModel {
  score: number
  activeAgents: string[]
  excludedAgents: string[]
  effectiveWeights: Record<string, number>
}

function getSig(text: string): string | null {
  const signals = ['STRONG BUY', 'STRONG SELL', 'BUY', 'SELL', 'NEUTRAL', 'APPROVED', 'REJECTED', 'CONDITIONAL']
  return signals.find(s => text.toUpperCase().includes(s)) || null
}

function getConf(text: string): number | null {
  const m = text.match(/CONFIDENCE:\s*(\d+)%?/i)
  return m ? parseInt(m[1]) : null
}

export function calcWeightedConfidence(agentRes: AgentResult[]): ConfidenceModel {
  const active = agentRes.filter(r => WEIGHTS[r.id] && r.text !== FAIL_TEXT)
  const excluded = agentRes.filter(r => WEIGHTS[r.id] && r.text === FAIL_TEXT)
  const wsum = active.reduce((s, r) => s + WEIGHTS[r.id], 0)

  if (wsum === 0) return { score: 50, activeAgents: [], excludedAgents: excluded.map(r => r.id), effectiveWeights: {} }

  let total = 0
  const effectiveWeights: Record<string, number> = {}

  active.forEach(r => {
    const normW = WEIGHTS[r.id] / wsum
    effectiveWeights[r.id] = normW
    const conf = Math.min(100, Math.max(0, r.confidence || 50))
    const sigScore = SIG_SCORES[r.signal || ''] ?? 0
    const effective = sigScore >= 0 ? conf : Math.max(0, 100 - conf)
    total += effective * normW
  })

  return {
    score: Math.min(100, Math.max(0, Math.round(total))),
    activeAgents: active.map(r => r.id),
    excludedAgents: excluded.map(r => r.id),
    effectiveWeights,
  }
}

// Run a single agent — called in parallel
async function runAgent(agent: typeof AGENTS[0], prompt: string): Promise<AgentResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 900,
      system: agent.system,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : FAIL_TEXT

    return {
      id: agent.id,
      label: agent.label,
      text,
      confidence: getConf(text),
      signal: getSig(text),
      failCategory: null,
    }
  } catch (e: any) {
    const msg = (e?.message || '').toLowerCase()
    const failCategory =
      msg.includes('timeout') || msg.includes('abort') ? 'timeout'
      : msg.includes('429') || msg.includes('500') || msg.includes('503') ? 'upstream_api_error'
      : 'invalid_response'

    return {
      id: agent.id,
      label: agent.label,
      text: FAIL_TEXT,
      confidence: null,
      signal: null,
      failCategory,
    }
  }
}

// Run all 6 specialist agents in parallel
export async function runSwarmAgents(prompt: string): Promise<AgentResult[]> {
  return Promise.all(AGENTS.map(agent => runAgent(agent, prompt)))
}

// Run the Chief Strategist synthesis
export async function runChiefStrategist(
  agentResults: AgentResult[],
  asset: string,
  weightedConf: number,
  confTierLabel: string,
  confTrend: string,
  vetoCodes: string[],
  ctx: string,
  geo: string,
): Promise<string> {
  const chiefPrompt = `You are the Chief Strategist presenting to the Investment Committee. You have received reports from 6 specialist analysts on ${asset}.

${agentResults.map(r => `[${r.label} — Weight: ${Math.round((WEIGHTS[r.id] || 0) * 100)}%]\n${r.text}`).join('\n\n')}

WEIGHTED CONFIDENCE: ${weightedConf}% (${confTierLabel})
CONFIDENCE TREND: ${confTrend}
VETO RULES TRIGGERED: ${vetoCodes.length > 0 ? vetoCodes.join('; ') : 'None'}
${ctx}
${geo}

${vetoCodes.length > 0 ? 'IMPORTANT: Veto rules triggered. Approval status must be REJECTED unless you explicitly override each veto with documented justification.' : ''}

Deliver complete Investment Committee output in exactly this format:

ASSET: ${asset}
REGIME: [trending-up / trending-down / ranging / breakout / breakdown]
DIRECTIONAL BIAS: [bullish / bearish / neutral]
CONFIDENCE: ${weightedConf}%
CONFIDENCE TREND: ${confTrend}
STRATEGY TYPE: [trend-continuation / range-reversion / breakout-confirmation / risk-off-defensive]
ENTRY ZONE: $[price]
STOP LOSS: $[price]
TARGET 1: $[price]
TARGET 2: $[price]
RISK/REWARD: [number]:1
POSITION SIZE: $[amount] (from $1,000 portfolio, max 1% risk)
APPROVAL STATUS: [APPROVED / CONDITIONAL / REJECTED]
INVESTMENT THESIS: [one paragraph]
MAIN REASON TO AVOID: [one sentence]

Professional. Measured. Specific numbers. No hype.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    system: CHIEF_SYSTEM,
    messages: [{ role: 'user', content: chiefPrompt }],
  })

  return response.content[0]?.type === 'text' ? response.content[0].text : 'Chief Strategist unavailable.'
}
