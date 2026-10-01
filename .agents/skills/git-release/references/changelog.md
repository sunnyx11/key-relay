# Changelog

## Goal

Maintain `CHANGELOG.md` as a user-facing project history consistent with Keep a Changelog 1.1.0 and semantic versioning. Use `keep-a-changelog-1.1.0.md` for the standard skeleton, category semantics, link strategy, and special cases.

## Evidence

Read the existing `CHANGELOG.md` first. Use locally available version tags, release notes, pull request descriptions, release-range diffs, issues, and fix descriptions as evidence. Do not fetch remote sources unless the request requires them.

Evidence supports the entry but is not copied verbatim. Do not invent missing history.

## Select the task

### Create a changelog

Create the standard heading and `Unreleased` section. Backfill only recent releases supported by evidence; older history is a separate scope, and any missing range must be stated.

### Update unreleased content

Add completed user-visible changes under `Unreleased`, merge duplicate wording, and omit internal changes with no user-facing effect.

### Prepare a release entry

Move completed content into `## [x.y.z] - YYYY-MM-DD`, retain an empty `Unreleased` section at the top, and update comparison links. Keep changelog editing, committing, and tagging as separate confirmed operations.

### Organize an existing changelog

Normalize heading levels, version notation, dates, categories, links, empty sections, and duplicate entries. Preserve a small established project-specific extension only when the repository already depends on it.

## Write entries

- Select one standard category according to `keep-a-changelog-1.1.0.md`; use the user-visible impact when more than one category appears applicable.
- Write each change as one self-contained, single-line Markdown list item with no more than 80 characters after `- `, including spaces, punctuation, and Markdown syntax.
- State one user-visible change per entry: the affected behavior, any necessary condition, and the outcome.
- Include compatibility, migration, deprecation, removal, or security information in the same entry when applicable. Summarize any required user action within the 80-character limit.
- Do not use links, continuation lines, sublists, or explanatory notes within an entry.
- Omit rationales, implementation details, commit hashes, branch names, category labels, and internal refactors with no user-visible effect. Include filenames only when needed for a user action; omit implementation file lists.
- Distill related commits into one entry and remove duplicate or synonymous wording. Split entries only for independent user-visible outcomes.

Examples:

```markdown
### Fixed
- Preserve sessions when background token renewal fails.

### Changed
- Replace `apiUrl` with `baseUrl` in `app.yml` before upgrading.
```

## Output contract

1. Use `# Changelog` as the top heading.
2. Keep exactly one `## [Unreleased]` section before all released versions.
3. Use reverse chronological order and `## [version] - YYYY-MM-DD` for releases.
4. Keep only non-empty standard category sections.
5. Maintain version or comparison links. State why links are absent when the repository provides no usable source.
6. A changelog version may omit the Git tag's `v` prefix, such as `[1.2.3]` for `v1.2.3`; preserve another established repository convention only when required.

## Validation

Before completion, check:

- structure, dates, categories, and links against **Output contract**
- each entry against **Write entries**, including necessary compatibility and migration information
- evidence for every historical entry and applicable repository conventions
