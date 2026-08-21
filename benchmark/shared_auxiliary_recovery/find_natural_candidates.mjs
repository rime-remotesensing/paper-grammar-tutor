import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../generalization/blindHoldoutV2.ts'

async function analyze(text) {
  const res = await fetch('http://localhost:8010/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
  return (await res.json()).tokens
}

function normalizeDep(d) { return d.split(':')[0] }

async function findCandidates(cases) {
  const found = []
  for (const c of cases) {
    const tokens = await analyze(c.text)
    const byHead = new Map()
    for (const t of tokens) {
      if (!byHead.has(t.head)) byHead.set(t.head, [])
      byHead.get(t.head).push(t)
    }
    // find any VERB token with a conj VERB child sharing no own subject
    for (const main of tokens) {
      if (main.upos !== 'VERB' && main.upos !== 'AUX') continue
      const children = byHead.get(main.id) ?? []
      const mainAux = children.filter((ch) => normalizeDep(ch.deprel) === 'aux' || normalizeDep(ch.deprel) === 'aux:pass')
      if (mainAux.length === 0) continue
      const conjVerbs = children.filter((ch) => normalizeDep(ch.deprel) === 'conj' && (ch.upos === 'VERB' || ch.upos === 'AUX'))
      for (const later of conjVerbs) {
        const laterChildren = byHead.get(later.id) ?? []
        const laterOwnAux = laterChildren.some((ch) => normalizeDep(ch.deprel) === 'aux' || normalizeDep(ch.deprel) === 'aux:pass')
        const laterOwnSubj = laterChildren.some((ch) => normalizeDep(ch.deprel) === 'nsubj' || normalizeDep(ch.deprel) === 'csubj')
        if (laterOwnAux || laterOwnSubj) continue
        found.push({
          id: c.id,
          text: c.text,
          mainVerb: main.text,
          mainAux: mainAux.map((a) => a.text).join(' '),
          mainFeats: main.feats,
          laterVerb: later.text,
          laterFeats: later.feats,
        })
      }
    }
  }
  return found
}

const all = [...DEVELOPMENT_CASES, ...LOCKED_HOLDOUT_CASES, ...BLIND_HOLDOUT_V2]
console.log('Total corpus sentences scanned:', all.length)
const candidates = await findCandidates(all)
console.log('Structural candidates found:', candidates.length)
for (const c of candidates) {
  console.log(JSON.stringify(c, null, 2))
}
