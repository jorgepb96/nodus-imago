# Contributing to Nodus Imago

Thank you for helping improve Nodus Imago. Contributions may include bug
reports, feature proposals, product feedback, documentation, translations,
tests, and code.

Nodus Imago belongs to the [Nodus](https://github.com/jorgepb96/nodus) family
and follows the same contribution rules, Contributor License Agreement, and
pull-request checks as Nodus Research.

By participating, you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). People and AI agents who change the code
also follow [AGENTS.md](AGENTS.md).

## Language

All issues and pull requests must be written in English, including titles,
descriptions, comments, and review discussion.

## Before opening an issue

Search the existing issues first. If a matching issue exists, add useful context
there instead of creating a duplicate.

Choose the path that best matches your contribution:

- **Bug report** for reproducible failures or incorrect behavior
- **Feature request** for a new capability or improvement
- **Product feedback** belongs in the permanent
  [shared feedback thread](https://github.com/jorgepb96/nodus-imago/issues/1);
  add a comment there instead of opening a new issue

Include your Nodus Imago version (Settings › Updates and news) and your
operating system when they are relevant.

Never include API keys, passwords, personal data, private catalogue content,
unpublished research, or images you are not allowed to share in a public issue.
Use demonstration or public-domain images instead. Security vulnerabilities must
be reported privately as described in [SECURITY.md](SECURITY.md).

## Development setup

Nodus Imago needs Node.js 22.12 or later; continuous integration uses Node.js 24.

1. Fork and clone the repository.
2. Install the locked dependencies (this also prepares the native modules):

   ```bash
   npm ci
   ```

3. Start the development app:

   ```bash
   npm run dev
   ```

Use a throwaway profile and demonstration or public-domain images while
developing. Do not test with real personal, institutional, or unpublished
research data.

## Quality checks

Run the checks that cover your change:

```bash
npm run verify             # typecheck, lint, unit tests and build
```

Changes that affect Electron startup, IPC, the database, packaging, or a major
user flow should also run the desktop flows, which launch the real app and need
a graphical session:

```bash
npm run test:desktop:all
```

The **Desktop validation** workflow builds, tests and packages the app on
macOS (Apple silicon and Intel), Windows, and Linux (x64 and ARM64), and runs
real CPU inference on each. Its final `test` job is the single required check:
it passes only when every platform passed and the repository automation tests
(CLA and PR checks) pass.

## Publishing releases

Every user-visible change is written in `shared/releaseNotes.ts`, in Spanish and
English, as a new feature, an enhancement, or a fix. After an update, the app
shows these notes in the What's New window, and the GitHub release description
is generated from the same English text in the same order
(`scripts/generate-release-notes.mjs`). A unit test requires notes for the
version in `package.json`.

To publish a version:

1. Update the version in `package.json` and `package-lock.json` and add its
   notes, through a pull request.
2. After it merges, tag the merged commit (`vX.Y.Z`) and run
   **Prepare signed release draft** with that tag. It builds, signs, notarizes,
   and checks every installer, then creates a draft release.
3. Publish the draft. The macOS Intel build is added afterwards by its own
   workflow, and the download counters update automatically.

## Project conventions

- Keep Nodus Imago local-first. New network access must be explicit,
  documented, and initiated by the user.
- Never modify original image files. Edits, restorations, and crops are kept
  apart from the original.
- AI results are proposals. Nothing changes in a record until the user
  approves it, and images go to an AI provider only when the user chooses that
  provider.
- Keep claims connected to real sources. Do not fabricate dates, attributions,
  citations, or authority links.
- Add focused tests for behavior changes and regression fixes.
- Reuse established components and patterns before introducing a parallel
  implementation.
- Do not commit build outputs, release artifacts, `node_modules`, temporary
  profiles, credentials, real catalogues, or images you are not allowed to share.

### User-interface text

Spanish is the source language for the desktop interface. Every new static UI
string must have its English entry in `src/i18n.tsx` (messages from the main
process go in `src/i18n.backend.ts`). The internationalization tests fail when a
translation is missing. Write plain, explanatory text without metaphors.

### Database and privacy changes

Database migrations must be additive, deterministic, and safe for existing
collections. Changes that affect stored data, backups, network requests, or AI
providers must include appropriate documentation and tests. Never rely on an
application downgrade or automatic data rollback as a migration strategy.

## Pull requests

Every change reaches `main` through a pull request; nobody pushes to `main`
directly, maintainers included.

Every pull request must address an existing issue. Open or find the issue first
and link it from **Development**, or use `Closes #123` / `Fixes #123` in the PR
description when targeting the default branch. A plain `#123` mention does not
create a linked issue. The required **Issue linked** check blocks merging until
the link exists. After changing a sidebar link, maintainers can run **PR checks**
manually or comment `retry` on the PR to refresh the result. There is no hourly
scan.

Keep each pull request focused on one coherent change. In the pull request:

- Explain the problem and the chosen solution.
- Reference the issue it addresses with `Closes #123` when the pull request
  should close it.
- List the checks you ran.
- Attach screenshots whenever possible: before-and-after images for visible UI
  changes and reproduction evidence for bug fixes.
- Call out migrations, privacy effects, network access, or compatibility risks.
- Update documentation, translations, and release notes when behavior changes.

All required checks, **test**, **Issue linked** and **CLA / signature**, must
pass. Every human author and coauthor must accept the
[Contributor License Agreement](CLA.md) before a pull request can be merged.
Maintainers may ask for a smaller scope, additional tests, or changes needed to
preserve the project's privacy and evidence standards.

After the checks for the current revision finish, the bot mentions the author
with the failing checks, links, and short log excerpts where available. It
updates repeated failures for that revision instead of posting duplicates.
When every applicable check passes, it mentions the repository owner and author
once each. This means the PR is ready for maintainer review and merge
consideration; it does not promise or perform a merge. Drafts receive the issue
check but no notification comments.

Editing, reopening, or marking a PR ready for review can retry its failed CI
once per revision, when the activity comes from its author or a maintainer.
New commits run CI normally. Maintainers can comment `retry` or `/retry` for
another failed-jobs retry, or use **Actions → PR checks → Run workflow** with
the retry option and PR number. Successful CI jobs are retained; CLA and
external checks follow their own instructions.

Maintainer setup and operation: [PR checks automation](docs/pr-checks.md).

## Licensing

The public project uses the [GNU Affero General Public License v3.0](LICENSE),
SPDX `AGPL-3.0-only`. Contributions also require explicit acceptance of the
[Nodus Imago Contributor License Agreement](CLA.md). You retain ownership
and grant the maintainer permission to sublicense and relicense your Contribution,
including under different open-source, source-available, or commercial terms.
You must have the authority to grant these rights and preserve all applicable
third-party notices. Previously merged contributions are not automatically
covered.

### Accepting the CLA

1. Read [CLA.md](CLA.md).
2. Open **CLA / signature → Details** in your pull request's checks.
3. Copy the exact acceptance statement, including the document digest, from the
   workflow summary and post it as a **new comment from your own GitHub account**
   on the pull request. Do not edit an existing comment to sign.
4. The workflow records the acceptance and rechecks open pull requests. You only
   need to accept once for this exact agreement. Every other author and coauthor
   must do the same; a maintainer cannot accept on another person's behalf.

The check includes the pull request author and all commit authors and coauthors.
Use commit email addresses associated with the correct GitHub accounts. Missing
account mappings, incomplete contributor data, and unsigned accounts block the
check. Maintainers must accept too. AI-assisted contributions are welcome: the
person submitting them must review them, accept the CLA, and have the authority
to grant the required rights. Recognized Claude/Codex/Copilot tool attributions do not
need a separate signature; they never exempt the responsible human or another
human coauthor. Unrecognized or misattributed identities must be corrected;
never remove a real author's attribution to avoid obtaining their acceptance.
See the exact recognized tool identities in
[the maintenance guide](docs/cla-maintenance.md#ai-attributions).

Acceptance records are public on the `cla-signatures` branch. They contain the
account identifier, username, statement, comment link and timestamp, originating
PR, and exact agreement. Do not post private identity or contact information.
Checking a box in the PR template does not replace acceptance.

Maintainer setup and recovery are documented in
[docs/cla-maintenance.md](docs/cla-maintenance.md).
