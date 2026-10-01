---
name: git-release
description: "Prepare and execute Git commits, select release versions, create or publish annotated tags, and maintain changelogs and release notes. Use for commit messages, commit splitting or rewriting, tag validation or audits, and coordinated releases."
---

# Git Release

## Responsibility

Route commit, tag, changelog, and combined release requests to the smallest applicable reference. Keep their ordering and shared confirmation rules consistent without duplicating task-specific commands here.

This skill does not replace repository-specific release policies or expand a request from a local commit into a formal release.

## Task routing

| Task | Read | Scope |
| --- | --- | --- |
| Draft, review, split, execute, amend, or rewrite a commit | `references/commit.md` | Message preparation, staging, commit execution, and verification |
| Choose, create, push, validate, or audit a tag | `references/tag.md` | Tag planning or the requested tag phase only |
| Create, update, organize, or validate `CHANGELOG.md` or release notes | `references/changelog.md` | Changelog content only; read `references/keep-a-changelog-1.1.0.md` when detailed standard semantics are needed |
| Coordinate a formal release | `references/tag.md` and `references/changelog.md`; add `references/commit.md` only when commit work is required | Changelog, release commit if needed, target commit, tag, and requested publication |

Read only the references required by the request. A known tag creation or push does not require version-selection analysis unless the candidate version or release baseline is still undecided.

- Use previously read instructions while they remain current and available in context; re-read when the files, applicable rules, or available context change.
- A confirmation continues the prepared operation. Use its reference's execution and verification rules; additional skills apply according to their responsibilities.

## Combined release order

For a request that includes changelog, commit, and tag work:

1. Confirm repository state, release scope, and the intended release commit.
2. Use `references/tag.md` to determine the previous release baseline and candidate version when either is undecided.
3. Use `references/changelog.md` to validate or prepare the candidate version entry.
4. Complete any confirmed changelog or commit operation before tagging.
5. Reconfirm the target commit if `HEAD`, staged release content, or commit history changed.
6. Create and validate the local tag, then handle remote publication only when requested.

## Shared constraints

1. Inspect the actual relevant content before proposing a commit message, changelog entry, version, or state-changing command.
2. Show each state-changing command exactly and wait for explicit confirmation. A later request to execute that exact command is sufficient confirmation.
3. Do not silently stage, unstage, commit, amend, rewrite history, create or alter tags, or push refs.
4. Prefer single quotes for literal user-authored shell arguments unless shell expansion is intentional.
5. Report only evidence required by the completed task. For commits, include the resulting hash and message, included files, remaining working-tree status, and verification result. For tags and releases, include the version basis when selected, target commit, local or remote status as applicable, and anything explicitly left unhandled.
