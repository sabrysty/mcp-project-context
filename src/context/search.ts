import { InvalidQueryError } from './errors.js';
import type { ContextDocument } from './loader.js';

export const MAX_QUERY_TERMS = 20;
/** An excerpt up to this size is returned as is, a longer one as whole lines around the match. */
export const MAX_EXCERPT_CHARS = 1200;
const CONTEXT_BEFORE_MATCH = 200;

// BM25, the classic ranking of full-text search engines (Lucene, Elasticsearch). K1 sets how
// fast the repetitions of a word stop adding to the score; B how much a long section is
// penalized against a short one holding the same occurrences.
const BM25_K1 = 1.2;
const BM25_B = 0.75;
/** A word found in the title, the tags or the headings counts like one more occurrence. */
const LABEL_WEIGHT = 1;

// Common French and English words: they appear in almost every section, so they would
// only add noise to the ranking.
const STOP_WORDS = new Set(
  [
    'au aux avec ce ces cette comment dans de des du elle en est et il ils la le les leur mais',
    'ne nous on ou par pas pour qu que quel quelle quelles quels qui quoi sa se ses son sont sur',
    'un une vous',
    'an and are as at be by do does for from how in is it its of or that the this to what when',
    'where which who why with',
  ]
    .join(' ')
    .split(' '),
);

// Light stemming: a query word loses one common French or English ending, so that its stem
// also finds the other forms ("paginer" → "pagin" finds "pagination"). Longest endings first.
const SUFFIXES = [
  'ations',
  'ation',
  'ements',
  'ement',
  'ings',
  'ing',
  'ers',
  'er',
  'ez',
  'ees',
  'ee',
  'es',
  'ed',
  'e',
  's',
];
const MIN_STEM_LENGTH = 4;

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const CODE_FENCE = /^ {0,3}(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const TABLE_DELIMITER = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** A part of a document, from one heading to the next. */
export interface DocumentSection {
  document: ContextDocument;
  /** Headings leading to the section, outermost first; empty before the first heading. */
  headings: string[];
  /** Body of the section, without its heading line. */
  text: string;
}

export interface SearchResult {
  path: string;
  title: string;
  headings: string[];
  excerpt: string;
  score: number;
}

/** Lowercases and strips accents, so that "Sécurité" and "securite" match. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Turns a query into the terms to search: folded, stemmed, deduplicated, without one-letter
 * words or common words. Throws when nothing searchable is left.
 */
export function parseQuery(query: string): string[] {
  const words = foldText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word))
    .map(stem);
  const terms = [...new Set(words)].slice(0, MAX_QUERY_TERMS);

  if (terms.length === 0) {
    throw new InvalidQueryError(
      `Nothing to search in ${JSON.stringify(query)}: use words of at least 2 characters, ` +
        'other than common words such as "the" or "le".',
    );
  }
  return terms;
}

/** Removes the longest common ending that leaves a stem of at least 4 characters. */
export function stem(word: string): string {
  const suffix = SUFFIXES.find(
    (ending) => word.endsWith(ending) && word.length - ending.length >= MIN_STEM_LENGTH,
  );
  return suffix === undefined ? word : word.slice(0, -suffix.length);
}

/** Cuts a document at its headings. Lines starting with "#" inside code blocks are not headings. */
export function splitIntoSections(document: ContextDocument): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const trail: { level: number; text: string }[] = [];
  let lines: string[] = [];
  let inCodeBlock = false;

  const closeSection = (): void => {
    const text = lines.join('\n').trim();
    if (text !== '') {
      sections.push({ document, headings: trail.map((heading) => heading.text), text });
    }
    lines = [];
  };

  for (const line of document.content.split('\n')) {
    if (CODE_FENCE.test(line)) inCodeBlock = !inCodeBlock;
    const heading = inCodeBlock ? null : HEADING.exec(line);
    if (heading === null) {
      lines.push(line);
      continue;
    }

    closeSection();
    const [, hashes = '', text = ''] = heading;
    while ((trail.at(-1)?.level ?? 0) >= hashes.length) trail.pop();
    trail.push({ level: hashes.length, text });
  }
  closeSection();

  return sections;
}

/** Ranks the sections of `documents` for the given terms and returns the `limit` best ones. */
export function searchDocuments(
  documents: readonly ContextDocument[],
  terms: readonly string[],
  limit: number,
): SearchResult[] {
  const patterns = terms.map(wordStartPattern);
  const sections = documents
    .flatMap(splitIntoSections)
    .map((section) => indexSection(section, patterns));
  const stats = computeStats(sections, patterns.length);

  return sections
    .map((indexed, position) => ({ indexed, position, score: scoreSection(indexed, stats) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit)
    .map(({ indexed: { section }, score }) => ({
      path: section.document.path,
      title: section.document.title,
      headings: section.headings,
      excerpt: makeExcerpt(section, patterns),
      score: Math.round(score * 100) / 100,
    }));
}

interface IndexedSection {
  section: DocumentSection;
  /** Occurrences of each term in the section itself: its own heading and its text. */
  occurrences: number[];
  /** Whether each term appears in the document title, its tags or the heading trail. */
  inLabels: boolean[];
  /**
   * Length of the section itself, in words, as BM25 defines it. Characters would penalize
   * tables and code: their padding and symbols make them longer without adding words.
   */
  length: number;
}

interface CorpusStats {
  averageLength: number;
  /** Inverse document frequency of each term: a rare word weighs more than a frequent one. */
  idf: number[];
}

function indexSection(section: DocumentSection, patterns: readonly RegExp[]): IndexedSection {
  const body = foldText(`${section.headings.at(-1) ?? ''}\n${section.text}`);
  const labels = foldText(
    [section.document.title, ...section.document.tags, ...section.headings].join('\n'),
  );

  return {
    section,
    occurrences: patterns.map((pattern) => countMatches(body, pattern)),
    inLabels: patterns.map((pattern) => countMatches(labels, pattern) > 0),
    length: countWords(body),
  };
}

/** Counts the runs of letters and digits, the words of parseQuery, in any alphabet. */
export function countWords(text: string): number {
  // A loop rather than text.match(/[\p{L}\p{N}]+/gu), which would build one string per word
  // only to count them: about 4 times slower on a 10 MB context.
  let words = 0;
  let inWord = false;

  for (const char of text) {
    const code = char.charCodeAt(0);
    // Folded text is mostly ASCII: its letters and digits are tested without the regex.
    const isWordCharacter =
      code < 128
        ? (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
        : WORD_CHARACTER.test(char);
    if (isWordCharacter && !inWord) words += 1;
    inWord = isWordCharacter;
  }
  return words;
}

function computeStats(sections: readonly IndexedSection[], termCount: number): CorpusStats {
  const total = sections.length;
  const averageLength =
    total === 0 ? 0 : sections.reduce((sum, indexed) => sum + indexed.length, 0) / total;
  const idf = Array.from({ length: termCount }, (_, term) => {
    const containing = sections.filter((indexed) => (indexed.occurrences[term] ?? 0) > 0).length;
    return Math.log(1 + (total - containing + 0.5) / (containing + 0.5));
  });

  return { averageLength, idf };
}

function scoreSection(
  { occurrences, inLabels, length }: IndexedSection,
  { averageLength, idf }: CorpusStats,
): number {
  // The section must mention a searched word itself: a title or a tag describes the whole
  // document, so on its own it would make every section of that document match.
  if (occurrences.every((count) => count === 0)) return 0;

  const lengthRatio = averageLength === 0 ? 1 : length / averageLength;
  const lengthNorm = 1 - BM25_B + BM25_B * lengthRatio;
  let score = 0;
  let matchedTerms = 0;

  for (const [term, count] of occurrences.entries()) {
    // A word of the title or of a parent heading still describes this section: for
    // "sécurité IDOR", the IDOR section of the security guidelines matches both words.
    const labelled = inLabels[term] ?? false;
    if (count === 0 && !labelled) continue;

    matchedTerms += 1;
    const saturated = (count * (BM25_K1 + 1)) / (count + BM25_K1 * lengthNorm);
    score += (idf[term] ?? 0) * (saturated + (labelled ? LABEL_WEIGHT : 0));
  }

  // Coverage: a section holding every searched word beats one repeating a single word.
  return score * (matchedTerms / occurrences.length);
}

/** Matches a word at the start of a word: "token" finds "tokens", "id" does not find "valide". */
function wordStartPattern(term: string): RegExp {
  // Terms only hold letters and digits (see parseQuery): no regex escaping is needed.
  return new RegExp(`(?<![\\p{L}\\p{N}])${term}`, 'gu');
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * A section whose own heading holds a searched word is about the topic: it is returned whole,
 * so that an agent gets complete rules. Any other section only mentions the topic: only its
 * blocks holding a searched word are returned, so that its unrelated parts cost no tokens.
 */
function makeExcerpt({ headings, text }: DocumentSection, patterns: readonly RegExp[]): string {
  const aboutTopic = mentions(headings.at(-1) ?? '', patterns);
  const excerpt = fitToSize(aboutTopic ? text : matchingBlocks(text, patterns), patterns);
  // A cut next to left-out text would show two "…" in a row.
  return excerpt.replace(/^…(?:\n…)+$/gm, '…');
}

function mentions(text: string, patterns: readonly RegExp[]): boolean {
  const folded = foldText(text);
  return patterns.some((pattern) => folded.search(pattern) >= 0);
}

/** Lines `start` to `end`, both included, that are kept or left out together. */
interface Block {
  start: number;
  end: number;
  kind: 'code' | 'table' | 'text';
}

/**
 * The Markdown blocks of `text` holding a searched word, in order, with a "…" line for each
 * run of left-out text. A block is a paragraph, a list item, a table row or a code block: a
 * single line could be a cut sentence, since paragraphs may be wrapped over several lines.
 */
function matchingBlocks(text: string, patterns: readonly RegExp[]): string {
  const lines = text.split('\n');
  const kept = new Set(
    splitIntoBlocks(lines).flatMap((block) => keptLines(block, lines, patterns)),
  );
  // The match is always in some block; this only guards against returning nothing.
  if (kept.size === 0) return text;

  const output: string[] = [];
  let previous = -1;
  for (const index of [...kept].sort((a, b) => a - b)) {
    const gap = lines.slice(previous + 1, index);
    if (gap.some(isNotBlank)) output.push('…');
    else if (previous >= 0) output.push(...gap);
    output.push(lines[index] ?? '');
    previous = index;
  }
  if (lines.slice(previous + 1).some(isNotBlank)) output.push('…');

  return output.join('\n');
}

/** Cuts lines into code blocks, tables, list items and paragraphs. */
function splitIntoBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let start = 0;

  while (start < lines.length) {
    const line = lines[start] ?? '';
    if (!isNotBlank(line)) {
      start += 1;
      continue;
    }
    const kind = CODE_FENCE.test(line) ? 'code' : TABLE_ROW.test(line) ? 'table' : 'text';
    const end = endOfBlock(lines, start, kind);
    blocks.push({ start, end, kind });
    start = end + 1;
  }
  return blocks;
}

function endOfBlock(lines: readonly string[], start: number, kind: Block['kind']): number {
  let end = start + 1;
  if (kind === 'code') {
    // Up to the closing fence, or to the last line when the block is never closed.
    while (end < lines.length && !CODE_FENCE.test(lines[end] ?? '')) end += 1;
    return Math.min(end, lines.length - 1);
  }

  // A paragraph or a list item goes on until a blank line or the start of another block.
  const goesOn =
    kind === 'table'
      ? (line: string) => TABLE_ROW.test(line)
      : (line: string) =>
          isNotBlank(line) &&
          !LIST_ITEM.test(line) &&
          !TABLE_ROW.test(line) &&
          !CODE_FENCE.test(line);
  while (end < lines.length && goesOn(lines[end] ?? '')) end += 1;
  return end - 1;
}

/**
 * Indexes of the lines of `block` to keep. A table row is kept with the table header, which
 * names its columns; a searched word in the header names a column, so the whole table is kept.
 */
function keptLines(block: Block, lines: readonly string[], patterns: readonly RegExp[]): number[] {
  const { start, end, kind } = block;
  const whole = range(start, end);
  if (kind !== 'table') {
    return mentions(lines.slice(start, end + 1).join('\n'), patterns) ? whole : [];
  }

  if (mentions(lines[start] ?? '', patterns)) return whole;
  const headerEnd = start < end && TABLE_DELIMITER.test(lines[start + 1] ?? '') ? start + 1 : start;
  const rows = range(headerEnd + 1, end).filter((index) => mentions(lines[index] ?? '', patterns));
  return rows.length === 0 ? [] : [...range(start, headerEnd), ...rows];
}

/** Integers from `start` to `end`, both included. */
function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, offset) => start + offset);
}

function isNotBlank(line: string): boolean {
  return line.trim() !== '';
}

/** `text` when it is short enough, else whole lines around the first match, line breaks kept. */
function fitToSize(text: string, patterns: readonly RegExp[]): string {
  if (text.length <= MAX_EXCERPT_CHARS) return text;

  const start = startOfLine(text, Math.max(0, firstMatch(text, patterns) - CONTEXT_BEFORE_MATCH));
  const cut = start + MAX_EXCERPT_CHARS;
  const end = cut >= text.length ? text.length : endOfLastLine(text, start, cut);

  let excerpt = text.slice(start, end).trimEnd();
  // A window must not leave a code block open: the rest of the answer would read as code.
  if (countCodeFences(text.slice(0, start)) % 2 === 1) excerpt = `\`\`\`\n${excerpt}`;
  if (countCodeFences(excerpt) % 2 === 1) excerpt = `${excerpt}\n\`\`\``;

  return `${start > 0 ? '…\n' : ''}${excerpt}${end < text.length ? '\n…' : ''}`;
}

/** Index in `text` of the first match of any pattern, or 0 when none matches. */
function firstMatch(text: string, patterns: readonly RegExp[]): number {
  const { folded, origins } = foldWithOrigins(text);
  const starts = patterns.map((pattern) => folded.search(pattern)).filter((index) => index >= 0);
  return starts.length === 0 ? 0 : (origins[Math.min(...starts)] ?? 0);
}

/**
 * Folds the text character by character, remembering where each folded character comes
 * from: a match found in the folded text can then be shown with its original accents.
 */
function foldWithOrigins(text: string): { folded: string; origins: number[] } {
  let folded = '';
  const origins: number[] = [];
  let index = 0;

  for (const char of text) {
    const foldedChar = foldText(char);
    for (let offset = 0; offset < foldedChar.length; offset += 1) origins.push(index);
    folded += foldedChar;
    index += char.length;
  }
  return { folded, origins };
}

function startOfLine(text: string, index: number): number {
  return text.lastIndexOf('\n', index - 1) + 1;
}

/** End of the last whole line before `cut`, or `cut` itself inside a single very long line. */
function endOfLastLine(text: string, start: number, cut: number): number {
  const lineBreak = text.lastIndexOf('\n', cut);
  return lineBreak > start ? lineBreak : cut;
}

function countCodeFences(text: string): number {
  return text.match(/^ {0,3}(```|~~~)/gm)?.length ?? 0;
}
