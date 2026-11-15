# Security Policy

## Supported versions

Security fixes are provided for the latest published Nodus Imago release. Older
versions may not receive patches.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

Before reporting a vulnerability, verify whether it still affects the latest
release available from the
[Nodus Imago releases page](https://github.com/jorgepb96/nodus-imago/releases/latest).

## Reporting a vulnerability

Do not report security vulnerabilities through a public GitHub issue, a pull
request, or the product feedback thread.

Use GitHub's
[private vulnerability reporting form](https://github.com/jorgepb96/nodus-imago/security/advisories/new).
Include:

- A clear description of the vulnerability and its impact
- The affected Nodus Imago version and operating system
- Reproduction steps or a minimal proof of concept
- Any prerequisites, configuration, or permissions required
- Suggested mitigations, if known

Do not include real credentials, private catalogues, personal data, unpublished
research, or images you are not allowed to share. Use synthetic or public-domain
test data and redact secrets from logs and screenshots.

You should receive an acknowledgement within seven days and an initial
assessment within fourteen days. Timelines for remediation and disclosure depend
on severity, complexity, and release requirements. Please allow maintainers a
reasonable opportunity to investigate and publish a fix before public
disclosure.

## Scope

Security reports may cover the Nodus Imago desktop app, its local IPC and
renderer boundaries, the local HTTP API, update and packaging flows, data
storage and backups, image handling, and requests to AI providers or public
services such as Wikimedia Commons and Wikidata.

General bugs and feature requests belong in the repository's public issue
templates. Product feedback belongs in the permanent
[shared feedback thread](https://github.com/jorgepb96/nodus-imago/issues/1).
