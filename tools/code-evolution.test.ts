import { describe, it, expect } from 'vitest';
import {
  validateDraft,
  validateCases,
  generateDraft,
  dockerRunArgs,
  hash,
} from './code-evolution.mjs';

const draft = {
  featureId: 'new-calculator',
  summary: 'A new calculator',
  files: {
    'logic.ts':
      'export function evaluate(input: Record<string, number>): Record<string, number> { return {total: input.amount * 2}; }',
    'Feature.tsx':
      'import React from "react"; import {evaluate} from "./logic"; export function Feature({input}: {input: Record<string, number>}) { return <div>{evaluate(input).total}</div>; }',
  },
};
const cases = [1, 2, 0].map((amount) => ({ input: { amount }, expected: { total: amount * 2 } }));
describe('code evolution draft boundaries', () => {
  it('accepts bounded source without tying its numeric feature to registered capabilities', () => {
    expect(validateDraft(draft)).toEqual(draft);
    expect(validateCases(cases)).toEqual(cases);
    expect(hash({ draft, cases })).not.toBe(hash({ draft, cases: cases.slice(1) }));
  });
  it.each(['../app.ts', 'package.json', 'Dockerfile', '.env', '/absolute.ts'])(
    'rejects generated paths or executable settings: %s',
    (name) => {
      expect(() => validateDraft({ ...draft, files: { ...draft.files, [name]: 'bad' } })).toThrow();
    },
  );
  it.each([
    'import fs from "node:fs";',
    'fetch("https://example.com")',
    'eval("x")',
    'process.exit(0)',
    'const x = globalThis;',
    'import("react")',
    'const x = input["constructor"];',
  ])('rejects restricted APIs: %s', (source) => {
    expect(() =>
      validateDraft({ ...draft, files: { ...draft.files, 'logic.ts': source } }),
    ).toThrow();
  });
  it('rejects source event handlers, HTML injection and provider-chosen assertions', () => {
    for (const source of [
      'const x = <div dangerouslySetInnerHTML={{__html: "x"}} />;',
      'const x = <button onClick={() => {}}>x</button>;',
    ])
      expect(() =>
        validateDraft({ ...draft, files: { ...draft.files, 'Feature.tsx': source } }),
      ).toThrow();
    expect(() => validateDraft({ ...draft, tests: [] })).toThrow();
    expect(() => validateCases([{ input: { x: 1 }, expected: { x: 1 } }])).toThrow();
    expect(() =>
      validateCases([
        ...cases.slice(0, 2),
        { input: { amount: Infinity }, expected: { total: 2 } },
      ]),
    ).toThrow();
  });
  it('requests source using supplied independent cases, excludes credentials from prompt, and validates the response', async () => {
    let body = '';
    const fetch = async (_url, options) => {
      body = options.body;
      expect(options.headers['x-goog-api-key']).toBe('test-key');
      return new Response(
        JSON.stringify({
          candidates: [
            { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(draft) }] } },
          ],
        }),
      );
    };
    expect(
      await generateDraft('Make a new calculator', cases, { apiKey: 'test-key', fetch }),
    ).toEqual(draft);
    expect(body).toContain('acceptanceCases');
    expect(body).not.toContain('test-key');
  });
  it('does not accept incomplete or failed provider output', async () => {
    await expect(
      generateDraft('Make a calculator', cases, {
        apiKey: 'test',
        fetch: async () => new Response('quota', { status: 429 }),
      }),
    ).rejects.toThrow('HTTP 429');
    await expect(
      generateDraft('Make a calculator', cases, {
        apiKey: 'test',
        fetch: async () =>
          new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] })),
      }),
    ).rejects.toThrow('incomplete');
  });
  it('uses network and filesystem isolation, resource bounds, and no host mounts or secrets', () => {
    const args = dockerRunArgs('draft-test', 'image-test');
    for (const flag of [
      '--read-only',
      '--network',
      '--cap-drop',
      '--security-opt',
      '--user',
      '--pids-limit',
      '--memory',
      '--cpus',
    ])
      expect(args).toContain(flag);
    expect(args).toContain('none');
    expect(args).not.toContain('--env-file');
    expect(args).not.toContain('--volume');
    expect(args).not.toContain('--privileged');
  });
});
