import type { StructureTreeNode } from './structureTree.ts'
import { restoreTextForRange } from './mathRunPresentation.ts'
import { deriveStructureNodePresentation } from './structureNodePresentation.ts'
import type { Projection } from './textProjection.ts'
import { structureTreeNodeKey, structureTreeNodeSpan } from './treeReadingMatching.ts'

export interface TreeReadingTarget {
  targetId: string
  nodeKey: string
  authoritativeStart: number
  authoritativeEnd: number
  interactionStart: number
  interactionEnd: number
  displayText: string
  authorityText: string
  interactionText: string
  role: StructureTreeNode['role']
  parentTargetId: string | null
  parentDisplayText: string | null
}

/**
 * Derives compact, stable reading targets from final visible Tree paths. Paths include
 * skipped nodes, so adding/removing a note-eligible sibling never renumbers unrelated
 * descendants. Source labels and every span remain application-owned.
 *
 * Prototype 2.6G2.8M2.2c: `projection`/`sourceText` (optional, for backward compatibility)
 * restore any internal "MATH_EXPR" token inside `interactionText` -- the ONE field here whose
 * text is a raw offset-based slice of `sentence` rather than a tree node's own (separately
 * restorable, see mathRunPresentation.ts) `.text`/`presentationSpan.text`. `displayText`/
 * `authorityText` are already clean as long as the CALLER passed an already-restored `nodes`
 * tree (see AnalysisResultPanel.tsx's own restoration-before-use discipline).
 */
export function deriveTreeReadingTargets(
  nodes: readonly StructureTreeNode[],
  sentence: string,
  projection?: Projection,
  sourceText?: string,
): TreeReadingTarget[] {
  const targets: TreeReadingTarget[] = []

  const visit = (
    node: StructureTreeNode,
    path: readonly number[],
    parentTarget: TreeReadingTarget | null,
  ) => {
    const targetId = `tree-${path.join('-')}`
    const presentation = deriveStructureNodePresentation(node)
    const interaction = structureTreeNodeSpan(node)
    let currentTarget: TreeReadingTarget | null = null

    if (isPedagogicalReadingTarget(node, presentation.text)) {
      const rawInteractionText = sentence.slice(interaction.start, interaction.end)
      const target: TreeReadingTarget = {
        targetId,
        nodeKey: structureTreeNodeKey(node),
        authoritativeStart: node.start,
        authoritativeEnd: node.end,
        interactionStart: interaction.start,
        interactionEnd: interaction.end,
        displayText: presentation.text,
        authorityText: node.text,
        interactionText:
          projection && sourceText
            ? restoreTextForRange(rawInteractionText, interaction.start, interaction.end, projection, sourceText)
            : rawInteractionText,
        role: node.role,
        parentTargetId: parentTarget?.targetId ?? null,
        parentDisplayText: parentTarget?.displayText ?? null,
      }
      targets.push(target)
      currentTarget = target
    }

    node.children.forEach((child, index) => visit(child, [...path, index], currentTarget))
  }

  nodes.forEach((node, index) => visit(node, [index], null))
  return targets
}

export function treeReadingTargetSignature(targets: readonly TreeReadingTarget[]): string {
  return targets
    .map((target) => [
      target.targetId,
      target.nodeKey,
      target.authoritativeStart,
      target.authoritativeEnd,
      target.interactionStart,
      target.interactionEnd,
      target.displayText,
      target.authorityText,
      target.interactionText,
      target.role,
      target.parentTargetId ?? '',
      target.parentDisplayText ?? '',
    ].join(':'))
    .join('|')
}

export function findTreeReadingTargetForNode(
  node: StructureTreeNode | null,
  targets: readonly TreeReadingTarget[],
): TreeReadingTarget | null {
  if (!node) return null
  const nodeKey = structureTreeNodeKey(node)
  return targets.find((target) => target.nodeKey === nodeKey) ?? null
}

function isPedagogicalReadingTarget(node: StructureTreeNode, displayText: string): boolean {
  const authority = node.text.trim()
  const display = displayText.trim()
  if (!authority || !display || isCitationLike(authority) || isCitationLike(display)) return false

  const wordCount = (authority.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length
  if (node.role === 'predicate' || node.role === 'coordinatedPredicate') {
    if (/^(?:am|is|are|was|were|be|been|being)$/i.test(authority)) return false
    return wordCount > 1 || node.children.length > 0
  }

  if (node.role === 'subject') {
    return wordCount > 1 || /\b(?:and|or|nor)\b/i.test(authority) || node.children.length > 1
  }

  if (node.role === 'openingModifier' || node.role === 'supplement' || node.role === 'relativeClause' || node.role === 'clause') {
    return true
  }

  return wordCount > 1 || node.children.length > 0
}

function isCitationLike(text: string): boolean {
  const trimmed = text.trim()
  if (/^\[(?:\d+[a-z]?)(?:\s*[-–—,]\s*\d+[a-z]?)*\][.,;:]?$/i.test(trimmed)) return true
  return /^\([^)]*(?:\bet\s+al\.|\b(?:19|20)\d{2}[a-z]?)\)[.,;:]?$/i.test(trimmed)
}
