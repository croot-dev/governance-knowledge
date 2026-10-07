import { normalize } from "./model";

export interface ExpressionMapping {
  text: string;
  termId: string;
  termName: string;
}
export interface MaskingSpec {
  ruleId: string;
  ruleName: string;
  pattern: string;
  replacement: string;
  resultPattern: string;
}
export interface DetectionSpec {
  ruleId: string;
  ruleName: string;
  pattern: string;
}
export interface TransformInput {
  expressions: ExpressionMapping[];
  masking: MaskingSpec[];
  prohibited: DetectionSpec[];
}
export interface TermReplacement {
  from: string;
  to: string;
  termId: string;
  count: number;
}
export interface RuleCount {
  ruleId: string;
  ruleName: string;
  count: number;
}
export interface RuleError {
  ruleId: string;
  ruleName: string;
  message: string;
}
export interface TransformOutput {
  markdown: string;
  replacements: TermReplacement[];
  maskings: RuleCount[];
  violations: RuleCount[];
  ambiguous: { text: string; termNames: string[] }[];
  errors: RuleError[];
}

// Particles whose form depends on whether the preceding syllable has a final consonant.
const PARTICLE_PAIRS: Record<string, [string, string]> = {
  은: ["은", "는"],
  는: ["은", "는"],
  이: ["이", "가"],
  가: ["이", "가"],
  을: ["을", "를"],
  를: ["을", "를"],
  과: ["과", "와"],
  와: ["과", "와"],
  으로: ["으로", "로"],
  로: ["으로", "로"],
};
const PAIRED_PARTICLE = /^(으로|은|는|이|가|을|를|과|와|로)(?![\p{L}\p{N}])/u;
// A Hangul-ending expression may be followed by a particle; any other letter means a longer word.
const PARTICLE_START =
  /^(?:으로|에서|에게|께서|까지|부터|보다|처럼|마다|이나|이란|이라|이며|이고|이다|입니다|이에요|예요|[은는이가을를과와로의에도만나란라며고다야]|[^\p{L}\p{N}_]|$)/u;
const HANGUL = /[가-힣]$/;
const ASCII_WORD = /^[A-Za-z0-9_]/;
const UNPROTECTED_INLINE =
  /(`+)[^`\n]*?\1|\]\([^)\n]*\)|<[a-z]+:[^>\s]*>|https?:\/\/[^\s)>\]]+/gi;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function finalConsonant(word: string): number | null {
  const last = word.at(-1);
  if (!last || !HANGUL.test(last)) return null;
  return (last.charCodeAt(0) - 0xac00) % 28;
}

export function adjustParticle(word: string, particle: string) {
  const pair = PARTICLE_PAIRS[particle];
  const jong = finalConsonant(word);
  if (!pair || jong === null) return particle;
  // ㄹ-final syllables take 로, not 으로.
  if (pair[0] === "으로") return jong === 0 || jong === 8 ? "로" : "으로";
  return jong === 0 ? pair[1] : pair[0];
}

// Markdown code and link targets must keep their literal text.
export function splitProtected(markdown: string) {
  const segments: { text: string; isProtected: boolean }[] = [];
  const push = (text: string, isProtected: boolean) => {
    if (!text) return;
    const last = segments.at(-1);
    if (last?.isProtected === isProtected) last.text += text;
    else segments.push({ text, isProtected });
  };
  let fence: string | null = null;
  for (const line of markdown.split(/(?<=\n)/)) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      push(line, true);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length)
        fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      push(line, true);
      continue;
    }
    let cursor = 0;
    for (const match of line.matchAll(UNPROTECTED_INLINE)) {
      push(line.slice(cursor, match.index), false);
      push(match[0], true);
      cursor = match.index + match[0].length;
    }
    push(line.slice(cursor), false);
  }
  return segments;
}

function buildMappings(expressions: ExpressionMapping[]) {
  const byKey = new Map<string, ExpressionMapping[]>();
  for (const expression of expressions) {
    const key = normalize(expression.text);
    if (!key || key === normalize(expression.termName)) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), expression]);
  }
  const mappings = new Map<string, ExpressionMapping>();
  const ambiguous: TransformOutput["ambiguous"] = [];
  for (const [key, candidates] of byKey) {
    const termIds = new Set(candidates.map((c) => c.termId));
    if (termIds.size === 1) mappings.set(key, candidates[0]);
    else
      ambiguous.push({
        text: candidates[0].text,
        termNames: [...new Set(candidates.map((c) => c.termName))],
      });
  }
  return { mappings, ambiguous };
}

function standardize(
  text: string,
  pattern: RegExp,
  mappings: Map<string, ExpressionMapping>,
  counts: Map<string, TermReplacement>,
) {
  let output = "";
  let cursor = 0;
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const end = m.index + m[0].length;
    const rest = text.slice(end);
    const mapping = mappings.get(normalize(m[0]));
    const accepted = HANGUL.test(m[0])
      ? PARTICLE_START.test(rest)
      : !ASCII_WORD.test(rest);
    if (!mapping || !accepted) {
      pattern.lastIndex = m.index + 1;
      continue;
    }
    const particle = PAIRED_PARTICLE.exec(rest)?.[1] ?? "";
    output +=
      text.slice(cursor, m.index) +
      mapping.termName +
      (particle ? adjustParticle(mapping.termName, particle) : "");
    cursor = end + particle.length;
    pattern.lastIndex = cursor;
    const key = `${m[0]}\u0000${mapping.termId}`;
    const current = counts.get(key);
    counts.set(key, {
      from: m[0],
      to: mapping.termName,
      termId: mapping.termId,
      count: (current?.count ?? 0) + 1,
    });
  }
  return output + text.slice(cursor);
}

function expressionPattern(keys: string[]) {
  const alternatives = [...keys]
    .sort((a, b) => b.length - a.length)
    .map((key) => escapeRegex(key).replace(/ /g, "[ \\t]+"));
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})`, "giu");
}

// Rule patterns are stored anchored to a whole value; documents need them found inside text.
export function unanchor(pattern: string) {
  let core = pattern.startsWith("^") ? pattern.slice(1) : pattern;
  if (core.endsWith("$") && !/(^|[^\\])(\\\\)*\\\$$/.test(core))
    core = core.slice(0, -1);
  return core;
}

function inDocument(pattern: string) {
  return new RegExp(
    `(?<![0-9A-Za-z])(?:${unanchor(pattern)})(?![0-9A-Za-z])`,
    "g",
  );
}

function applyMasking(
  markdown: string,
  rule: MaskingSpec,
): { markdown: string; count: number; error?: string } {
  const finder = inDocument(rule.pattern);
  const whole = new RegExp(`^(?:${unanchor(rule.pattern)})$`);
  const completed = new RegExp(rule.resultPattern);
  let count = 0;
  let rejected = 0;
  const result = markdown.replace(finder, (match) => {
    if (!match) return match;
    const masked = match.replace(whole, rule.replacement);
    if (!completed.test(masked)) {
      rejected++;
      return match;
    }
    count++;
    return masked;
  });
  return {
    markdown: result,
    count,
    error: rejected
      ? `치환 결과 ${rejected}건이 수정 완료 패턴과 맞지 않아 원본을 유지했습니다.`
      : undefined,
  };
}

export function transformMarkdown(
  markdown: string,
  input: TransformInput,
): TransformOutput {
  const errors: RuleError[] = [];
  const maskings: RuleCount[] = [];
  let current = markdown;
  for (const rule of input.masking) {
    try {
      const result = applyMasking(current, rule);
      current = result.markdown;
      maskings.push({ ...pick(rule), count: result.count });
      if (result.error) errors.push({ ...pick(rule), message: result.error });
    } catch (error) {
      errors.push({ ...pick(rule), message: (error as Error).message });
    }
  }

  const { mappings, ambiguous } = buildMappings(input.expressions);
  const counts = new Map<string, TermReplacement>();
  if (mappings.size) {
    const pattern = expressionPattern([...mappings.keys()]);
    current = splitProtected(current)
      .map((s) =>
        s.isProtected ? s.text : standardize(s.text, pattern, mappings, counts),
      )
      .join("");
  }

  const violations: RuleCount[] = [];
  for (const rule of input.prohibited) {
    try {
      const count = current.match(inDocument(rule.pattern))?.length ?? 0;
      if (count) violations.push({ ...pick(rule), count });
    } catch (error) {
      errors.push({ ...pick(rule), message: (error as Error).message });
    }
  }

  return {
    markdown: current,
    replacements: [...counts.values()],
    maskings,
    violations,
    ambiguous,
    errors,
  };
}

function pick(rule: { ruleId: string; ruleName: string }) {
  return { ruleId: rule.ruleId, ruleName: rule.ruleName };
}
