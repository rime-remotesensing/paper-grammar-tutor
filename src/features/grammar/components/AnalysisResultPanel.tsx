import { useEffect, useReducer, useRef, useState } from 'react'
import { DEFAULT_TEMPERATURE } from '../../../config/settings'
import type { LLMProvider } from '../../../llm/types'
import type { VerifiedSentenceAnalysisWithSyntaxAuthority } from '../domain/analyzeSentenceWithSyntaxAuthority'
import { createRequestGuard } from '../../ocr/domain/requestGuard'
import { getReadingGuide } from '../domain/readingGuideService'
import { getPredicateStructure } from '../domain/predicateStructureService'
import { startReadingSupport } from '../domain/readingSupportOrchestrator'
import { mergeHybridPredicateStructure } from '../domain/hybridPredicateMerger'
import { getBasicSkeletonDisplayText } from '../domain/basicSkeletonPresentation'
import { applyFocusedWhereClauseRepair } from '../domain/whereClauseRelocation'
import { buildCoreOnlyTree, buildHybridStructureTree } from '../domain/structureTree'
import { buildStanzaHierarchicalTree } from '../domain/stanzaStructureTree'
import { resolveSupplementSpan } from '../domain/supplementSpanResolution'
import { StructureTreeView } from './StructureTreeView'
import { TreeContextualReadingPanel } from './TreeContextualReadingPanel'
import type { ReadingGuide } from '../schemas/readingGuide.schema'
import type { PredicateStructure } from '../schemas/predicateStructure.schema'
import type { GroundedRelativeLinkRelation } from '../domain/relativeLinkGrounding'
import { isSentenceCoreFailure } from '../domain/sentenceCoreRecovery'
import type { StructureTreeNode } from '../domain/structureTree'
import { structureTreeNodeKey, structureTreeNodeSpan } from '../domain/treeReadingMatching'
import { activeTreeNodeKey, EMPTY_TREE_READING_INTERACTION, reduceTreeReadingInteraction } from '../domain/treeReadingInteraction'
import { findVocabularyForTreeNode, groundVocabularyForDisplay, vocabularyPartOfSpeechLabel } from '../domain/vocabularyPresentation'
import { prepareExpressionsForDisplay } from '../domain/expressionPresentation'
import { buildSourceHighlightSegments } from '../domain/sourceSentenceHighlight'
import { deriveTreeReadingTargets, findTreeReadingTargetForNode } from '../domain/treeReadingTargets'
import { isStructureTreeSuppliedByStanza, shouldShowPredicateStructureFailureWarning } from '../domain/structureFailurePresentation'
import type {
  ClauseKind,
  GrammaticalRole,
  ModifierKind,
  Span,
} from '../schemas/grammarAnalysis.schema'

interface AnalysisResultPanelProps {
  result: VerifiedSentenceAnalysisWithSyntaxAuthority
  provider: LLMProvider
  model: string | null
}

const MODIFIER_KIND_LABEL: Record<ModifierKind, string> = {
  prepositionalPhrase: '前置詞句',
  participlePhrase: '分詞句',
  infinitivePhrase: '不定詞句',
  relativeClause: '関係詞節',
  adverbialPhrase: '副詞句',
  appositive: '同格',
  other: 'その他',
}

const CLAUSE_KIND_LABEL: Record<ClauseKind, string> = {
  nounClause: '名詞節',
  adjectiveClause: '形容詞節',
  adverbClause: '副詞節',
  other: 'その他',
}

const GRAMMATICAL_ROLE_LABEL: Record<GrammaticalRole, string> = {
  subject: '主語',
  object: '目的語',
  complement: '補語',
  modifier: '修飾',
  adverbial: '副詞的修飾',
  apposition: '同格',
  other: 'その他',
}

type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

function spanText(span: Span | null, placeholder = '(検出されませんでした)'): string {
  return span ? span.text : placeholder
}

function findTreeNode(nodes: readonly StructureTreeNode[], key: string): StructureTreeNode | null {
  for (const node of nodes) {
    if (structureTreeNodeKey(node) === key) return node
    const child = findTreeNode(node.children, key)
    if (child) return child
  }
  return null
}

export function AnalysisResultPanel({ result, provider, model }: AnalysisResultPanelProps) {
  const { meta, analysis, rawCore, effectiveCore, effectiveCoreSet, verification, coreRepair } = result
  const { syntaxAuthority, stanzaTokens } = result
  const [userNote, setUserNote] = useState('')
  const [treeInteraction, dispatchTreeInteraction] = useReducer(
    reduceTreeReadingInteraction,
    EMPTY_TREE_READING_INTERACTION,
  )

  // By the time this component renders, App.tsx's analyzeSentenceWithComplementVerification()
  // has already run any needed forced-core recovery (Prototype 2.2) AND, when the suspicious
  // comma+V-ing gate fired, the focused complement verifier (Prototype 2.3I) — this panel no
  // longer owns a recovery button/flow. isSentenceCoreFailure is still checked defensively
  // (the underlying data shape hasn't changed), but should never be true in normal operation.
  //
  // Prototype 2.3I item 20: every downstream consumer in this component (basic-core display,
  // pattern display, PredicateStructure/ReadingGuide cache keys, hybrid merger, structure
  // tree) uses `core` = effectiveCore, never rawCore/analysis.sentenceCore directly — a
  // confirmed_supplementary_ing verification already nulled the bogus complement there, and
  // an 'uncertain' verification leaves it equal to rawCore (never guess) but the UI below
  // still avoids presenting it with full confidence (see coreUncertain).
  const core = effectiveCore
  const coreFailure = isSentenceCoreFailure(core)
  const coreUncertain = verification.status === 'uncertain'

  // Prototype 2.6B6: PredicateStructure resolves first; ReadingGuide then receives compact
  // targets from the final repaired Tree. Status and stale-request guards remain separate
  // so ReadingGuide failure never removes an already-valid Tree.
  const [readingGuideStatus, setReadingGuideStatus] = useState<AsyncStatus>('idle')
  const [readingGuide, setReadingGuide] = useState<ReadingGuide | null>(null)
  const readingGuideGuardRef = useRef(createRequestGuard())

  const [structureStatus, setStructureStatus] = useState<AsyncStatus>('idle')
  const [structure, setStructure] = useState<PredicateStructure | null>(null)
  const structureGuardRef = useRef(createRequestGuard())

  // Prototype 2.3O item 48: Focused Relative-Link is failure-independent from both of the
  // above — a technical failure (or the prefilter simply finding no candidate token, item
  // 16) just means `relations` stays empty; it never blocks/warns on top of the basic core
  // or the rest of the structure tree, and gets no dedicated status/retry UI (item 48: "警告
  // を大きく表示する必要なし").
  const [relations, setRelations] = useState<GroundedRelativeLinkRelation[]>([])
  const relativeLinkGuardRef = useRef(createRequestGuard())

  // Invalidate any in-flight/stale requests whenever the analysis result itself changes (a
  // genuinely new analysis, even if App.tsx's key-based remount didn't fire because the
  // sentence text happened to be identical) or the model changes mid-flight — Prototype
  // 2.1 item 20, reusing the same request-guard discipline as the OCR flow, now applied
  // independently to both services (item 27 — stale result discard for each).
  useEffect(() => {
    setReadingGuideStatus('idle')
    setReadingGuide(null)
    readingGuideGuardRef.current.next()
    setStructureStatus('idle')
    setStructure(null)
    structureGuardRef.current.next()
    setRelations([])
    relativeLinkGuardRef.current.next()
    dispatchTreeInteraction({ type: 'clearPin' })
  }, [result, model])

  // Prototype 2.6G2: when canonical authority is genuinely Stanza (never on the
  // legacy-qwen-fallback path -- item 20's explicit "do not pretend legacy Tree has
  // Stanza-level authority"), the Tree is built directly from the same ClauseFrame/
  // PredicateFrame/token authority the canonical SentenceCoreSet came from, deterministically
  // and with zero extra Stanza/Qwen calls (stanzaTokens was already fetched once during
  // analysis). PredicateStructure/legacy relative-link results are irrelevant on this path --
  // Stanza hierarchy is the sole Tree authority (item 3/21), so `resolvedStructure`/
  // `resolvedRelations` are intentionally unused here. Only when Stanza was unavailable for
  // this sentence does the tree fall back to the original PredicateStructure-driven builders,
  // completely unchanged.
  const buildFinalTree = (
    resolvedStructure: PredicateStructure | null,
    resolvedRelations: GroundedRelativeLinkRelation[],
  ): StructureTreeNode[] => {
    if (syntaxAuthority.source === 'stanza' && stanzaTokens) {
      return buildStanzaHierarchicalTree(analysis.normalizedText, stanzaTokens)
    }
    if (!resolvedStructure) return buildCoreOnlyTree(core)
    const hybrid = mergeHybridPredicateStructure(analysis.normalizedText, core, resolvedStructure, effectiveCoreSet)
    const supplementSpan = resolveSupplementSpan(analysis.normalizedText, core, rawCore, verification, hybrid)
    return buildHybridStructureTree(core, hybrid, supplementSpan, resolvedRelations)
  }

  const handleStart = async () => {
    if (!model || coreFailure) return
    const readingGuideRequestId = readingGuideGuardRef.current.next()
    const structureRequestId = structureGuardRef.current.next()
    const relativeLinkRequestId = relativeLinkGuardRef.current.next()
    setReadingGuideStatus('loading')
    setStructureStatus('loading')

    const { structure: structurePromise, relativeLink: relativeLinkPromise } = startReadingSupport({
      provider,
      model,
      originalText: analysis.normalizedText,
      sentenceCore: core,
      temperature: DEFAULT_TEMPERATURE,
    })

    let nextStructure: PredicateStructure | null = null
    try {
      const outcome = await structurePromise
      if (!structureGuardRef.current.isCurrent(structureRequestId)) return
      if (outcome.success) {
        const repaired = await applyFocusedWhereClauseRepair({
          provider,
          model,
          temperature: DEFAULT_TEMPERATURE,
          sentence: analysis.normalizedText,
          sentenceCore: core,
          structure: outcome.structure,
        })
        if (!structureGuardRef.current.isCurrent(structureRequestId)) return
        nextStructure = repaired.structure
        setStructure(nextStructure)
        setStructureStatus('success')
      } else {
        setStructureStatus('error')
      }
    } catch {
      if (!structureGuardRef.current.isCurrent(structureRequestId)) return
      setStructureStatus('error')
    }

    let nextRelations: GroundedRelativeLinkRelation[] = []
    if (relativeLinkPromise) {
      try {
        const outcome = await relativeLinkPromise
        if (!relativeLinkGuardRef.current.isCurrent(relativeLinkRequestId)) return
        if (outcome.success) nextRelations = outcome.relations
      } catch {
        // A focused-link failure safely leaves the final Tree without focused relations.
      }
    }
    if (!relativeLinkGuardRef.current.isCurrent(relativeLinkRequestId)) return
    setRelations(nextRelations)

    const targets = deriveTreeReadingTargets(
      buildFinalTree(nextStructure, nextRelations),
      analysis.normalizedText,
    )
    try {
      const outcome = await getReadingGuide({
        provider,
        model,
        originalText: analysis.normalizedText,
        sentenceCore: core,
        targets,
        temperature: DEFAULT_TEMPERATURE,
      })
      if (!readingGuideGuardRef.current.isCurrent(readingGuideRequestId)) return
      if (outcome.success) {
        setReadingGuide(outcome.readingGuide)
        setReadingGuideStatus('success')
      } else {
        setReadingGuideStatus('error')
      }
    } catch {
      if (!readingGuideGuardRef.current.isCurrent(readingGuideRequestId)) return
      setReadingGuideStatus('error')
    }
  }

  const handleRetryReadingGuide = async () => {
    if (!model || coreFailure) return
    const requestId = readingGuideGuardRef.current.next()
    setReadingGuideStatus('loading')
    try {
      const outcome = await getReadingGuide({
        provider,
        model,
        originalText: analysis.normalizedText,
        sentenceCore: core,
        targets: deriveTreeReadingTargets(
          buildFinalTree(structureStatus === 'success' ? structure : null, relations),
          analysis.normalizedText,
        ),
        temperature: DEFAULT_TEMPERATURE,
      })
      if (!readingGuideGuardRef.current.isCurrent(requestId)) return
      if (outcome.success) {
        setReadingGuide(outcome.readingGuide)
        setReadingGuideStatus('success')
      } else {
        setReadingGuideStatus('error')
      }
    } catch {
      if (!readingGuideGuardRef.current.isCurrent(requestId)) return
      setReadingGuideStatus('error')
    }
  }

  const handleRetryStructure = async () => {
    if (!model || coreFailure) return
    const requestId = structureGuardRef.current.next()
    const readingRequestId = readingGuideGuardRef.current.next()
    setStructureStatus('loading')
    setReadingGuideStatus('loading')
    let repairedStructure: PredicateStructure
    try {
      const outcome = await getPredicateStructure({
        provider,
        model,
        originalText: analysis.normalizedText,
        sentenceCore: core,
        temperature: DEFAULT_TEMPERATURE,
      })
      if (!structureGuardRef.current.isCurrent(requestId)) return
      if (!outcome.success) {
        setStructureStatus('error')
        setReadingGuideStatus('error')
        return
      }
      const repaired = await applyFocusedWhereClauseRepair({
        provider,
        model,
        temperature: DEFAULT_TEMPERATURE,
        sentence: analysis.normalizedText,
        sentenceCore: core,
        structure: outcome.structure,
      })
      if (!structureGuardRef.current.isCurrent(requestId)) return
      repairedStructure = repaired.structure
      setStructure(repairedStructure)
      setStructureStatus('success')
    } catch {
      if (!structureGuardRef.current.isCurrent(requestId)) return
      setStructureStatus('error')
      setReadingGuideStatus('error')
      return
    }

    const targets = deriveTreeReadingTargets(
      buildFinalTree(repairedStructure, relations),
      analysis.normalizedText,
    )
    try {
      const readingOutcome = await getReadingGuide({
        provider,
        model,
        originalText: analysis.normalizedText,
        sentenceCore: core,
        targets,
        temperature: DEFAULT_TEMPERATURE,
      })
      if (!readingGuideGuardRef.current.isCurrent(readingRequestId)) return
      if (readingOutcome.success) {
        setReadingGuide(readingOutcome.readingGuide)
        setReadingGuideStatus('success')
      } else {
        setReadingGuideStatus('error')
      }
    } catch {
      if (!readingGuideGuardRef.current.isCurrent(readingRequestId)) return
      setReadingGuideStatus('error')
    }
  }

  // Prototype 2.6B6: Tree authority is resolved first, then the existing ReadingGuide call
  // writes notes for those targets. Hover, focus, and click perform exact local lookup only.
  useEffect(() => {
    if (model && !coreFailure) void handleStart()
    // result/model are the analysis identity; provider is stable for one mounted App.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, model])

  const subjectHeadDiffers = core.subjectHead !== null && core.subject !== null && core.subjectHead.text !== core.subject.text

  // Prototype 2.6G2-F1: `effectiveCoreSet` always corresponds to `core` (`effectiveCore`), so
  // `getBasicSkeletonDisplayText` selecting from its `predicateCores[0]` is the same "primary"
  // predicate `core`'s V/IO/O/C were projected from (see `projectPrimaryCore`). See
  // basicSkeletonPresentation.ts for the citation-free-presentation-text-over-grounded-.text
  // fallback policy itself.
  const basicSkeletonText = getBasicSkeletonDisplayText(effectiveCoreSet, core)

  // Prototype 2.3C item 22: the skeleton tree never disappears just because structure is
  // still loading/failed — buildCoreOnlyTree (sentenceCore alone, mechanical S/V/O/C, no
  // coordination awareness) is the fallback; the full hybrid tree replaces it the moment
  // the structure call succeeds.
  //
  // Prototype 2.3M item 22 (authority precedence): use the Focused Complement Verifier's
  // confirmed_supplementary_ing authority when available; Prototype 2.3O items 30-34 extend
  // this to the raw-SVO case (rawCore never even had a complement candidate, so the
  // Verifier was correctly never called at all) via the same conservative comma+-ing
  // surface signal, applied to the hybrid predicate directly — see supplementSpanResolution.ts.
  const tree = buildFinalTree(structureStatus === 'success' ? structure : null, relations)

  // Prototype 2.6G2-D2: on the Stanza authority path, `tree` above is built directly from
  // Stanza (buildFinalTree's own early-return, unconditional on `structure`/`structureStatus`)
  // and every other visible consumer of the legacy PredicateStructure call (ReadingGuide
  // targets, relative-link relations) is likewise derived from THIS already-Stanza-built
  // `tree`, never from `structure` itself -- a PredicateStructure failure here has no visible
  // effect on anything the user is looking at, so it must not be shown as a Tree-level error.
  const structureTreeSuppliedByStanza = isStructureTreeSuppliedByStanza(syntaxAuthority.source, Boolean(stanzaTokens))
  const showPredicateStructureFailureWarning = shouldShowPredicateStructureFailureWarning(structureStatus, structureTreeSuppliedByStanza)

  const started = readingGuideStatus !== 'idle' || structureStatus !== 'idle'
  const activeKey = activeTreeNodeKey(treeInteraction)
  const activeNode = activeKey ? findTreeNode(tree, activeKey) : null
  const activeSpan = activeNode ? structureTreeNodeSpan(activeNode) : null
  const readingTargets = deriveTreeReadingTargets(tree, analysis.normalizedText)
  const activeReadingTarget = findTreeReadingTargetForNode(activeNode, readingTargets)
  const readingSteps = readingGuide?.readingSteps ?? []
  const displayedExpressions = prepareExpressionsForDisplay(readingGuide?.expressions ?? [])
  const groundedVocabulary = groundVocabularyForDisplay(analysis.vocabulary, analysis.normalizedText)
  const displayedVocabulary = activeSpan
    ? findVocabularyForTreeNode(activeSpan, groundedVocabulary)
    : groundedVocabulary
  const sourceHighlight = buildSourceHighlightSegments(analysis.normalizedText, activeSpan)

  return (
    <div className="analysis-result">
      {!meta.schemaValid && (
        <div className="analysis-warning" role="alert">
          解析結果を正しく取得できませんでした。以下は表示できる範囲の情報です。
        </div>
      )}

      <section>
        <h2>基本の骨格</h2>
        {coreFailure ? (
          <p className="analysis-warning" role="alert">
            文の骨格を確定できませんでした。文全体を選び直して、もう一度お試しください。
          </p>
        ) : (
          <>
            {coreUncertain && (
              <p className="analysis-warning" role="alert">
                文の骨格の一部を確定できませんでした。
              </p>
            )}
            <dl className="core-compact">
              <dt>S</dt>
              <dd>
                {basicSkeletonText.subject ?? spanText(core.subject)}
                {subjectHeadDiffers && <span className="core-subject-head">（{core.subjectHead!.text}）</span>}
              </dd>
              <dt>V</dt>
              <dd>{spanText(core.verb)}</dd>
              {core.indirectObject && (
                <>
                  <dt>IO</dt>
                  <dd>{basicSkeletonText.indirectObject}</dd>
                </>
              )}
              {core.object && (
                <>
                  <dt>O</dt>
                  <dd>{basicSkeletonText.object}</dd>
                </>
              )}
              {core.complement && !coreUncertain && (
                <>
                  <dt>C</dt>
                  <dd>{basicSkeletonText.complement}</dd>
                </>
              )}
              <dt>型</dt>
              <dd>{coreUncertain ? '未確定' : core.pattern}</dd>
            </dl>

          </>
        )}
      </section>

      {!coreFailure && started && (
        <section>
          <div className="source-reference">
            <h2>英文</h2>
            <p className="source-reference-text">
              {sourceHighlight.active === null ? (
                sourceHighlight.before
              ) : (
                <>
                  {sourceHighlight.before}
                  <mark className="source-active-span">{sourceHighlight.active}</mark>
                  {sourceHighlight.after}
                </>
              )}
            </p>
            <p className="source-reference-note">文構造と同じ解析用表記です。</p>
          </div>
          <h2>文の構造</h2>
          <StructureTreeView
            nodes={tree}
            sentence={analysis.normalizedText}
            multipleRelations={relations.length > 1}
            structuredSyntax={syntaxAuthority.source === 'stanza'}
            activeNodeKey={activeKey}
            pinnedNodeKey={treeInteraction.pinnedKey}
            onPreview={(node) => dispatchTreeInteraction({ type: 'preview', key: structureTreeNodeKey(node) })}
            onLeave={(node) => dispatchTreeInteraction({ type: 'leave', key: structureTreeNodeKey(node) })}
            onTogglePin={(node) => dispatchTreeInteraction({ type: 'togglePin', key: structureTreeNodeKey(node) })}
            onClearPin={() => dispatchTreeInteraction({ type: 'clearPin' })}
          />
          {structureStatus === 'loading' && <p className="empty-note">構造を解析中…</p>}
          {showPredicateStructureFailureWarning && (
            <>
              <p className="analysis-warning" role="alert">
                詳細な文構造を作成できませんでした
              </p>
              <button type="button" onClick={() => void handleRetryStructure()}>
                構造を再試行
              </button>
            </>
          )}
          <TreeContextualReadingPanel
            hasActiveNode={activeNode !== null}
            activeTarget={activeReadingTarget}
            readingGuideStatus={readingGuideStatus}
            readingSteps={readingSteps}
            onRetry={() => void handleRetryReadingGuide()}
          />

          <div className="contextual-vocabulary">
            <h3>{activeSpan ? 'この部分の語彙' : '語彙'}</h3>
            {displayedVocabulary.length === 0 ? (
              <p className="empty-note">
                {activeSpan ? 'この部分には特に確認する語彙はありません。' : '重要語彙は検出されませんでした。'}
              </p>
            ) : (
              <ul className="card-list vocabulary-cards">
                {displayedVocabulary.map((v) => (
                  <li key={`${v.start}:${v.end}`}>
                    <p className="vocabulary-card-heading">
                      <span className="card-title">{v.word}</span>
                      <span className="vocabulary-pos">{vocabularyPartOfSpeechLabel(v.partOfSpeech)}</span>
                    </p>
                    <p>{v.contextualMeaning}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section className="expression-section">
        <h2>表現・語法</h2>
        {(readingGuideStatus === 'idle' || readingGuideStatus === 'loading') && (
          <p className="empty-note">表現を解析中…</p>
        )}
        {readingGuideStatus === 'error' && (
          <>
            <p className="analysis-warning" role="alert">表現・語法を作成できませんでした。</p>
            <button type="button" onClick={() => void handleRetryReadingGuide()}>再試行</button>
          </>
        )}
        {readingGuideStatus === 'success' && displayedExpressions.length === 0 && (
          <p className="empty-note">この文には特に取り上げる表現・語法はありません。</p>
        )}
        {displayedExpressions.length > 0 && (
          <ul className="card-list expression-cards">
            {displayedExpressions.map((expression) => (
              <li key={expression.pattern}>
                <p className="card-title">{expression.pattern}</p>
                <p>{expression.meaning}</p>
                <p className="empty-note">{expression.function}</p>
                <p className="expression-examples">{expression.examples.join(' / ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>あなた自身の解釈（メモ）</h2>
        <textarea
          rows={3}
          value={userNote}
          onChange={(e) => setUserNote(e.target.value)}
          placeholder="参考訳を見る前に、自分なりの理解をここに書いてみましょう。"
        />
      </section>

      <section>
        <details>
          <summary>参考訳（必要な場合のみ開く）</summary>
          <p>{analysis.referenceTranslation ?? '生成されていません。'}</p>
        </details>
      </section>

      <details className="meta-details">
        <summary>従来の解析情報（デバッグ用）</summary>
        <section>
          <h2>意味のまとまり</h2>
          {analysis.chunks.length === 0 ? (
            <p className="empty-note">まとまりは検出されませんでした。</p>
          ) : (
            <p className="chunk-line">
              {[...analysis.chunks]
                .sort((a, b) => a.order - b.order)
                .map((c) => c.span.text)
                .join(' / ')}
            </p>
          )}
        </section>

        <section>
          <h2>修飾関係</h2>
          {analysis.modifiers.length === 0 ? (
            <p className="empty-note">特筆すべき修飾関係はありません。</p>
          ) : (
            <ul className="card-list">
              {analysis.modifiers.map((m, i) => (
                <li key={i}>
                  <p className="card-title">{m.phrase.text}</p>
                  <p>
                    種類: {MODIFIER_KIND_LABEL[m.kind]} / 修飾先: {spanText(m.target, '不明')}
                  </p>
                  <p>{m.explanation}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>節</h2>
          {analysis.clauses.length === 0 ? (
            <p className="empty-note">従属節は検出されませんでした。</p>
          ) : (
            <ul className="card-list">
              {analysis.clauses.map((c, i) => (
                <li key={i}>
                  <p className="card-title">{c.span.text}</p>
                  <p>
                    種類: {CLAUSE_KIND_LABEL[c.kind]} / 役割: {GRAMMATICAL_ROLE_LABEL[c.grammaticalRole]}
                  </p>
                  <p>{c.roleExplanation}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {analysis.phrases.length > 0 && (
          <section>
            <h2>熟語・定型表現</h2>
            <ul className="card-list">
              {analysis.phrases.map((p, i) => (
                <li key={i}>
                  <p className="card-title">{p.span.text}</p>
                  <p>{p.meaning}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {analysis.readingHint.length > 0 && (
          <section>
            <h2>読み方のヒント</h2>
            <ul>
              {analysis.readingHint.map((hint, i) => (
                <li key={i}>{hint}</li>
              ))}
            </ul>
          </section>
        )}
      </details>

      <details className="meta-details">
        <summary>解析メタ情報（デバッグ用）</summary>
        <dl>
          <dt>confidence</dt>
          <dd>{analysis.confidence.toFixed(2)}</dd>
          <dt>schemaValid</dt>
          <dd>{String(meta.schemaValid)}</dd>
          <dt>regenerated</dt>
          <dd>{String(meta.regenerated)}</dd>
          <dt>elapsedMs</dt>
          <dd>{Math.round(meta.elapsedMs)}</dd>
          {meta.parseError && (
            <>
              <dt>parseError</dt>
              <dd>{meta.parseError}</dd>
            </>
          )}
          <dt>coreRepair</dt>
          <dd>
            {coreRepair.failureReason} → {coreRepair.strategy} ({coreRepair.status})
          </dd>
          <dt>complementVerification</dt>
          <dd>
            {verification.status}
            {verification.classification && ` (${verification.classification} / ${verification.reasonCode})`}
          </dd>
          {verification.status === 'confirmed_supplementary_ing' && (
            <>
              <dt>rawC（検証前・置換前）</dt>
              <dd>{rawCore.complement?.text ?? 'null'}</dd>
            </>
          )}
        </dl>
        {analysis.needsMoreContext && (
          <p className="empty-note">前後の文脈があるとより正確に解析できる可能性があります。</p>
        )}
        {analysis.uncertainties.length > 0 && (
          <ul>
            {analysis.uncertainties.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}
