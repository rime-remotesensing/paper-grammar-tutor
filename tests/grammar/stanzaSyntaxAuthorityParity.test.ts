import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../fixtures/generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../fixtures/generalization/blindHoldoutV2.ts'
import { buildHierarchical } from '../fixtures/generalization/stanzaHierarchicalAdapterEval.ts'
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

        // Prototype 2.6G2.5C: `development/d15-svc-svc-coordination` ("The surface is smooth
        // and is relatively uniform.") is an INTENTIONAL, documented divergence, not a
        // regression. The frozen benchmark's own complement grounding has the exact "sparse
        // token set -> contiguous span -> excluded token reinsertion" bug this phase fixes
        // (its own second complement is "and is relatively uniform", wrongly including the
        // connector and copula) -- frozen was never re-run after this phase's fix, by design
        // (it is the frozen 2.6F reference, not touched here). Production's own corrected
        // complement ("relatively uniform") now matches the dataset's own gold annotation
        // exactly, which frozen never did.
        //
        // Prototype 2.6G2.5C2: `development/d34-long-80` is the same class of INTENTIONAL,
        // documented divergence for SUBJECT grounding. The frozen benchmark's own subject is
        // "the new monitoring framework, which integrates hourly rainfall estimates,
        // slope-unit morphology, land-cover transitions, and road-network proximity" (start
        // 82, end 229) -- confirmed by direct inspection of `buildHierarchical`'s own output
        // for this case -- wrongly absorbing the non-restrictive relative clause AND a
        // Stanza UD coordination-attachment-drift artifact (an enumeration item several
        // tokens inside that relative clause spuriously attaches its own `conj` chain
        // directly to the subject head). Production's corrected subject ("the new monitoring
        // framework", start 82, end 110) matches the dataset's own gold annotation exactly.
        //
        // These are the ONLY two cases where the two are allowed to differ; any other case
        // still requires 100% parity.
        const KNOWN_CORRECTED_DIVERGENCE_IDS = new Set(['d15-svc-svc-coordination', 'd34-long-80'])
        const isKnownCorrectedDivergence = KNOWN_CORRECTED_DIVERGENCE_IDS.has(item.id) && !(subjectMatches && coresMatch)
        if (isKnownCorrectedDivergence || (subjectMatches && coresMatch)) {
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
