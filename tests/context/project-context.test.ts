import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ContextNotFoundError, PathTraversalError } from '../../src/context/errors.js';
import { ContextLoader } from '../../src/context/loader.js';
import { ProjectContext } from '../../src/context/project-context.js';
import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';

describe('ProjectContext', () => {
  let root: string;
  let context: ProjectContext;

  beforeAll(async () => {
    root = await createFixtureDir({
      'project.md': '# My project',
      'features/authentication.md': '# Authentication',
      'features/billing/invoices.md': '# Invoices',
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

  it('returns empty collections when the folders do not exist', async () => {
    const emptyRoot = await createFixtureDir({ 'project.md': '# Only the overview' });
    const emptyContext = new ProjectContext(new ContextLoader({ rootDir: emptyRoot }));

    await expect(emptyContext.listFeatures()).resolves.toEqual({ entries: [], skipped: [] });
    await expect(emptyContext.listConventions()).resolves.toEqual({ entries: [], skipped: [] });
    await removeFixtureDir(emptyRoot);
  });
});
