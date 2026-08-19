import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../../benchmark/generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../../benchmark/generalization/blindHoldoutV2.ts'
import { buildHierarchical } from '../../benchmark/generalization/stanzaHierarchicalAdapterEval.ts'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G1 -- HARD requirement (section 21): the production hierarchical converter
 * must reproduce the frozen benchmark converter (Prototype 2.6F, commit
 * da6cb57ec1dc3ccf4de3602f856bc6cdd11600ca) exactly, over the full 96-sentence frozen
 * regression corpus (development 48 + former holdout 24 + BLIND_HOLDOUT_V2 24), using only
 * the already-saved raw Stanza artifacts -- no new Stanza inference here.
 *
 * This test intentionally imports the frozen benchmark module as the reference oracle.
 * Production RUNTIME code never imports from benchmark/ (see stanzaSyntaxAuthority.ts,
 * stanzaSyntaxClient.ts, analyzeSyntaxAuthority.ts) -- only this test does, and only to prove
 * parity, per Prototype 2.6G1 section 3.
 */

interface RawParsedCase {
  id: string
  text: string
  tokens: StanzaToken[]
}

function loadRaw(fileName: string): RawParsedCase[] {
  const filePath = path.join(process.cwd(), 'benchmark', 'results', 'generalization', fileName)
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { results: RawParsedCase[] }
  return parsed.results
}

const SPLITS: Array<{ name: string; cases: readonly { id: string; text: string }[]; rawFile: string }> = [
  { name: 'development', cases: DEVELOPMENT_CASES, rawFile: 'stanza-development.json' },
  { name: 'former holdout', cases: LOCKED_HOLDOUT_CASES, rawFile: 'stanza-holdout.json' },
  { name: 'blind holdout v2', cases: BLIND_HOLDOUT_V2, rawFile: 'stanza-blind-v2.json' },
]

function normalizeSpan(span: { text: string; start: number; end: number } | null) {
  if (!span) return null
  return { text: span.text, start: span.start, end: span.end }
}

describe('Prototype 2.6G1 production/frozen-benchmark parity (96-sentence regression corpus)', () => {
  let missingArtifact = false
  for (const split of SPLITS) {
    const rawPath = path.join(process.cwd(), 'benchmark', 'results', 'generalization', split.rawFile)
    if (!fs.existsSync(rawPath)) missingArtifact = true
  }

  it.skipIf(missingArtifact)('reproduces the frozen benchmark converter exactly for all 96 cases', () => {
    let total = 0
    let parityCount = 0
    const mismatches: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) {
          mismatches.push(`${split.name}/${item.id}: no raw artifact entry`)
          continue
        }
        total += 1

        // Frozen benchmark reference (only needs `.text`, per buildHierarchical's own contract).
        const frozen = buildHierarchical({ text: item.text } as never, parsed as never)

        // Production converter under test.
        const production = buildSentenceCoreSetFromStanzaTokens(item.text, parsed.tokens)

        const frozenSubject = normalizeSpan(frozen.subject)
        const productionSubject = normalizeSpan(production.coreSet.subject)
        const subjectMatches = JSON.stringify(frozenSubject) === JSON.stringify(productionSubject)

        const frozenCores = frozen.predicateCores.map((c) => ({
          relation: c.relation,
          connector: normalizeSpan(c.connector),
          verb: normalizeSpan(c.verb),
          indirectObject: normalizeSpan(c.indirectObject),
          object: normalizeSpan(c.object),
          complement: normalizeSpan(c.complement),
          pattern: c.pattern,
        }))
        const productionCores = production.coreSet.predicateCores.map((c) => ({
          relation: c.relation,
          connector: normalizeSpan(c.connector),
          verb: normalizeSpan(c.verb),
          indirectObject: normalizeSpan(c.indirectObject),
          object: normalizeSpan(c.object),
          complement: normalizeSpan(c.complement),
          pattern: c.pattern,
        }))
        const coresMatch = JSON.stringify(frozenCores) === JSON.stringify(productionCores)

        if (subjectMatches && coresMatch) {
          parityCount += 1
        } else {
          mismatches.push(
            `${split.name}/${item.id}: ${subjectMatches ? '' : 'subject differs; '}${coresMatch ? '' : 'predicateCores differ'}`,
          )
        }
      }
    }

    if (mismatches.length > 0) {
      console.error(`Parity mismatches (${mismatches.length}):\n${mismatches.join('\n')}`)
    }
    expect(total).toBe(96)
    expect(parityCount).toBe(total)
  })
})
