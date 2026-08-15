import type { ReactNode } from 'react'

interface CoordinationGroupViewProps {
  /** Literal connector word extracted from source text (e.g. "and"/"or"/"but"/"nor"/
   * "yet"), or null when no explicit conjunction word was found in the source (a
   * comma-only chain) — in that case no badge is rendered, but the box still visually
   * groups the members together. Never fabricated; always exactly what
   * coordinationGroupPresentation.ts / coordinationListParser.ts already computed. */
  connector: string | null
  children: ReactNode
}

/**
 * Prototype 2.3E — shared visual language (item 11) for EVERY coordination grouping in the
 * app (predicate coordination, dependent coordination, and the internal subject-modifier
 * list): one light background box with a small badge on its border naming the connector.
 *
 * The connector is GROUP metadata, rendered exactly once on the box itself — never a
 * sibling row and never an inline token stitched between members (item 4/27/28: "and"
 * labels the box; it is not a tree node). Callers pass the already-rendered member
 * subtrees as children; this component only owns the box/badge presentation, nothing about
 * what a "member" is — kept generic on purpose so the same component serves both a list of
 * full StructureTreeNode subtrees and a list of plain list-item strings.
 */
export function CoordinationGroupView({ connector, children }: CoordinationGroupViewProps) {
  return (
    <div className="coordination-group" aria-label={connector ? `${connector}で結ばれた並列` : undefined}>
      {connector && <span className="coordination-group-badge">{connector}</span>}
      {children}
    </div>
  )
}
