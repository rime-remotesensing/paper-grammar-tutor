import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../../benchmark/generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../../benchmark/generalization/blindHoldoutV2.ts'
import { buildClauseFrames, childrenByHead, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C2 (Structural Relative Antecedent Resolution) section 14 -- new hard
 * gates, run as INDEPENDENT corpus-wide audits over the full 96-sentence generalization
 * corpus (never reusing stanzaStructureTree.ts's own construction logic as the check):
 *
 * - RELATIVE_ANTECEDENT_SCOPE_CORRECTNESS = 100% (structural validity, not lexical gold
 *   labels -- the 96-case corpus has no hand-annotated antecedent gold standard, so this
 *   independently re-derives the STRUCTURAL invariants a correct antecedent span must
 *   satisfy from the frozen ClauseFrame authority, never from stanzaStructureTree.ts's own
 *   internal antecedent-grounding code path).
 * - RELATIVE_ANTECEDENT_FALSE_BINDING = 0 (no sibling in the RENDERED presentation receives
 *   antecedent styling unless its own span is actually covered by the resolved antecedent).
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

const missingArtifact = SPLITS.some((split) => !fs.existsSync(path.join(process.cwd(), 'benchmark', 'results', 'generalization', split.rawFile)))

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

describe('Prototype 2.6G2.6C2 section 14 -- RELATIVE_ANTECEDENT_SCOPE_CORRECTNESS = 100% (96-sentence corpus)', () => {
  it.skipIf(missingArtifact)('every resolved antecedent span is a valid, non-circular span that never crosses into an unrelated clause\'s own predicate', () => {
    let totalRelatives = 0
    let resolved = 0
    let violations = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        const tokens = parsed.tokens
        const byHead = childrenByHead(tokens)
        const byId = new Map(tokens.map((t) => [t.id, t]))
        const clauses = buildClauseFrames(item.text, tokens, byHead)
        const tree = buildStanzaHierarchicalTree(item.text, tokens)
        const relatives = flatten(tree).filter((n) => n.role === 'relativeClause')

        for (const relcl of relatives) {
          totalRelatives += 1
          const ant = relcl.antecedentSpan
          if (!ant) continue // undefined is always valid -- section 10's "no invented binding"
          resolved += 1

          // (1) Well-formed span, within sentence bounds.
          if (!(ant.start >= 0 && ant.end <= item.text.length && ant.start < ant.end)) {
            violations += 1
            failures.push(`${split.name}/${item.id}: malformed antecedent span for "${relcl.presentationSpan?.text ?? relcl.text}"`)
            continue
          }
          // (2) No circularity: the antecedent must never overlap the relative clause's own
          // full authority span (it would otherwise be "its own antecedent").
          const overlapsSelf = Math.max(ant.start, relcl.start) < Math.min(ant.end, relcl.end)
          if (overlapsSelf) {
            violations += 1
            failures.push(`${split.name}/${item.id}: antecedent "${item.text.slice(ant.start, ant.end)}" overlaps its own relative clause`)
            continue
          }
          // (3) Never crosses into an UNRELATED clause's own predicate head -- a genuine
          // antecedent NP (even a coordinated one) never contains another clause's own verb.
          // Independently re-derived from the frozen ClauseFrame authority, never from
          // stanzaStructureTree.ts's own antecedent-grounding logic.
          for (const clause of clauses) {
            for (const predicateHeadId of clause.predicateHeadIds) {
              const headToken = byId.get(predicateHeadId)
              if (!headToken) continue
              if (headToken.start >= ant.start && headToken.end <= ant.end) {
                violations += 1
                failures.push(
                  `${split.name}/${item.id}: antecedent "${item.text.slice(ant.start, ant.end)}" wrongly contains clause predicate "${headToken.text}"`,
                )
              }
            }
          }
        }
      }
    }

    if (failures.length > 0) console.error(`RELATIVE_ANTECEDENT_SCOPE_CORRECTNESS failures (${failures.length}):\n${failures.slice(0, 50).join('\n')}`)
    console.log(`RELATIVE_ANTECEDENT_SCOPE_CORRECTNESS audit: ${totalRelatives} relative clauses, ${resolved} resolved; violations: ${violations}`)
    expect(violations).toBe(0)
  })
})

/**
 * Reproduces StructureTreeView.tsx's own sibling-level antecedent-promotion SIGNAL (a
 * 'relativeClause' node present among a set of siblings marks every 'coordinationMember'
 * sibling at that SAME level as the antecedent) directly from the node tree's own parent/
 * child structure -- sibling adjacency is tree DATA, not component construction logic, so
 * this is an independent structural check, not a re-execution of the view's own code.
 */
function collectFalseBindings(nodes: StructureTreeNode[], text: string, failures: string[]): void {
  const relativeSiblings = nodes.filter((n) => n.role === 'relativeClause' && n.antecedentSpan)
  if (relativeSiblings.length > 0) {
    for (const member of nodes) {
      if (member.role !== 'coordinationMember') continue
      const memberSpan = member.presentationSpan ?? { start: member.start, end: member.end }
      const covered = relativeSiblings.some((r) => memberSpan.start >= r.antecedentSpan!.start && memberSpan.end <= r.antecedentSpan!.end)
      if (!covered) {
        failures.push(`coordination member "${text.slice(memberSpan.start, memberSpan.end)}" would be marked antecedent (sibling relativeClause present) but is outside its resolved antecedent span "${text.slice(relativeSiblings[0]!.antecedentSpan!.start, relativeSiblings[0]!.antecedentSpan!.end)}"`)
      }
    }
  }
  for (const node of nodes) collectFalseBindings(node.children, text, failures)
}

describe('Prototype 2.6G2.6C2 section 14 -- RELATIVE_ANTECEDENT_FALSE_BINDING = 0 (96-sentence corpus)', () => {
  it.skipIf(missingArtifact)('no coordination member is marked as the antecedent unless its own span is covered by the resolved antecedent span', () => {
    let violations = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        const tree = buildStanzaHierarchicalTree(item.text, parsed.tokens)
        const caseFailures: string[] = []
        collectFalseBindings(tree, item.text, caseFailures)
        for (const f of caseFailures) failures.push(`${split.name}/${item.id}: ${f}`)
        violations += caseFailures.length
      }
    }

    if (failures.length > 0) console.error(`RELATIVE_ANTECEDENT_FALSE_BINDING failures (${failures.length}):\n${failures.slice(0, 50).join('\n')}`)
    console.log(`RELATIVE_ANTECEDENT_FALSE_BINDING audit: violations: ${violations}`)
    expect(violations).toBe(0)
  })
})

/**
 * Prototype 2.6G2.6C3 (Conservative Relative Scope) section 10 -- two further independent
 * gates, re-deriving evidence from the raw tokens directly (never reusing
 * `relativeClauseAgreement`/the promotion decision inside stanzaStructureTree.ts):
 *
 * - RELATIVE_FALSE_WHOLE_COORDINATION_BINDING = 0 -- an antecedentSpan that covers 2+
 *   coordinationMember siblings (a genuine whole-coordination binding) must never coexist
 *   with a relative clause whose own copula/aux shows CLEARLY SINGULAR agreement (which
 *   cannot grammatically agree with a true collective reading of a 2+-member coordination).
 * - RELATIVE_UNSUPPORTED_MEMBER_BINDING = 0 -- a single-member antecedentSpan must actually
 *   be the member the relative clause is structurally nested under (or, for a genuinely
 *   non-coordinated single NP, the NP the relative clause's own raw `acl:relcl` dependency
 *   attaches to) -- never an unrelated/unsupported span.
 *
 * Absence of a binding (antecedentSpan === undefined) is always a PASS for both gates --
 * correct abstention is valid, never scored as a failure.
 */
const SINGULAR_FORMS_INDEPENDENT = new Set(['is', 'was', 'has'])

describe('Prototype 2.6G2.6C3 -- RELATIVE_FALSE_WHOLE_COORDINATION_BINDING = 0 (96-sentence corpus)', () => {
  it.skipIf(missingArtifact)('no whole-coordination antecedent binding coexists with a clearly singular relative-clause copula/aux', () => {
    let violations = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        const tokens = parsed.tokens
        const byHead = childrenByHead(tokens)
        const tree = buildStanzaHierarchicalTree(item.text, tokens)

        for (const relcl of flatten(tree).filter((n) => n.role === 'relativeClause')) {
          const ant = relcl.antecedentSpan
          if (!ant) continue
          const coveredMembers = flatten(tree).filter(
            (n) => n.role === 'coordinationMember' && (n.presentationSpan ?? n).start >= ant.start && (n.presentationSpan ?? n).end <= ant.end,
          )
          if (coveredMembers.length < 2) continue // not a whole-coordination binding
          const relclHeadToken = tokens.find((t) => t.deprel === 'acl:relcl' && t.start >= relcl.start && t.end <= relcl.end)
          if (!relclHeadToken) continue
          const copOrAux = (byHead.get(relclHeadToken.id) ?? []).find((c) => c.deprel === 'cop' || c.deprel === 'aux' || c.deprel === 'aux:pass')
          if (copOrAux && SINGULAR_FORMS_INDEPENDENT.has(copOrAux.text.toLowerCase())) {
            violations += 1
            failures.push(`${split.name}/${item.id}: whole-coordination antecedent "${item.text.slice(ant.start, ant.end)}" paired with singular "${copOrAux.text}"`)
          }
        }
      }
    }

    if (failures.length > 0) console.error(`RELATIVE_FALSE_WHOLE_COORDINATION_BINDING failures (${failures.length}):\n${failures.join('\n')}`)
    console.log(`RELATIVE_FALSE_WHOLE_COORDINATION_BINDING audit: violations: ${violations}`)
    expect(violations).toBe(0)
  })
})

describe('Prototype 2.6G2.6C3 -- RELATIVE_UNSUPPORTED_MEMBER_BINDING = 0 (96-sentence corpus)', () => {
  it.skipIf(missingArtifact)('a single-member antecedent span is always the member the relative clause is actually nested under', () => {
    let violations = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        const tree = buildStanzaHierarchicalTree(item.text, parsed.tokens)
        const all: { node: StructureTreeNode; parents: StructureTreeNode[] }[] = []
        const walk = (nodes: StructureTreeNode[], parents: StructureTreeNode[]) => {
          for (const n of nodes) {
            all.push({ node: n, parents })
            walk(n.children, [...parents, n])
          }
        }
        walk(tree, [])

        for (const { node: relcl, parents } of all) {
          if (relcl.role !== 'relativeClause' || !relcl.antecedentSpan) continue
          const ant = relcl.antecedentSpan
          const coveredMembers = all.filter(
            (v) => v.node.role === 'coordinationMember' && (v.node.presentationSpan ?? v.node).start >= ant.start && (v.node.presentationSpan ?? v.node).end <= ant.end,
          )
          if (coveredMembers.length !== 1) continue // whole-coordination or no-member case, checked elsewhere
          const member = coveredMembers[0]!.node
          // The member must be a genuine structural relative of the relative clause -- either
          // its direct parent (the local/nested case) or its immediate parent's OWN sibling
          // (a promoted relative clause whose antecedent was widened to exactly one member,
          // e.g. a 2-member coordination where the second member independently failed the
          // whole-coordination check) -- never an arbitrary node that merely happens to fall
          // inside the numeric span range.
          const parent = parents[parents.length - 1]
          const isDirectChild = member.children.includes(relcl)
          const isParentSibling = parent !== undefined && all.some((v) => v.node === member && v.parents[v.parents.length - 1] === parents[parents.length - 2])
          if (!isDirectChild && !isParentSibling) {
            violations += 1
            failures.push(`${split.name}/${item.id}: antecedent "${item.text.slice(ant.start, ant.end)}" not structurally supported by member "${member.text}"`)
          }
        }
      }
    }

    if (failures.length > 0) console.error(`RELATIVE_UNSUPPORTED_MEMBER_BINDING failures (${failures.length}):\n${failures.join('\n')}`)
    console.log(`RELATIVE_UNSUPPORTED_MEMBER_BINDING audit: violations: ${violations}`)
    expect(violations).toBe(0)
  })
})
