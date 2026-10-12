# Code Evolution: developer prototype

This experimental tool generates application source for a new numeric feature that is not in the runtime capability registry. It is separate from SDK v0.1 and does not change the existing application's configuration, source, data, permissions, or deployments. The first supported contract is a pure numeric calculation plus a static React result component. Arbitrary application editing, new persistent workflows, migrations, interactive generated forms, automatic publication, and pull requests are not implemented yet.

## Run

```sh
pnpm evolve:code "Create a late-payment fee calculator. Inputs are amount, daysLate, graceDays and dailyRatePercent. Charge only for max(0, daysLate - graceDays) days. Fee is amount times dailyRatePercent divided by 100 times chargeable days, rounded to two decimals. Return fee and total, where total is amount plus fee. Display both values in a readable React component." examples/code-evolution/late-payment-cases.json
pnpm evolve:preview <draft-id>
```

Generation uses the server-side `GEMINI_API_KEY` and `GEMINI_MODEL` in `.env`. Docker must be running for execution tests; Node and pnpm remain the existing development environment. The first sandbox build downloads the official `node:22.19.0-alpine` image. No generated package installations or generated commands run.

Supply 3–30 independent numeric input/expected-output cases. EvolveKit sends only the feature request and these cases to Gemini. The model returns exactly two bounded source files: `logic.ts` and `Feature.tsx`. It cannot choose filesystem paths, dependencies, Docker instructions, test commands, or assertions.

The logic exports `evaluate(input: Record<string, number>): Record<string, number>`. The component exports `Feature({input}: {input: Record<string, number>})`. Imports are limited to React and the generated logic. An AST policy rejects I/O/global APIs, dynamic imports, HTML injection, event handlers, and prototype access. This policy is a preliminary check, not a proof that generated code is trustworthy.

## Request-to-review sequence

1. Validate the request and developer-supplied cases; make a bounded, time-limited Gemini call.
2. Validate the untrusted response, fixed filenames, source size, and AST policy.
3. Create a fresh UUID draft directory under ignored `artifacts/code-evolution/`; write source, cases, and a SHA-256 manifest over the request, source, summary, and cases.
4. Verify the hash and compile TypeScript using host-owned compiler settings. Compilation parses generated code; it does not execute it.
5. Copy only the emitted code, cases, trusted runner, and installed React dependencies into a separate Docker build context. The app, database, `.env`, Git credentials, and Docker socket are absent.
6. Execute the host-owned assertion runner in a container with no network, read-only root filesystem, non-root user, dropped capabilities, no new privileges, 256 MB memory, one CPU, 32 process limit, and a 20-second deadline. There are no host mounts. Docker flags follow the [official container run reference](https://docs.docker.com/reference/cli/docker/container/run/).
7. Assert exact results against every independent case and render the component with those inputs. Recheck the source/case hash. Record `ready_for_code_review` only after these checks; otherwise record `checks_failed` with bounded diagnostics. Source never automatically enters the application.
8. Produce a static result preview with a restrictive CSP. The loopback preview server serves only this one checked draft at port 5190. Generated JavaScript does not run in the browser.
9. Remove only this run's test container and temporary image. Preserve draft source, compiled output, manifest, report, and preview for review.

Passing checks provides evidence for the supplied cases. It does not establish correctness on all inputs or eliminate the need for human source review. Docker shares the host kernel; stronger tenant isolation is needed before offering this as a production multi-user execution service.

## Versioning, permissions, and rollback boundary

This CLI is a local developer action, not a browser or multi-user API. It requires local workspace and Docker access. Drafts are scoped to unique IDs and pinned by content hashes; editing a draft invalidates its check. There is no approve, merge, activate, or deploy operation yet. The existing runtime proposal lifecycle remains independent. There is nothing to roll back in production because the prototype never publishes.

The next integration must attach generated source to an immutable code revision, bind reviewer approval to the exact source/base commit/test-case hashes, verify repository permission and the current base before merging, and deploy through a host-owned pipeline. Deployment records must reference an exact commit and restore the prior release on rollback. Database migrations require an explicit preservation strategy; code rollback must not delete business records. Runtime configuration approval cannot grant code publication permission.

## Verified milestone

On 13 October 2026 (Asia/Calcutta), a live Gemini call generated a late-payment calculator and React result component from the rule above. TypeScript compiled and all five independently supplied cases and React renders passed in the container. The draft remained `ready_for_code_review`, with no live application changes. A second staged draft with a deliberately incorrect expected total was rejected by the container assertion runner and recorded as `checks_failed`. All 80 unit tests passed, along with the existing workspace build and type checks. Boundary tests cover path injection, unapproved imports/APIs, HTML injection, independent-case requirements, provider failures, credential exclusion, and container flags.

Git was initialized on `main` with local identity `dipen-t <dipenntalreja@gmail.com>`. The connected GitHub account was verified as `Dipen-t`. A remote repository has not been created or pushed by this prototype.
