import { useState } from 'react'
import { DEFAULT_TEMPERATURE } from '../../../config/settings'
import type { LLMProvider } from '../../../llm/types'
import type { AnalyzeSentenceResult } from '../domain/GrammarAnalyzer'
import {
  isSentenceCoreFailure,
  mergeRecoveredSentenceCore,
  recoverSentenceCore,
} from '../domain/sentenceCoreRecovery'
import type {
  ClauseKind,
  GrammaticalRole,
  ModifierKind,
  SentenceCore,
  Span,
} from '../schemas/grammarAnalysis.schema'

interface AnalysisResultPanelProps {
  result: AnalyzeSentenceResult
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

function spanText(span: Span | null, placeholder = '(検出されませんでした)'): string {
  return span ? span.text : placeholder
}

export function AnalysisResultPanel({ result, provider, model }: AnalysisResultPanelProps) {
  const { meta } = result
  const [userNote, setUserNote] = useState('')
  // Progressive-disclosure spike (Prototype 2.0): everything below sentenceCore stays
  // hidden until the user asks for it, so seeing S/V/O/C doesn't come bundled with the
  // rest of the analysis. Resets automatically for a new sentence because App.tsx keys
  // this component by the analyzed text, remounting it (and this state) from scratch.
  const [showDetails, setShowDetails] = useState(false)

  // sentenceCore recovery: user-triggered only, never automatic (see
  // domain/sentenceCoreRecovery.ts for why). Resets for a new sentence along with
  // showDetails, via the same key-based remount from App.tsx.
  const [recoveredCore, setRecoveredCore] = useState<SentenceCore | null>(null)
  const [recoveryStatus, setRecoveryStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  const analysis = recoveredCore ? mergeRecoveredSentenceCore(result.analysis, recoveredCore) : result.analysis
  const coreFailure = isSentenceCoreFailure(analysis.sentenceCore)

  const handleRecoverCore = async () => {
    if (!model) return
    setRecoveryStatus('loading')
    try {
      const outcome = await recoverSentenceCore({
        provider,
        model,
        sentence: result.analysis.normalizedText,
        temperature: DEFAULT_TEMPERATURE,
      })
      if (outcome.success) {
        setRecoveredCore(outcome.sentenceCore)
        setRecoveryStatus('idle')
      } else {
        setRecoveryStatus('error')
      }
    } catch {
      // Network/provider errors (timeout, connection refused, ...) land here too — the
      // original GrammarAnalysis (held in `result`, untouched) stays displayed either way.
      setRecoveryStatus('error')
    }
  }

  return (
    <div className="analysis-result">
      {!meta.schemaValid && (
        <div className="analysis-warning" role="alert">
          解析結果を正しく取得できませんでした。以下は表示できる範囲の情報です。
        </div>
      )}

      <section>
        <h2>文の骨格</h2>
        {coreFailure ? (
          <>
            <p className="analysis-warning" role="alert">
              骨格を検出できませんでした。文の一部を選択している場合は、文全体を選び直してください。
              完全な1文を選択している場合は、骨格だけ再解析できます。
            </p>
            <button
              type="button"
              onClick={() => void handleRecoverCore()}
              disabled={recoveryStatus === 'loading' || !model}
            >
              {recoveryStatus === 'loading' ? '骨格を再解析しています…' : '骨格だけ再解析'}
            </button>
            {recoveryStatus === 'error' && (
              <p className="analysis-warning" role="alert">
                骨格の再解析に失敗しました。文全体を選び直して再度お試しください。
              </p>
            )}
          </>
        ) : (
          <dl>
            <dt>主語</dt>
            <dd>{spanText(analysis.sentenceCore.subject)}</dd>
            <dt>主語の中心語</dt>
            <dd>{spanText(analysis.sentenceCore.subjectHead)}</dd>
            <dt>主動詞</dt>
            <dd>{spanText(analysis.sentenceCore.verb)}</dd>
            {analysis.sentenceCore.indirectObject && (
              <>
                <dt>間接目的語</dt>
                <dd>{spanText(analysis.sentenceCore.indirectObject)}</dd>
              </>
            )}
            <dt>目的語</dt>
            <dd>{spanText(analysis.sentenceCore.object, 'なし')}</dd>
            <dt>補語</dt>
            <dd>{spanText(analysis.sentenceCore.complement, 'なし')}</dd>
            <dt>文型</dt>
            <dd>{analysis.sentenceCore.pattern}</dd>
          </dl>
        )}
      </section>

      <section>
        <details>
          <summary>解析の確からしさ（メタ情報）</summary>
          <p>confidence: {analysis.confidence.toFixed(2)}</p>
          {recoveredCore && (
            <p className="empty-note">
              骨格は再解析により復元されました。上記confidenceは骨格の再解析前の値です。
            </p>
          )}
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
      </section>

      {!showDetails && (
        <button type="button" className="reveal-details-button" onClick={() => setShowDetails(true)}>
          もっと詳しく見る
        </button>
      )}

      {showDetails && (
        <>
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
                      種類: {CLAUSE_KIND_LABEL[c.kind]} / 役割:{' '}
                      {GRAMMATICAL_ROLE_LABEL[c.grammaticalRole]}
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

          {analysis.vocabulary.length > 0 && (
            <section>
              <h2>重要単語</h2>
              <ul className="card-list">
                {analysis.vocabulary.map((v, i) => (
                  <li key={i}>
                    <p className="card-title">{v.word}</p>
                    <p>{v.contextualMeaning}</p>
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

          <section>
            <h2>あなた自身の解釈（メモ）</h2>
            <textarea
              rows={3}
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder="参考訳を見る前に、自分なりの理解をここに書いてみましょう。"
            />
          </section>
        </>
      )}

      <section>
        <details>
          <summary>参考訳（必要な場合のみ開く）</summary>
          <p>{analysis.referenceTranslation ?? '生成されていません。'}</p>
        </details>
      </section>

      <details className="meta-details">
        <summary>解析メタ情報（デバッグ用）</summary>
        <dl>
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
        </dl>
      </details>
    </div>
  )
}
