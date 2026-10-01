# Keep a Changelog 1.1.0 Reference Summary

Source: `https://keepachangelog.com/zh-CN/1.1.0/`

A changelog is a human-readable project history that summarizes important changes alongside releases and semantic versioning. See `changelog.md` for task steps, entry constraints, output rules, and validation.

## Recommended skeleton

```markdown
# Changelog

## [Unreleased]

## [1.0.0] - 2026-04-28

### Added
- First stable release.

[Unreleased]: https://example.com/compare/v1.0.0...HEAD
[1.0.0]: https://example.com/releases/tag/v1.0.0
```

## Category semantics

| Category | Meaning |
| --- | --- |
| Added | New capabilities, entry points, configuration, commands, interfaces, or platform support. |
| Changed | Changes to existing behavior, defaults, experience, or performance. |
| Deprecated | Capabilities still usable now but announced for future removal. |
| Removed | Capabilities removed in this release. |
| Fixed | Corrections to faulty behavior, compatibility issues, crashes, or exceptional cases. |
| Security | Vulnerability fixes, permission changes, or security-related defaults. |

## Link strategy

Keep a Changelog recommends maintaining links at the end of the file:

- `Unreleased` points to the comparison page from the previous release version to `HEAD`
- Released versions can point to a release page, or to comparison pages between adjacent versions

If the repository has no usable release or comparison URL, links may be omitted with an explanation.

## Special cases

### Yanked releases

`YANKED` may be added to the version heading, together with the reason.

### Deprecation flow

Deprecation should appear early under `Deprecated`, instead of being recorded for the first time only after removal.

### GitHub Releases

GitHub Releases provides release pages alongside the repository's `CHANGELOG.md`.
