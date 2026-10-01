# Git Tag

## Tag contract

- Every new formal release tag is annotated and uses `v<major>.<minor>.<patch>` with an optional SemVer pre-release suffix.
- Historical tags with other names remain valid release evidence but do not define the naming scheme for a new formal release.
- Pre-release tags append a SemVer suffix such as `-rc.1` or `-beta.1`. Use `+metadata` only when the repository already does so.
- Local creation, local validation, remote push, and remote validation are separate phases.
- Use signed tags instead of ordinary annotated tags when the repository requires signing.

## Select checks by task

### Choose a version

Resolve the target, identify the release baseline, inspect the release range, determine the SemVer increment, and check the changelog using the sections below.

### Create a known local tag

When the tag name and target commit are already decided:

1. Confirm that the name satisfies the tag contract.
2. Resolve the target commit and report the working-tree state.
3. Confirm that the local tag name is unused.
4. Create and validate the annotated tag after explicit confirmation.

Do not inspect historical tags, calculate a version increment, or analyze the release range unless the supplied name or target is disputed.

### Push a known tag

When a validated local tag already exists:

1. Confirm its target and annotation.
2. Confirm that the configured remote does not contain the same tag.
3. Push only that tag after separate explicit confirmation.
4. Verify the remote ref.

Do not repeat version selection or local creation checks that already have current evidence.

### Validate or audit a tag

Inspect only the requested local or remote facts: tag type, message, target commit, naming compliance, or remote presence. Audit tasks do not modify refs.

## Version selection

Run this section only when the release baseline or candidate version is undecided.

Resolve the target under **Target commit**, then use `git describe` for the first baseline candidate:

```bash
git describe --tags --abbrev=0 '<commit>'
```

The baseline must be a formal release tag that is an ancestor of the target commit on the intended release line. Historical tags without a `v` prefix may serve as baselines. If the release line is unclear, inspect the branch and recent history as needed:

```bash
git branch --show-current
git log --oneline --decorate -n 15 '<commit>'
```

When multiple release lines, pre-release tags, or non-version tags leave the baseline unclear, compare bounded chronological or version-ordered candidates:

```bash
git for-each-ref --count=20 --sort=-creatordate --format='%(refname:strip=2)' refs/tags
git tag --sort=-version:refname | head -n 20
```

Verify an alternative candidate's ancestry:

```bash
git merge-base --is-ancestor '<last-tag>' '<commit>'
```

If no valid baseline is an ancestor of the target commit, request the intended release line or baseline. If no local tags exist and remote publication is part of the task, inspect the configured remote for release tags.

After fixing the baseline, inspect the release range:

```bash
git log --oneline '<last-tag>'..'<commit>'
git diff --stat '<last-tag>'..'<commit>'
```

Read targeted diffs when commit messages and statistics do not establish compatibility. Select the increment from actual changes:

1. `PATCH` for backward-compatible fixes.
2. `MINOR` for backward-compatible features.
3. `MAJOR` for incompatible interface, behavior, configuration, or data-contract changes.

State the baseline, material changes, compatibility assessment, and candidate tag. When historical naming differs from the tag contract, preserve those tags and inspect dependent CI, release scripts, artifact names, comparison links, or rollback commands only when the naming difference can affect the current release.

## Release gates

### Changelog

For a version-selection or formal-release task, check whether `CHANGELOG.md` exists and whether it contains the candidate version entry. Read `references/changelog.md` for content and formatting rules.

If the file exists but the entry is missing, stop before tag creation. Prepare a separate changelog change and commit only when requested and confirmed. Continue without an entry only when omission is explicitly allowed and recorded.

### Target commit

Resolve the exact target and inspect the working-tree state once for version selection or tag creation:

```bash
git status --short
git rev-parse --verify '<commit>^{commit}'
```

Use these results across phases while current. For a formal release, confirm the intended release line and report uncommitted changes; prefer a validated commit with a clean working tree.

Repeat affected checks after working-tree changes, a changelog commit, amend, rebase, or another operation that changes the target, or when freshness is uncertain.

## Execute the requested phase

Use the configured remote name in actual commands; examples below use `origin`.

### Create and validate locally

Confirm that the local name is unused:

```bash
git show-ref --verify --quiet 'refs/tags/<tag>'
```

Exit status 1 means the tag is absent. Report other query errors before creation.

Create an annotated tag after explicit confirmation:

```bash
git tag -a '<tag>' '<commit>' -m 'release <tag>'
```

When the target is the current `HEAD`, the explicit commit argument may be omitted. When signing is required, use `git tag -s` instead of `git tag -a`.

Validate the local result:

```bash
git cat-file -t 'refs/tags/<tag>'
git rev-parse '<tag>^{}'
git show '<tag>' --no-patch
```

The object type must be `tag`. The peeled commit, displayed target, and message must match the prepared values.

### Push and validate remotely

When publication or remote baseline discovery requires an unknown remote, inspect its configuration:

```bash
git remote -v
```

Before push, check the exact remote ref:

```bash
git ls-remote --exit-code --tags origin 'refs/tags/<tag>' 'refs/tags/<tag>^{}'
```

An absent result is expected. Report authentication, connectivity, and other query errors before pushing.

Push only the confirmed tag:

```bash
git push origin '<tag>'
```

Then verify the remote tag object and peeled commit:

```bash
git ls-remote --exit-code --tags origin 'refs/tags/<tag>' 'refs/tags/<tag>^{}'
```

The peeled remote hash must equal the locally validated commit.

A local-only request stops after local validation. Do not use `git push origin --tags` unless bulk synchronization is explicitly requested.

## Ref changes and exclusions

Apply the shared confirmation rule separately to local tag creation and remote push. Deleting, force-moving, or remotely deleting a tag requires its own explicit request, impact explanation, exact command, and confirmation.

Do not delete or repoint published tags, or backfill historical tags in bulk, as part of an ordinary create, push, or audit request.
