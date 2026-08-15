import { useEffect, useRef, useState } from 'react'
import { DEFAULT_TEMPERATURE } from '../../../config/settings'
import type { LLMProvider } from '../../../llm/types'
import type { VerifiedSentenceAnalysis } from '../domain/analyzeSentenceWithComplementVerification'
import { createRequestGuard } from '../../ocr/domain/requestGuard'
import { getReadingGuide } from '../domain/readingGuideService'
import { getPredicateStructure } from '../domain/predicateStructureService'
import { startReadingSupport } from '../domain/readingSupportOrchestrator'
import { mergeHybridPredicateStructure } from '../domain/hybridPredicateMerger'
import { buildCoreOnlyTree, buildHybridStructureTree } from '../domain/structureTree'
import { resolveSupplementSpan } from '../domain/supplementSpanResolution'
import { StructureTreeView } from './StructureTreeView'
import { prepareExpressionsForDisplay } from '../domain/expressionPresentation'
import type { ReadingGuide } from '../schemas/readingGuide.schema'
import type { PredicateStructure } from '../schemas/predicateStructure.schema'
import type { GroundedRelativeLinkRelation } from '../domain/relativeLinkGrounding'
import { isSentenceCoreFailure } from '../domain/sentenceCoreRecovery'
import type {
  ClauseKind,
  GrammaticalRole,
  ModifierKind,
  Span,
} from '../schemas/grammarAnalysis.schema'

interface AnalysisResultPanelProps {
  result: VerifiedSentenceAnalysis
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

const MAX_READING_ADVICE_SHOWN = 3
const MAX_STRUCTURE_POINTS_SHOWN = 2

type AsyncStatus = 'idle' | 'loading' | 'success' | 'error'

function spanText(span: Span | null, placeholder = '(検出されませんでした)'): string {
  return span ? span.text : placeholder
}

export function AnalysisResultPanel({ result, provider, model }: AnalysisResultPanelProps) {
  const { meta, analysis, rawCore, effectiveCore, verification, coreRepair } = result
  const [userNote, setUserNote] = useState('')

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

  // Prototype 2.3C: ReadingGuide (readingSteps/expressions/connections/readingAdvice) and
  // PredicateStructureAnalyzer (the structure tree, via the deterministic hybrid merger)
  // are two fully independent LLM calls, both triggered by the same single "英語の語順で
  // 読む" click (item 24) but tracked with entirely separate status/result/guard state so
  // one's failure or retry never touches the other (item 23).
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
  }, [result, model])

  const handleStart = async () => {
    if (!model || coreFailure) return
    const readingGuideRequestId = readingGuideGuardRef.current.next()
    const structureRequestId = structureGuardRef.current.next()
    const relativeLinkRequestId = relativeLinkGuardRef.current.next()
    setReadingGuideStatus('loading')
    setStructureStatus('loading')

    const {
      readingGuide: readingGuidePromise,
      structure: structurePromise,
      relativeLink: relativeLinkPromise,
    } = startReadingSupport({
      provider,
      model,
      originalText: analysis.normalizedText,
      sentenceCore: core,
      temperature: DEFAULT_TEMPERATURE,
    })

    void readingGuidePromise
      .then((outcome) => {
        if (!readingGuideGuardRef.current.isCurrent(readingGuideRequestId)) return
        if (outcome.success) {
          setReadingGuide(outcome.readingGuide)
          setReadingGuideStatus('success')
        } else {
          setReadingGuideStatus('error')
        }
      })
      .catch(() => {
        if (!readingGuideGuardRef.current.isCurrent(readingGuideRequestId)) return
        setReadingGuideStatus('error')
      })

    void structurePromise
      .then((outcome) => {
        if (!structureGuardRef.current.isCurrent(structureRequestId)) return
        if (outcome.success) {
          setStructure(outcome.structure)
          setStructureStatus('success')
        } else {
          setStructureStatus('error')
        }
      })
      .catch(() => {
        if (!structureGuardRef.current.isCurrent(structureRequestId)) return
        setStructureStatus('error')
      })

    if (relativeLinkPromise) {
      void relativeLinkPromise
        .then((outcome) => {
          if (!relativeLinkGuardRef.current.isCurrent(relativeLinkRequestId)) return
          if (outcome.success) setRelations(outcome.relations)
        })
        .catch(() => {
          // Item 48: a technical failure here just leaves `relations` empty — no status to
          // set, no warning to show, the rest of the structure tree renders unaffected.
        })
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
    setStructureStatus('loading')
    try {
      const outcome = await getPredicateStructure({
        provider,
        model,
        originalText: analysis.normalizedText,
        sentenceCore: core,
        temperature: DEFAULT_TEMPERATURE,
      })
      if (!structureGuardRef.current.isCurrent(requestId)) return
      if (outcome.success) {
        setStructure(outcome.structure)
        setStructureStatus('success')
      } else {
        setStructureStatus('error')
      }
    } catch {
      if (!structureGuardRef.current.isCurrent(requestId)) return
      setStructureStatus('error')
    }
  }

  const subjectHeadDiffers = core.subjectHead !== null && core.subject !== null && core.subjectHead.text !== core.subject.text

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
  let tree = buildCoreOnlyTree(core)
  if (structureStatus === 'success' && structure) {
    const hybrid = mergeHybridPredicateStructure(analysis.normalizedText, core, structure)
    const supplementSpan = resolveSupplementSpan(analysis.normalizedText, core, rawCore, verification, hybrid)
    tree = buildHybridStructureTree(core, hybrid, supplementSpan, relations)
  }

  const started = readingGuideStatus !== 'idle' || structureStatus !== 'idle'
  const structurePoints = readingGuide ? readingGuide.connections.slice(0, MAX_STRUCTURE_POINTS_SHOWN) : []
  const groupedExpressions = readingGuide ? prepareExpressionsForDisplay(readingGuide.expressions) : []
  const readingAdvice = readingGuide ? readingGuide.readingAdvice.slice(0, MAX_READING_ADVICE_SHOWN) : []

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
                {spanText(core.subject)}
                {subjectHeadDiffers && <span className="core-subject-head">（{core.subjectHead!.text}）</span>}
              </dd>
              <dt>V</dt>
              <dd>{spanText(core.verb)}</dd>
              {core.indirectObject && (
                <>
                  <dt>IO</dt>
                  <dd>{core.indirectObject.text}</dd>
                </>
              )}
              {core.object && (
                <>
                  <dt>O</dt>
                  <dd>{core.object.text}</dd>
                </>
              )}
              {core.complement && !coreUncertain && (
                <>
                  <dt>C</dt>
                  <dd>{core.complement.text}</dd>
                </>
              )}
              <dt>型</dt>
              <dd>{coreUncertain ? '未確定' : core.pattern}</dd>
            </dl>

            {!started && (
              <button type="button" className="reveal-details-button" onClick={() => void handleStart()} disabled={!model}>
                英語の語順で読む
              </button>
            )}
          </>
        )}
      </section>

      {!coreFailure && started && (
        <section>
          <h2>文の構造</h2>
          <StructureTreeView nodes={tree} sentence={analysis.normalizedText} multipleRelations={relations.length > 1} />
          {structureStatus === 'loading' && <p className="empty-note">構造を解析中…</p>}
          {structureStatus === 'error' && (
            <>
              <p className="analysis-warning" role="alert">
                詳細な文構造を作成できませんでした
              </p>
              <button type="button" onClick={() => void handleRetryStructure()}>
                構造を再試行
              </button>
            </>
          )}
        </section>
      )}

      {!coreFailure && started && (
        <section>
          <h2>英語の語順で読む</h2>
          {readingGuideStatus === 'loading' && <p className="empty-note">読み方を解析中…</p>}
          {readingGuideStatus === 'error' && (
            <>
              <p className="analysis-warning" role="alert">
                読み方ガイドを作成できませんでした
              </p>
              <button type="button" onClick={() => void handleRetryReadingGuide()}>
                再試行
              </button>
            </>
          )}
          {readingGuideStatus === 'success' && readingGuide && (
            <>
              {structurePoints.length > 0 && (
                <ul className="structure-points">
                  {structurePoints.map((c, i) => (
                    <li key={i}>{c.explanation}</li>
                  ))}
                </ul>
              )}
              <ol className="reading-steps">
                {readingGuide.readingSteps.map((step, i) => (
                  <li key={i}>
                    <p className="card-title">{step.text}</p>
                    {step.cue && <p className="reading-step-cue">{step.cue}</p>}
                    {step.explanation && <p>{step.explanation}</p>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      {readingGuideStatus === 'success' && groupedExpressions.length > 0 && (
        <section>
          <h2>文法・言い回し</h2>
          <ul className="card-list">
            {groupedExpressions.map((g, i) => (
              <li key={i}>
                <p className="card-title">{g.pattern}</p>
                <p>
                  {g.meaning} — {g.function}
                </p>
                <p className="empty-note">例: {g.examples.join(' / ')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {readingGuideStatus === 'success' && readingAdvice.length > 0 && (
        <section>
          <h2>読み方のポイント</h2>
          <ul>
            {readingAdvice.map((advice, i) => (
              <li key={i}>{advice}</li>
            ))}
          </ul>
        </section>
      )}

      <details className="meta-details">
        <summary>語彙（必要なら）</summary>
        {analysis.vocabulary.length === 0 ? (
          <p className="empty-note">重要語彙は検出されませんでした。</p>
        ) : (
          <ul className="card-list">
            {analysis.vocabulary.map((v, i) => (
              <li key={i}>
                <p className="card-title">{v.word}</p>
                <p>{v.contextualMeaning}</p>
              </li>
            ))}
          </ul>
        )}
      </details>

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
