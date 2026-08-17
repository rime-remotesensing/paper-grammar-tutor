import type { StructureTreeNode } from './structureTree.ts'
import type { ResolvedReadingStep } from '../schemas/readingGuide.schema.ts'

export interface SourceSpan {
  start: number
  end: number
}

export function structureTreeNodeSpan(node: StructureTreeNode): SourceSpan {
  return { start: node.start, end: node.end }
}

export function structureTreeNodeKey(node: StructureTreeNode): string {
  return `${node.start}:${node.end}:${node.role}`
}

/** Returns only the strongest overlap tier, in source order: exact, item contained by
 * tree, tree contained by item, then meaningful partial overlap. */
export function findReadingStepsForTreeNode(
  treeSpan: SourceSpan,
  readingSteps: readonly ResolvedReadingStep[],
): ResolvedReadingStep[] {
  if (!validSpan(treeSpan)) return []

  const ranked = readingSteps
    .filter(validSpan)
    .map((step) => ({ step, rank: overlapRank(treeSpan, step) }))
    .filter((candidate): candidate is { step: ResolvedReadingStep; rank: number } => candidate.rank !== null)

  if (ranked.length === 0) return []
  const bestRank = Math.min(...ranked.map(({ rank }) => rank))
  return ranked
    .filter(({ rank }) => rank === bestRank)
    .sort((a, b) => a.step.start - b.step.start || a.step.end - b.step.end)
    .map(({ step }) => step)
}

function overlapRank(tree: SourceSpan, item: SourceSpan): number | null {
  if (tree.start === item.start && tree.end === item.end) return 0
  if (tree.start <= item.start && item.end <= tree.end) return 1
  if (item.start <= tree.start && tree.end <= item.end) return 2
  if (Math.max(tree.start, item.start) < Math.min(tree.end, item.end)) return 3
  return null
}

function validSpan(span: SourceSpan): boolean {
  return Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start
}
