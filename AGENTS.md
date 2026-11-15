# Agent and contributor guidelines

These instructions govern changes to [Nodus Imago](https://github.com/jorgepb96/nodus-imago), whether a person or an AI agent makes them.

**Family:** Nodus Imago belongs to the Nodus family. Its repository mechanics (issues, pull requests, the Contributor License Agreement and the required checks) are the same as in [Nodus Research](https://github.com/jorgepb96/nodus). When the two differ, report the difference instead of inventing a third rule.

**MUST** and **MUST NOT** express mandatory requirements. **SHOULD** expresses a recommendation whose omission needs justification. These are development rules, not a declaration of regulatory compliance or an amendment to any software license.

## 1. Read the repository before changing it

Read `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CLA.md`, this file, and the code and tests around the change. Inspect the running application when a claim depends on runtime behavior.

Follow the actual contracts. Commands between the interface and the main process are typed in `shared/imago.ts` and validated in `shared/validation.ts`; do not add a command in one place only. Preserve unrelated work. Report conflicts between documentation and implementation; do not silently weaken a safeguard to resolve them.

## 2. Open an issue, then a pull request

- Every change reaches `main` through a pull request. Nobody pushes to `main` directly, maintainers and agents included.
- Every pull request MUST address an existing issue, linked from **Development** or with `Closes #123` / `Fixes #123` in its description. A plain `#123` mention is not a link.
- Issues and pull requests MUST be written in English. Use the issue templates; product feedback goes in the [shared feedback thread](https://github.com/jorgepb96/nodus-imago/issues/1).
- Keep each pull request to one coherent change and fill in the pull request template: problem, solution, checks run, screenshots, privacy effects.
- The required checks are **test**, **Issue linked** and **CLA / signature**. Do not mark a check green by hand, bypass a ruleset, or merge with a failing check.
- An agent MUST NOT accept the CLA on anyone's behalf. Acceptance is a comment posted by the human contributor from their own account.

## 3. Write commits for people

- Commit messages describe the change in plain English: a short subject (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `release:`), then the reason when it is not obvious.
- Do not add `Co-Authored-By` trailers or other attributions for AI tools to commits. The human who submits the change is its author and is responsible for it.
- Do not rewrite published history. A rewrite of `main` needs the maintainer's explicit request.

## 4. Keep Nodus Imago local-first

- Catalogues, images and indexes live on the user's computer. New network access MUST be explicit, documented and started by the user.
- Original image files MUST NOT be modified. Restorations, crops and edits are stored apart from the original.
- AI results are proposals. Nothing changes in a record until the user approves it, and images go to an AI provider only when the user has chosen that provider.
- Requests to public services (Wikimedia Commons, Wikidata, Getty, Iconclass) identify the application, respect each service's rate limits, and wait when the service asks.

## 5. Protect private data and research

- Never commit real catalogues, CSV or database exports, unpublished research, private images, credentials, or screenshots that show them. The repository is public.
- Tests, fixtures, demonstrations and README screenshots use synthetic data or public-domain images.
- Never place personal data, local paths or account details in requests to external services.
- Report security problems privately as described in `SECURITY.md`.

## 6. Preserve historical evidence

- Do not fabricate dates, attributions, places, citations or authority links. A proposal shows where it comes from.
- Dates keep what the cataloguer wrote ("c. 1860", "[1930]", "1950s") alongside the period read from it.
- Statistics and agreement measures report what they exclude and why.

## 7. Write interface text plainly

- Spanish is the source language of the interface. Every new static string needs its English entry in `src/i18n.tsx` (main-process messages in `src/i18n.backend.ts`); the internationalization tests fail otherwise.
- Write plain, explanatory text without metaphors. Say what a control does and what happens to the data.

## 8. Record user-visible changes

- Every user-visible change gets a note in `shared/releaseNotes.ts`, in Spanish and English, as a new feature, an enhancement or a fix.
- The What's New window and the GitHub release description are generated from these notes (`scripts/generate-release-notes.mjs`). Do not write release descriptions by hand.
- A version bump changes `package.json` and `package-lock.json` together and adds the notes for that version.

## 9. Validate and report before asking for review

Run what CI runs for the area you changed:

```sh
npm run verify            # typecheck, lint, unit tests and build
npm run test:desktop:all  # desktop flows; needs a graphical session
node --test scripts/test-cla.mjs scripts/test-cla-reminder.mjs scripts/test-pr-checks.mjs
```

Add focused tests for behavior changes and regression fixes. Check visible changes in the running application, with demonstration data, before describing them as done. Report what was verified, what was not, and any failing check with its output; do not describe an unverified change as working.
