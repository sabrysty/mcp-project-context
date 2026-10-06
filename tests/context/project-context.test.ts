import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ContextNotFoundError,
  InvalidQueryError,
  PathTraversalError,
} from '../../src/context/errors.js';
import { ContextLoader } from '../../src/context/loader.js';
import { locateDocument, ProjectContext } from '../../src/context/project-context.js';
import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';

describe('locateDocument', () => {
  it.each([
    ['project.md', { kind: 'project' }],
    ['features/billing/invoices.md', { kind: 'feature', name: 'billing/invoices' }],
    ['conventions/react.md', { kind: 'convention', topic: 'react' }],
    ['security/guidelines.md', { kind: 'other' }],
  ])('%s', (path, expected) => {
    expect(locateDocument(path)).toEqual(expected);
  });
});

describe('ProjectContext', () => {
  let root: string;
  let context: ProjectContext;

  beforeAll(async () => {
    root = await createFixtureDir({
      'project.md': '# My project',
      'features/authentication.md': '# Authentication',
      'features/billing/invoices.md': '# Invoices\n\nInvoices are sent every month.',
      'conventions/react.md': '# React',
    });
    context = new ProjectContext(new ContextLoader({ rootDir: root }));
  });

  afterAll(async () => {
    await removeFixtureDir(root);
  });

  it('loads project.md', async () => {
    await expect(context.getProject()).resolves.toMatchObject({ title: 'My project' });
  });

  it('names features by their path inside features/, without extension', async () => {
    const { entries } = await context.listFeatures();

    expect(entries.map((entry) => entry.name)).toEqual(['authentication', 'billing/invoices']);
  });

  it('loads a feature by name, with or without the .md extension', async () => {
    await expect(context.getFeature('billing/invoices')).resolves.toMatchObject({
      title: 'Invoices',
    });
    await expect(context.getFeature('authentication.md')).resolves.toMatchObject({
      title: 'Authentication',
    });
  });

  it('lists and loads conventions by topic', async () => {
    const { entries } = await context.listConventions();

    expect(entries.map((entry) => entry.name)).toEqual(['react']);
    await expect(context.getConvention('react')).resolves.toMatchObject({ title: 'React' });
  });

  it('reports a missing feature', async () => {
    await expect(context.getFeature('missing')).rejects.toThrow(ContextNotFoundError);
  });

  it('refuses a name that leaves its collection', async () => {
    await expect(context.getFeature('../project')).rejects.toThrow(PathTraversalError);
  });

  it('searches every document and returns the searched stems', async () => {
    const outcome = await context.search('invoices', 5);

    expect(outcome.terms).toEqual(['invoic']);
    expect(outcome.results.map((result) => result.path)).toEqual(['features/billing/invoices.md']);
    expect(outcome.skipped).toEqual([]);
  });

  it('rejects a query with nothing to search', async () => {
    await expect(context.search('the', 5)).rejects.toThrow(InvalidQueryError);
  });

  it('returns empty collections when the folders do not exist', async () => {
    const emptyRoot = await createFixtureDir({ 'project.md': '# Only the overview' });
    const emptyContext = new ProjectContext(new ContextLoader({ rootDir: emptyRoot }));

    await expect(emptyContext.listFeatures()).resolves.toEqual({ entries: [], skipped: [] });
    await expect(emptyContext.listConventions()).resolves.toEqual({ entries: [], skipped: [] });
    await removeFixtureDir(emptyRoot);
  });
});
