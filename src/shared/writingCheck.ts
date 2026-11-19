/**
 * Mechanical checks for the signs of AI-generated text catalogued in Wikipedia's "Signs of AI writing"
 * (https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing). The agent's `human-writing` skill covers the
 * parts a regex can't see (rule of three, puffery, vague claims); this catches the mechanical ones so drafts can be
 * fixed before anything is sent. Pure functions, shared by the agent's check_writing tool and the generators.
 */

export interface WritingIssue {
  rule: string
  match: string
  advice: string
}

interface Rule {
  rule: string
  re: RegExp
  advice: string
}

const w = (words: string[]) => new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi')

/** Words whose frequency jumped after 2022 (Wikipedia list, all model eras), plus job-search clichés. */
export const AI_VOCABULARY = [
  'delve[sd]?',
  'delving',
  'tapestry',
  'testament',
  'pivotal',
  'underscor(?:e|es|ed|ing)',
  'showcas(?:e|es|ed|ing)',
  'foster(?:s|ed|ing)?',
  'bolster(?:s|ed|ing)?',
  'garner(?:s|ed|ing)?',
  'meticulous(?:ly)?',
  'intricate',
  'intricac(?:y|ies)',
  'interplay',
  'vibrant',
  'crucial',
  'enhanc(?:e|es|ed|ing)',
  'highlighting',
  'emphasizing',
  'enduring',
  'boasts?',
  'robust',
  'seamless(?:ly)?',
  'leverag(?:e|es|ed|ing)',
  'multifaceted',
  'quietly',
  'dependable',
  'universally',
  'landscape',
  'deep dive',
  'align(?:s|ed)? with',
  'resonat(?:e|es|ed|ing) with',
  'groundbreaking',
  'cutting-edge',
  'state-of-the-art',
  'world-class',
  'renowned',
  'nestled',
  'synerg(?:y|ies)'
]

const RULES: Rule[] = [
  { rule: 'ai-vocabulary', re: w(AI_VOCABULARY), advice: 'Overused AI word. Rewrite the sentence with a concrete fact instead of swapping in a synonym.' },
  { rule: 'additionally', re: /(?:^|[.!?]\s+)Additionally\b/g, advice: 'Starting a sentence with "Additionally" is a classic AI tell. Use "Also" or just start the next point.' },
  { rule: 'em-dash', re: /—|\s–\s|\s-{2,}\s/g, advice: 'Em dash / spaced dash. Use a period, comma, colon or parentheses.' },
  { rule: 'curly-quotes', re: /[“”‘’]/g, advice: 'Curly quotes. Use straight quotes and apostrophes.' },
  { rule: 'markdown', re: /\*\*[^*]+\*\*|^#{1,6}\s|^-{3,}$|\[[^\]]+\]\([^)]+\)|```/gm, advice: 'Markdown in plain text. Remove bold, headings, dividers and [text](url) links.' },
  { rule: 'emoji', re: /\p{Extended_Pictographic}/gu, advice: 'Emoji. Remove them.' },
  {
    rule: 'placeholder',
    re: /\[(?:your|company|hiring|name|insert|recipient|position|role|job|date|nome|empresa|cargo)[^\]]*\]|\b20\d\d-(?:XX|xx)-(?:XX|xx)\b|INSERT_[A-Z_]+|example\.com|\(if available\)/gi,
    advice: 'Placeholder left in. Fill in the real value or remove it.'
  },
  { rule: 'tracking-param', re: /utm_source=(?:chatgpt\.com|openai|copilot\.com)|referrer=grok\.com/gi, advice: 'Chatbot tracking parameter in a link. Remove it.' },
  {
    rule: 'copula-dodge',
    re: /\b(?:serves|stands|functions|operates) as\b|\bholds the distinction\b|\bis a testament\b|\bis a reminder\b/gi,
    advice: 'Use plain "is"/"has" instead of "serves as"/"stands as"/"testament".'
  },
  {
    rule: 'negative-parallelism',
    re: /\bnot only\b[^.]{0,80}\bbut(?: also)?\b|\b(?:it'?s|this is|that'?s) not (?:just |merely |only )?[^.,]{1,40}[,;]\s*(?:it'?s|but)\b|\bnão (?:só|apenas)\b[^.]{0,80}\bmas(?: também)?\b/gi,
    advice: 'Negative parallelism ("not only X but Y", "it\'s not X, it\'s Y"). State the positive claim directly.'
  },
  {
    rule: 'significance-puffery',
    re: /\b(?:pivotal|crucial|vital|significant|key) (?:role|moment)\b|\bevolving landscape\b|\bsetting the stage for\b|\bmark(?:s|ed|ing) a (?:shift|turning point)\b|\bindelible mark\b|\bdeeply rooted\b|\bfocal point\b|\breflects broader\b|\bshaped (?:the )?(?:conversations?|discussions?|debates?)\b|\bthis matters because\b/gi,
    advice: 'Inflated significance. Say what happened, with a number or a name.'
  },
  {
    rule: 'ing-tail',
    re: /,\s(?:highlighting|underscoring|emphasizing|ensuring|reflecting|symbolizing|contributing to|fostering|cultivating|enhancing|showcasing|demonstrating)\b[^.]*\./gi,
    advice: 'Superficial "-ing" tail commenting on the sentence. Cut it or make it its own concrete sentence.'
  },
  {
    rule: 'vague-association',
    re: /\b(?:in connection with|in association with|(?:closely |widely )?associated with)\b/gi,
    advice: 'Vague association. State the real relationship (I led / I built / I worked on).'
  },
  {
    rule: 'chatbot-phrase',
    re: /\bI hope (?:this|that) (?:helps|message finds you|email finds you|finds you well)\b|\bCertainly!|\bOf course!|\bGreat question\b|\byou'?re absolutely right\b|\blet me know if (?:there'?s|you need) anything else\b|\bfeel free to\b|\bas an AI\b|\bas of my last (?:knowledge |training )?update\b|\bbased on (?:the )?available information\b|\bwhile specific details are (?:limited|scarce)\b|\bit'?s (?:important|worth) (?:to note|noting)\b|\bhere(?:'s| is) (?:a|the) (?:draft|message|cover letter)\b/gi,
    advice: 'Chatbot/assistant phrasing. Remove it: the text is the message itself.'
  },
  {
    rule: 'summary-closer',
    re: /(?:^|[.!?]\s+)(?:In (?:summary|conclusion)|Overall|To sum up|Em resumo|Em suma|Concluindo),/gim,
    advice: 'Restating summary. End when the content ends.'
  },
  {
    rule: 'job-cliche',
    re: /\bI am (?:writing to (?:express|apply)|excited to apply|thrilled)\b|\b(?:I'?m|I am) passionate about\b|\bhit the ground running\b|\bproven track record\b|\bresults-driven\b|\bteam player\b|\bthrive in (?:a )?fast-paced\b|\bI came across your profile\b|\bpick your brain\b|\bexplore (?:potential )?synergies\b|\bvenho por meio dest[ae]\b|\bgostaria de manifestar\b|\bsou apaixonad[oa] por\b|\bagregar valor\b|\bvestir a camisa\b/gi,
    advice: 'Job-application cliché. Replace it with the specific reason or fact.'
  },
  {
    rule: 'weasel-attribution',
    re: /\b(?:industry reports|observers have (?:cited|noted)|experts (?:argue|say|agree)|some critics argue|studies show)\b/gi,
    advice: 'Vague attribution. Name the source or drop the claim.'
  }
]

/** Returns every mechanical AI-writing sign found in the text (deduplicated per rule + match). */
export function checkWriting(text: string): WritingIssue[] {
  const out: WritingIssue[] = []
  const seen = new Set<string>()
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      const match = m[0].trim().slice(0, 80)
      const key = `${r.rule}:${match.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ rule: r.rule, match, advice: r.advice })
    }
  }
  // Rule of three: more than two "a, b, and c" lists in one text reads as padding
  const triads = text.match(/\b[\w-]+(?: [\w-]+){0,2}, [\w-]+(?: [\w-]+){0,2},? (?:and|or|e|ou) [\w-]+/gi) ?? []
  if (triads.length > 2) out.push({ rule: 'rule-of-three', match: triads.slice(0, 3).join(' | '), advice: 'Too many lists of three. Keep at most one; use one or two items with a fact.' })
  return out
}

/** Compact version of the human-writing skill, appended to generation prompts inside the app. */
export const WRITING_RULES = `WRITING STYLE (the text must not read as AI-generated):
- Be specific: name systems, numbers, stacks, team sizes. Specific beats impressive.
- Use plain "is"/"has". Never "serves as", "stands as", "is a testament", "boasts", "features".
- Do not use these words: delve, tapestry, testament, pivotal, underscore, showcase, foster, bolster, garner, meticulous, intricate, interplay, vibrant, crucial, enhance, highlighting, emphasizing, enduring, robust, seamless, leverage, multifaceted, landscape, align with, resonate with, cutting-edge, world-class, synergy; do not start a sentence with "Additionally".
- No inflated significance ("pivotal moment", "key role", "evolving landscape", "setting the stage"), no "-ing" tails that comment on a sentence (", highlighting...", ", ensuring..."), no vague "associated with".
- No "not only X but also Y", no "it's not X, it's Y", at most one list of three.
- No em dashes (—) or spaced dashes; straight quotes; no emoji, no Markdown, no placeholders in brackets.
- No clichés: "I am writing to apply", "I am excited/passionate", "proven track record", "results-driven", "team player", "fast-paced"; in Portuguese: "venho por meio desta", "gostaria de manifestar", "sou apaixonado", "agregar valor".
- No summary at the end ("In summary", "Overall"). Vary sentence length.`
