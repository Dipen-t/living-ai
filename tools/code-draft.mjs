import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { command, hash, validateDraft, validateCases, workspace } from './code-evolution.mjs';

const [operation, id, reviewUrl] = process.argv.slice(2);
if (!['export', 'link'].includes(operation) || !/^[0-9a-f-]{36}$/.test(id ?? ''))
  throw new Error(
    'Usage: pnpm code:draft export <proposal-id> or pnpm code:draft link <proposal-id> <pull-request-url>',
  );
const db = new PrismaClient();
try {
  const proposal = await db.codeProposal.findUnique({ where: { id } });
  if (!proposal || !['Ready', 'PendingApproval', 'Approved', 'Published'].includes(proposal.state))
    throw new Error('A checked code draft is required.');
  const draft = validateDraft(proposal.source),
    cases = validateCases(proposal.cases);
  if (hash({ draft, cases, request: proposal.request }) !== proposal.contentHash)
    throw new Error('Source fingerprint does not match this proposal.');
  const scope = { applicationId: proposal.applicationId, tenantId: proposal.tenantId };
  const actorId = (await command('git', ['config', '--local', 'user.name'])).trim();
  if (actorId.toLowerCase() !== 'dipen-t')
    throw new Error('Configure the authorized dipen-t Git identity first.');
  const origin = (await command('git', ['remote', 'get-url', 'origin'])).trim();
  if (origin.toLowerCase() !== 'https://github.com/dipen-t/living-ai.git')
    throw new Error('This exporter targets only the authorized Dipen-t/living-ai repository.');
  if (operation === 'link') {
    if (!/^https:\/\/github\.com\/Dipen-t\/living-ai\/pull\/[1-9][0-9]*$/i.test(reviewUrl ?? ''))
      throw new Error('Supply this repository’s pull request URL.');
    const exported = await db.auditEvent.findFirst({
      where: { ...scope, resourceId: id, eventType: 'CodeExported' },
      orderBy: { createdAt: 'desc' },
    });
    if (!exported || exported.metadata.contentHash !== proposal.contentHash)
      throw new Error('Export the exact source before linking its review.');
    await db.auditEvent.create({
      data: {
        id: randomUUID(),
        ...scope,
        actorId,
        eventType: 'CodePullRequest',
        resourceId: id,
        correlationId: randomUUID(),
        metadata: {
          url: reviewUrl,
          contentHash: proposal.contentHash,
          sourceCommit: exported.metadata.sourceCommit,
        },
      },
    });
    console.log('Code review linked: ' + reviewUrl);
  } else {
    const head = (await command('git', ['rev-parse', 'HEAD'])).trim();
    if (head !== proposal.baseCommit)
      throw new Error('The app base changed. Generate a new draft before exporting.');
    const previous = await db.auditEvent.findFirst({
      where: { ...scope, resourceId: id, eventType: 'CodeExported' },
      orderBy: { createdAt: 'desc' },
    });
    if (previous?.metadata.contentHash === proposal.contentHash) {
      console.log(JSON.stringify(previous.metadata, null, 2));
    } else {
      const directory = path.join(workspace, 'artifacts/code-exports', randomUUID());
      await mkdir(directory, { recursive: true });
      const env = { GIT_INDEX_FILE: path.join(directory, 'index') };
      await command('git', ['read-tree', head], { env });
      const files = {
        ...draft.files,
        'cases.json': JSON.stringify(cases, null, 2),
        'review.json': JSON.stringify(
          {
            proposalId: id,
            contentHash: proposal.contentHash,
            baseCommit: head,
            summary: draft.summary,
          },
          null,
          2,
        ),
      };
      for (const [name, source] of Object.entries(files)) {
        const blob = (
          await command('git', ['hash-object', '-w', '--stdin'], { input: source })
        ).trim();
        await command(
          'git',
          [
            'update-index',
            '--add',
            '--cacheinfo',
            '100644,' + blob + ',generated-features/' + id + '/' + name,
          ],
          { env },
        );
      }
      const tree = (await command('git', ['write-tree'], { env })).trim();
      let sourceCommit = (
        await command(
          'git',
          [
            'commit-tree',
            tree,
            '-p',
            head,
            '-m',
            'Draft generated calculator for source review',
            '-m',
            'Proposal ' + id + '\nSource fingerprint ' + proposal.contentHash,
          ],
          { env },
        )
      ).trim();
      const branch = 'codex/feature-' + id;
      const exists = await command('git', ['branch', '--list', branch]);
      if (exists.trim()) {
        const existing = (await command('git', ['rev-parse', branch])).trim();
        const existingTree = (await command('git', ['rev-parse', branch + '^{tree}'])).trim();
        const parents = (await command('git', ['show', '-s', '--format=%P', existing])).trim();
        if (existingTree !== tree || parents !== head)
          throw new Error('The export branch contains different source. It will not be overwritten.');
        sourceCommit = existing;
      } else {
        await command('git', ['update-ref', 'refs/heads/' + branch, sourceCommit, '0'.repeat(40)]);
      }
      await command('git', ['push', 'origin', branch], { timeout: 60000 });
      const metadata = {
        branch,
        sourceCommit,
        baseCommit: head,
        contentHash: proposal.contentHash,
      };
      await db.auditEvent.create({
        data: {
          id: randomUUID(),
          ...scope,
          actorId,
          eventType: 'CodeExported',
          resourceId: id,
          correlationId: randomUUID(),
          metadata,
        },
      });
      console.log(JSON.stringify(metadata, null, 2));
    }
  }
} finally {
  await db.$disconnect();
}
