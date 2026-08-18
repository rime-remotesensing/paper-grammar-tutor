import type { SentenceCore, SentenceCoreSet, Span } from '../../src/features/grammar/schemas/grammarAnalysis.schema.ts'
import { deriveStructureNodePresentation, hasLosslessPresentationCoverage } from '../../src/features/grammar/domain/structureNodePresentation.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'
import type { GeneralizationCase, GoldSpan } from './dataset.ts'

export interface CoreMetrics {
  subjectExact: boolean
  verbExact: boolean
  objectExact: boolean
  complementExact: boolean
  patternExact: boolean
  falseComplement: boolean
  falseObject: boolean
  missingCoreSlot: boolean
  overcapturedVerb: boolean
  undercapturedVerb: boolean
}

export interface TreeMetrics {
  duplicateVisibleConstituent: boolean
  parentChildVisibleOverlap: boolean
  lexicalLoss: boolean
  wrongRole: boolean
  unattachedMeaningfulSpan: boolean
  bogusPredicate: boolean
  citationAsGrammarNode: boolean
  equationPlaceholderCorruption: boolean
}

export interface CoreSetMetrics {
  sharedSubjectExact: boolean
  predicateCoreCountExact: boolean
  underSplit: boolean
  overSplit: boolean
  predicateVerbExact: boolean[]
  predicateIndirectObjectExact: boolean[]
  predicateObjectExact: boolean[]
  predicateComplementExact: boolean[]
  predicatePatternExact: boolean[]
  predicateRelationExact: boolean[]
  predicateConnectorExact: boolean[]
  falseComplement: boolean[]
  coreSetExact: boolean
}

function exact(gold: GoldSpan | null, actual: Span | null): boolean {
  if (gold === null) return actual === null
  return actual !== null && gold.start === actual.start && gold.end === actual.end && gold.text === actual.text
}

export function evaluateCore(item: GeneralizationCase, core: SentenceCore): CoreMetrics {
  const gold = item.gold.primaryCore
  const missingCoreSlot = [item.gold.subject, gold.verb, gold.indirectObject, gold.object, gold.complement]
    .some((slot, index) => slot !== null && [core.subject, core.verb, core.indirectObject, core.object, core.complement][index] === null)
  return {
    subjectExact: exact(item.gold.subject, core.subject),
    verbExact: exact(gold.verb, core.verb),
    objectExact: exact(gold.object, core.object),
    complementExact: exact(gold.complement, core.complement),
    patternExact: gold.pattern === core.pattern,
    falseComplement: gold.complement === null && core.complement !== null,
    falseObject: gold.object === null && core.object !== null,
    missingCoreSlot,
    overcapturedVerb: core.verb !== null && core.verb.start <= gold.verb.start && core.verb.end >= gold.verb.end && !exact(gold.verb, core.verb),
    undercapturedVerb: core.verb !== null && gold.verb.start <= core.verb.start && gold.verb.end >= core.verb.end && !exact(gold.verb, core.verb),
  }
}

export function evaluateCoreSet(item: GeneralizationCase, coreSet: SentenceCoreSet): CoreSetMetrics {
  const gold = item.gold.predicateCores
  const actual = coreSet.predicateCores
  const predicateVerbExact = gold.map((core, index) => exact(core.verb, actual[index]?.verb ?? null))
  const predicateIndirectObjectExact = gold.map((core, index) => exact(core.indirectObject, actual[index]?.indirectObject ?? null))
  const predicateObjectExact = gold.map((core, index) => exact(core.object, actual[index]?.object ?? null))
  const predicateComplementExact = gold.map((core, index) => exact(core.complement, actual[index]?.complement ?? null))
  const predicatePatternExact = gold.map((core, index) => core.pattern === actual[index]?.pattern)
  const predicateRelationExact = gold.map((core, index) => core.relation === actual[index]?.relation)
  const predicateConnectorExact = gold.map((core, index) => exact(core.connector, actual[index]?.connector ?? null))
  const falseComplement = gold.map((core, index) => core.complement === null && actual[index]?.complement != null)
  const sharedSubjectExact = exact(item.gold.subject, coreSet.subject)
  const predicateCoreCountExact = gold.length === actual.length
  const allPerCore = [predicateVerbExact, predicateIndirectObjectExact, predicateObjectExact,
    predicateComplementExact, predicatePatternExact, predicateRelationExact, predicateConnectorExact]
    .every((values) => values.every(Boolean))
  return {
    sharedSubjectExact,
    predicateCoreCountExact,
    underSplit: actual.length < gold.length,
    overSplit: actual.length > gold.length,
    predicateVerbExact,
    predicateIndirectObjectExact,
    predicateObjectExact,
    predicateComplementExact,
    predicatePatternExact,
    predicateRelationExact,
    predicateConnectorExact,
    falseComplement,
    coreSetExact: sharedSubjectExact && predicateCoreCountExact && allPerCore,
  }
}

interface FlatNode { node: StructureTreeNode; parent: StructureTreeNode | null }

function flatten(nodes: readonly StructureTreeNode[], parent: StructureTreeNode | null = null): FlatNode[] {
  return nodes.flatMap((node) => [{ node, parent }, ...flatten(node.children, node)])
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end)
}

function isCitation(text: string): boolean {
  return /\bet\s+al\.|\b(?:19|20)\d{2}[a-z]?\b/i.test(text)
}

const EXPECTED_ROLES: Record<string, Set<StructureTreeNode['role']>> = {
  subjectModifier: new Set(['modifier', 'condition', 'clause', 'relativeClause', 'openingModifier']),
  predicateModifier: new Set(['modifier', 'condition', 'range', 'clause', 'openingModifier']),
  complementModifier: new Set(['modifier', 'condition', 'range', 'clause']),
  postmodifier: new Set(['modifier', 'condition', 'relativeClause', 'clause']),
  subordinateClause: new Set(['clause', 'openingModifier']),
  coordination: new Set(['coordinatedPredicate', 'object', 'subject', 'other']),
  enumeration: new Set(['object', 'modifier', 'condition', 'clause', 'other']),
}

export function evaluateTree(item: GeneralizationCase, tree: readonly StructureTreeNode[]): TreeMetrics {
  const flat = flatten(tree)
  const presentations = flat.map(({ node }) => ({ node, visible: deriveStructureNodePresentation(node) }))
  const visibleKeys = presentations.map(({ node, visible }) => `${node.role}:${visible.start}:${visible.end}:${visible.text}`)
  const duplicateVisibleConstituent = new Set(visibleKeys).size !== visibleKeys.length
  const parentChildVisibleOverlap = flat.some(({ node, parent }) => {
    if (!parent) return false
    return overlaps(deriveStructureNodePresentation(node), deriveStructureNodePresentation(parent))
  })
  const lexicalLoss = flat.some(({ node }) => {
    if (node.children.length === 0) return false
    const authority = node.presentationSpan ?? { text: node.text, start: node.start, end: node.end }
    const visible = [deriveStructureNodePresentation(node), ...node.children.map(deriveStructureNodePresentation)]
    return !hasLosslessPresentationCoverage(authority, visible)
  })
  const wrongRole = item.gold.attachments.some((attachment) => {
    const exactNodes = flat.filter(({ node }) => node.start === attachment.span.start && node.end === attachment.span.end)
    return exactNodes.length > 0 && exactNodes.every(({ node }) => !EXPECTED_ROLES[attachment.role].has(node.role))
  })
  const unattachedMeaningfulSpan = item.gold.attachments.some((attachment) =>
    !flat.some(({ node }) => node.start <= attachment.span.start && attachment.span.end <= node.end))
  const goldVerbs = item.gold.predicateCores.map(({ verb }) => verb)
  const bogusPredicate = flat.some(({ node }) =>
    (node.role === 'predicate' || node.role === 'coordinatedPredicate') &&
    !goldVerbs.some((verb) => overlaps(node, verb)))
  const citationAsGrammarNode = flat.some(({ node }) => isCitation(node.text))
  const equationPlaceholderCorruption = flat.some(({ node }) =>
    node.text.includes('[式') && !item.text.includes(node.text))
  return {
    duplicateVisibleConstituent,
    parentChildVisibleOverlap,
    lexicalLoss,
    wrongRole,
    unattachedMeaningfulSpan,
    bogusPredicate,
    citationAsGrammarNode,
    equationPlaceholderCorruption,
  }
}

export function wordLengthBin(wordCount: number): '<=20' | '21-40' | '41-60' | '61-80' | '>80' {
  if (wordCount <= 20) return '<=20'
  if (wordCount <= 40) return '21-40'
  if (wordCount <= 60) return '41-60'
  if (wordCount <= 80) return '61-80'
  return '>80'
}

export function rate<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  return items.length === 0 ? 0 : items.filter(predicate).length / items.length
}
