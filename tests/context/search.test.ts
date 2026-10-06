import { describe, expect, it } from 'vitest';

import { InvalidQueryError } from '../../src/context/errors.js';
import type { ContextDocument } from '../../src/context/loader.js';
import {
  countWords,
  foldText,
  MAX_EXCERPT_CHARS,
  MAX_QUERY_TERMS,
  parseQuery,
  searchDocuments,
  splitIntoSections,
  stem,
} from '../../src/context/search.js';

function documentOf(
  path: string,
  content: string,
  extra: Partial<ContextDocument> = {},
): ContextDocument {
  const name = path.replace(/^.*\//, '').replace(/\.md$/, '');
  return { path, name, title: name, tags: [], content, ...extra };
}

function search(documents: ContextDocument[], query: string, limit = 5) {
  return searchDocuments(documents, parseQuery(query), limit);
}

describe('foldText', () => {
  it('ignores case and accents', () => {
    expect(foldText('Sécurité ÉTÉ Ça')).toBe('securite ete ca');
  });
});

describe('countWords', () => {
  it('counts runs of letters and digits, in any alphabet, not padding or symbols', () => {
    expect(countWords('| ------ | token  |')).toBe(1);
    expect(countWords("l'API v2 répond 404")).toBe(5);
    expect(countWords('Δέλτα 東京 𝐀𝐁')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});

describe('stem', () => {
  it.each([
    ['paginer', 'pagin'],
    ['pagination', 'pagin'],
    ['taches', 'tach'],
    ['tokens', 'token'],
    ['users', 'user'],
    ['rules', 'rule'],
    ['token', 'token'],
    ['rate', 'rate'],
  ])('%s → %s', (word, expected) => {
    expect(stem(word)).toBe(expected);
  });
});

describe('parseQuery', () => {
  it('folds, stems and drops common words and punctuation', () => {
    expect(parseQuery('Comment gérer les Refresh-Tokens ?')).toEqual(['gerer', 'refresh', 'token']);
  });

  it('removes duplicates', () => {
    expect(parseQuery('token tokens TOKEN')).toEqual(['token']);
  });

  it(`keeps at most ${String(MAX_QUERY_TERMS)} terms`, () => {
    const words = Array.from({ length: 30 }, (_, index) => `word${String(index)}`);

    expect(parseQuery(words.join(' '))).toHaveLength(MAX_QUERY_TERMS);
  });

  it.each(['', '   ', '?!', 'a b c', 'le la the and'])(
    'rejects %j, which holds nothing to search',
    (query) => {
      expect(() => parseQuery(query)).toThrow(InvalidQueryError);
    },
  );
});

describe('splitIntoSections', () => {
  it('cuts at headings, keeps the heading trail and ignores "#" lines in code blocks', () => {
    const document = documentOf(
      'features/auth.md',
      [
        'Intro text',
        '# Auth',
        'Overview',
        '## Flows',
        '### Login',
        'Login text',
        '```bash',
        '# not a heading',
        '```',
        '## Endpoints',
        'Endpoint text',
      ].join('\n'),
    );

    expect(splitIntoSections(document).map(({ headings, text }) => ({ headings, text }))).toEqual([
      { headings: [], text: 'Intro text' },
      { headings: ['Auth'], text: 'Overview' },
      { headings: ['Auth', 'Flows', 'Login'], text: 'Login text\n```bash\n# not a heading\n```' },
      { headings: ['Auth', 'Endpoints'], text: 'Endpoint text' },
    ]);
  });
});

describe('searchDocuments', () => {
  describe('matching', () => {
    it('ignores case and accents', () => {
      const results = search([documentOf('a.md', 'Les règles de sécurité.')], 'SECURITE');

      expect(results.map((result) => result.path)).toEqual(['a.md']);
    });

    it('matches the start of words only', () => {
      const documents = [documentOf('a.md', 'Tokens are rotated.'), documentOf('b.md', 'Valide.')];

      expect(search(documents, 'token').map((result) => result.path)).toEqual(['a.md']);
      expect(search(documents, 'id')).toEqual([]);
    });

    it('finds the other forms of a word through its stem', () => {
      const results = search([documentOf('a.md', 'La pagination est plafonnée.')], 'paginer');

      expect(results).toHaveLength(1);
    });

    it('needs a searched word in the section itself, not only in the document tags', () => {
      const document = documentOf(
        'security.md',
        '## Dependencies\n\nAudit them.\n\n## Secrets\n\nNever commit a secret.',
        { tags: ['secrets'] },
      );

      expect(search([document], 'secrets').map((result) => result.headings)).toEqual([['Secrets']]);
    });

    it('returns nothing when no section matches', () => {
      expect(search([documentOf('a.md', 'Nothing relevant.')], 'kubernetes')).toEqual([]);
    });
  });

  describe('ranking', () => {
    it('ranks a section holding every word above one repeating a single word', () => {
      const documents = [
        documentOf('repeat.md', Array.from({ length: 15 }, () => 'token').join(' ')),
        documentOf('both.md', 'The refresh token is rotated.'),
      ];

      expect(search(documents, 'refresh token').map((result) => result.path)).toEqual([
        'both.md',
        'repeat.md',
      ]);
    });

    it('ranks a short section above a long one holding the same occurrences', () => {
      const long = documentOf(
        'long.md',
        `${'Some unrelated words here. '.repeat(40)}Pagination is capped.`,
      );
      const short = documentOf('short.md', 'Pagination is capped.');

      expect(search([long, short], 'pagination').map((result) => result.path)).toEqual([
        'short.md',
        'long.md',
      ]);
    });

    it('measures length in words, so that the padding of a table does not count', () => {
      const prose = documentOf('prose.md', 'Pagination is capped at one hundred items.');
      const table = documentOf(
        'table.md',
        [
          '| Pagination     | Capped           |',
          '| -------------- | ---------------- |',
          '| Items          | 100              |',
        ].join('\n'),
      );

      expect(search([prose, table], 'pagination').map((result) => result.path)).toEqual([
        'table.md',
        'prose.md',
      ]);
    });

    it('ranks a section whose heading holds the word first', () => {
      const document = documentOf(
        'a.md',
        '## Other\n\nThe token changes.\n\n## Token rotation\n\nIt changes.',
      );

      expect(search([document], 'token').map((result) => result.headings)).toEqual([
        ['Token rotation'],
        ['Other'],
      ]);
    });

    it('counts the document title for a section that mentions another searched word', () => {
      const document = documentOf('security.md', '## IDOR\n\nLoad with the workspace.', {
        title: 'Règles de sécurité',
      });
      const other = documentOf('other.md', 'IDOR is mentioned here.');

      expect(search([other, document], 'securite idor')[0]?.path).toBe('security.md');
    });

    it('returns at most `limit` results, in document order when scores tie', () => {
      const documents = ['c.md', 'a.md', 'b.md'].map((path) => documentOf(path, 'token'));

      expect(search(documents, 'token', 2).map((result) => result.path)).toEqual(['c.md', 'a.md']);
    });
  });

  describe('excerpts', () => {
    it('returns a section whose own heading holds a searched word whole', () => {
      const text = '- Load with the workspace.\n- Identity comes from the token.\n- Answer 404.';
      const [result] = search([documentOf('a.md', `## Access control (IDOR)\n\n${text}`)], 'idor');

      expect(result?.excerpt).toBe(text);
    });

    it('returns only the blocks holding a searched word from a section that mentions it', () => {
      const text = [
        'Points to watch.',
        '',
        '- **IDOR**: load a task with its workspace.',
        '- **Pagination**: `limit` is capped at 100.',
        '- **Dates**: stored in UTC.',
      ].join('\n');
      const [result] = search([documentOf('a.md', `## Pitfalls\n\n${text}`)], 'pagination');

      expect(result?.excerpt).toBe('…\n- **Pagination**: `limit` is capped at 100.\n…');
    });

    it('keeps the blank lines between blocks that follow each other', () => {
      const text = 'The token expires.\n\nThe token rotates.\n\nSomething else.';
      const [result] = search([documentOf('a.md', text)], 'token');

      expect(result?.excerpt).toBe('The token expires.\n\nThe token rotates.\n…');
    });

    it('keeps a paragraph or a list item whole, wrapped lines included', () => {
      const document = documentOf(
        'a.md',
        [
          'A paragraph wrapped',
          'over two lines.',
          '',
          '- An item about',
          '  token rotation.',
          '- Another item.',
        ].join('\n'),
      );

      expect(search([document], 'paragraph')[0]?.excerpt).toBe(
        'A paragraph wrapped\nover two lines.\n…',
      );
      expect(search([document], 'rotation')[0]?.excerpt).toBe(
        '…\n- An item about\n  token rotation.\n…',
      );
    });

    const table = [
      '| State               | Tool            |',
      '| ------------------- | --------------- |',
      '| Server data         | TanStack Query  |',
      '| Filters, pagination | URL parameters  |',
      '| Forms               | React Hook Form |',
    ];

    it('keeps a matching table row with the table header, which names its columns', () => {
      const [result] = search([documentOf('a.md', table.join('\n'))], 'pagination');

      expect(result?.excerpt).toBe([table[0], table[1], '…', table[3], '…'].join('\n'));
    });

    it('keeps the whole table when its header holds a searched word', () => {
      const [result] = search([documentOf('a.md', table.join('\n'))], 'tool');

      expect(result?.excerpt).toBe(table.join('\n'));
    });

    it('keeps a whole code block when one of its lines holds a searched word', () => {
      const code = [
        '```ts',
        'const config = load();',
        "const secret = config.get('SECRET');",
        '```',
      ];
      const text = ['Read the configuration.', '', ...code, '', 'Never log it.'].join('\n');
      const [result] = search([documentOf('a.md', text)], 'secret');

      expect(result?.excerpt).toBe(['…', ...code, '…'].join('\n'));
    });

    it('cuts the matching blocks to the size limit too, without two "…" in a row', () => {
      const items = Array.from({ length: 200 }, (_, index) =>
        index % 2 === 0
          ? `- Item ${String(index)} is about the token.`
          : `- Item ${String(index)} is about something else.`,
      );
      const [result] = search([documentOf('a.md', items.join('\n'))], 'token');
      const excerpt = result?.excerpt ?? '';

      expect(excerpt.endsWith('\n…')).toBe(true);
      expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 2);
      expect(excerpt).not.toContain('…\n…');
      expect(
        excerpt
          .split('\n')
          .filter((line) => line !== '…')
          .every((line) => line.endsWith('the token.')),
      ).toBe(true);
    });

    it('returns whole lines around the match when the section is long', () => {
      const lines = Array.from(
        { length: 60 },
        (_, index) => `Line ${String(index)} talks about something else.`,
      );
      lines[40] = 'Line 40 explains the rotation of refresh tokens.';
      const [result] = search(
        [documentOf('a.md', `## Rotation\n\n${lines.join('\n')}`)],
        'rotation',
      );
      const excerpt = result?.excerpt ?? '';

      expect(excerpt.startsWith('…\n')).toBe(true);
      expect(excerpt).toContain('Line 40 explains the rotation of refresh tokens.');
      expect(
        excerpt
          .split('\n')
          .filter((line) => line !== '…')
          .every((line) => /^Line \d+ .+\.$/.test(line)),
      ).toBe(true);
      expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 4);
    });

    it('ends on a whole line, followed by "…", when the section goes on', () => {
      const lines = Array.from(
        { length: 100 },
        (_, index) => `Line ${String(index)} talks about something else.`,
      );
      lines[2] = 'Line 2 explains the rotation of refresh tokens.';
      const [result] = search(
        [documentOf('a.md', `## Rotation\n\n${lines.join('\n')}`)],
        'rotation',
      );
      const excerpt = result?.excerpt ?? '';

      expect(excerpt.startsWith('Line 0 ')).toBe(true);
      expect(excerpt.endsWith('\n…')).toBe(true);
      expect(
        excerpt
          .split('\n')
          .slice(0, -1)
          .every((line) => /^Line \d+ .+\.$/.test(line)),
      ).toBe(true);
    });

    it('cuts a single very long line at the size limit', () => {
      const [result] = search(
        [documentOf('a.md', `The rotation ${'word '.repeat(600)}end.`)],
        'rotation',
      );
      const excerpt = result?.excerpt ?? '';

      expect(excerpt.startsWith('The rotation')).toBe(true);
      expect(excerpt.endsWith('\n…')).toBe(true);
      expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS + 2);
    });

    it('keeps a code block closed when the window starts inside it', () => {
      const code = Array.from(
        { length: 80 },
        (_, index) => `const value${String(index)} = compute(${String(index)});`,
      );
      const text = ['## Rotation', '```ts', ...code, '```', 'The rotation happens here.'].join(
        '\n',
      );
      const [result] = search([documentOf('a.md', text)], 'rotation');
      const excerpt = result?.excerpt ?? '';

      expect(excerpt.startsWith('…\n```\n')).toBe(true);
      expect(excerpt.match(/^```/gm)).toHaveLength(2);
      expect(excerpt).toContain('The rotation happens here.');
    });
  });
});
