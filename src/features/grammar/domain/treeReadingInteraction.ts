export interface TreeReadingInteractionState {
  hoveredKey: string | null
  pinnedKey: string | null
}

export type TreeReadingInteractionAction =
  | { type: 'preview'; key: string }
  | { type: 'leave'; key: string }
  | { type: 'togglePin'; key: string }
  | { type: 'clearPin' }

export const EMPTY_TREE_READING_INTERACTION: TreeReadingInteractionState = {
  hoveredKey: null,
  pinnedKey: null,
}

export function reduceTreeReadingInteraction(
  state: TreeReadingInteractionState,
  action: TreeReadingInteractionAction,
): TreeReadingInteractionState {
  switch (action.type) {
    case 'preview':
      return { ...state, hoveredKey: action.key }
    case 'leave':
      return state.hoveredKey === action.key ? { ...state, hoveredKey: null } : state
    case 'togglePin':
      return { hoveredKey: state.hoveredKey, pinnedKey: state.pinnedKey === action.key ? null : action.key }
    case 'clearPin':
      return { ...state, pinnedKey: null }
  }
}

/** Hover/focus is temporary; the stored pin becomes active again on leave/blur. */
export function activeTreeNodeKey(state: TreeReadingInteractionState): string | null {
  return state.hoveredKey ?? state.pinnedKey
}
