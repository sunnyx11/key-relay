# Git Commit

## Goal

Produce a commit message that is accurate, concise, and strictly follows the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification, regardless of the repository's existing commit style.

When an edge case or detail is not explicitly covered in this reference, consult the official spec at <https://www.conventionalcommits.org/en/v1.0.0/> as the authoritative source.

Conventional Commits aligns with Semantic Versioning (SemVer):

- `fix` type → **PATCH** version bump
- `feat` type → **MINOR** version bump
- `BREAKING CHANGE` (any type with `!` or footer) → **MAJOR** version bump
- Other types (`docs`, `refactor`, `test`, etc.) have no implicit SemVer effect unless they include a breaking change.

## Workflow

### 1. Inspect the repository before writing

Use this preparation sequence once for the intended commit:

1. Run `git status --short` to identify staged, unstaged, and untracked files; use this file list without an extra `--name-status` or empty-index check.
2. Read the intended content with `git diff --cached -- <paths>` for staged changes and `git diff -- <paths>` for unstaged changes. Read both when staging will include both. Use `--stat` first only for a large or unclear scope.
3. When the language is unspecified, inspect up to 10 recent non-merge subjects with `git log -10 --no-merges --pretty=format:'%s'`. Use all available subjects when there are fewer than 10.
4. Check the reviewed content with scoped `git diff --check` or `git diff --cached --check`.
5. When commands are requested, prepare exact staging and commit commands. Retain the scope, reviewed content, checks, language evidence, and commands in context for reuse; present language evidence only as required by the output contract.

Apply the recheck conditions below to existing evidence. Read untracked files only when considering their inclusion or clarifying their purpose; a staged-only request needs only their names reported.

For diffs exceeding roughly 500 changed lines, use targeted diffs and summarize binary or submodule changes appropriately. Cover the intended scope and establish its semantic intent before composing a message.

### 2. Decide whether this should be one commit

If the changes mix multiple intents, recommend splitting them before writing the message.

Typical split signals:

- feature + refactor
- bug fix + unrelated formatting
- dependency/build changes mixed with product behavior changes
- docs updates that explain a different change than the code being committed
- breaking changes mixed with non-breaking work (breaking changes usually deserve their own commit)

If the user insists on one commit, describe the dominant intent and briefly mention the compromise.

### 3. Map the change to a type

Choose the smallest accurate type. Prefer these common Conventional Commit types:

| Type | Use when | Avoid when |
| --- | --- | --- |
| `feat` | adds a user-visible capability | it only fixes broken behavior |
| `fix` | corrects a bug or wrong behavior | it adds a new capability |
| `docs` | changes documentation only | code behavior changed too |
| `refactor` | restructures code without behavior change | behavior changed or perf is the main point |
| `perf` | improves performance | change is mainly cleanup |
| `test` | adds or updates tests only | product code changed materially |
| `build` | changes build system, dependencies, packaging, toolchain | CI workflow only |
| `ci` | changes CI/CD workflows or automation pipelines | local build tooling only |
| `chore` | maintenance work that fits none of the above | feature, bug fix, or refactor is the real story |
| `style` | formatting-only changes with no logic impact | any functional change exists |
| `revert` | reverts an earlier change | it is a forward fix instead |

**Disambiguation notes:**

- **`build` vs `ci`:** If the file is consumed by a CI platform (GitHub Actions, GitLab CI, Jenkins pipeline), use `ci`. If it configures local build tooling (Makefile, bundler config, package manager lockfile), use `build`. In monorepos where the same file serves both, prefer `build` unless the change is CI-specific logic (retry, caching, matrix).
- **`chore` examples:** dependency version bumps with no behavior change, `.gitignore` updates, editor config, license file changes, release version tags.
- **`style`:** Typical examples include formatter/linter auto-fix runs (Prettier, ESLint `--fix`, Black), whitespace normalization, and import sorting with no logic change.

**`revert` guidance:** When reverting a previous commit, rewrite the auto-generated `git revert` message into Conventional Commits format: `revert: <original subject>`. Include the reverted commit hash in the body or footer (e.g., `Reverts: <hash>`). If the revert itself introduces a breaking change, mark it with `!` or `BREAKING CHANGE`.

Non-standard types are acceptable only when the user explicitly requests them.

### 4. Choose a scope only when it adds signal

Use an optional short noun for a logical area, such as `api`, `auth`, or `parser`. Omit the scope when it would be vague, a raw filename, or too broad for the changes.

### 5. Detect breaking changes

Mark a commit as breaking when it introduces incompatible behavior, such as:

- API or schema changes
- CLI argument or command changes
- config key/default behavior changes
- removed support for older platforms or runtimes
- data contract changes that force downstream updates

Use either of these forms:

```text
<type>(<scope>)!: <description>
```

or

```text
BREAKING CHANGE: <what is incompatible now>
```

If using `!`, make the incompatibility obvious in the description or body. Keep `BREAKING CHANGE` uppercase. `BREAKING-CHANGE` (hyphenated) is treated as synonymous with `BREAKING CHANGE` per the spec.

### 6. Compose the message

Use this structure:

```text
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

Rules:

- always keep `type` lowercase (the spec is case-insensitive except for `BREAKING CHANGE`, but we enforce lowercase for consistency)
- use `: ` exactly after the prefix
- keep the description short, specific, and effect-oriented
- treat the description line as the commit subject
- target 50 display columns for the subject, with a hard limit of 72; count each CJK character as 2 columns and other characters as 1
- do not end the description with a period
- use imperative mood in the subject, for example `fix`, `add`, or `remove`, not `fixed`, `added`, or `removed`
- use the body for why, context, tradeoffs, or notable implementation details
- the body is free-form and may contain multiple paragraphs separated by blank lines
- leave exactly one blank line between the subject and the body
- wrap each body line to 72 characters or fewer
- separate body and footers with a blank line
- use trailer-style footers when relevant; footers may use either `:<space>` or `<space>#` as separator (e.g., both `Refs: #123` and `Refs #123` are valid). Examples:
  - `Refs: #123`
  - `Closes #456`
  - `Reviewed-by: Name`
  - `Co-authored-by: Name <email@example.com>`
  - `BREAKING CHANGE: <what is incompatible now>`
- footer tokens that contain spaces must use `-` as separator (e.g., `Acked-by`, `Reviewed-by`); the only exception is `BREAKING CHANGE` which may use a space or hyphen
- if a tool is needed to measure subject width, finalize all candidates first and measure them together in one call

Keep `type`, `scope`, and footer tokens in English.

#### Choose the message language

Choose the language for the description and body in this order:

1. Use the language explicitly requested by the user.
2. Otherwise classify the subjects collected during repository inspection by the prose after the Conventional Commit prefix.
3. Ignore `type`, `scope`, code identifiers, filenames, paths, issue numbers, version numbers, and product names when classifying a subject.
4. If every classifiable subject is English, write one English message.
5. If every classifiable subject is Simplified Chinese, write one Simplified Chinese message.
6. If the subjects include both languages, or one subject contains prose in both languages, provide equivalent English and Simplified Chinese messages and ask the user to choose.
7. If there are no classifiable subjects, use English.

## Commit execution and verification

### Recheck conditions

Reuse reviewed content, successful checks, language history, and subject measurements while they remain current. A confirmation reply alone does not invalidate them.

- Re-read affected diffs after content edits, unexpected staging changes, relevant history changes, or uncertainty about freshness. Matching filenames or statistics establish scope, not unchanged content.
- Read `git diff --cached` after directory or glob staging, or when staged content has not been reviewed. Run `git diff --cached --check` if the final content lacks a successful check.
- Refresh language history only when relevant history changes and language is still unspecified; remeasure only revised subjects.
- Stop on a scope mismatch. Changes to the prepared scope or message require updated commands and confirmation.

### Execute confirmed commands

After confirmation of the displayed commands, including a mapped `A` or `B` reply:

1. Run `git status --short` and resolve unexpected changes under the recheck conditions before staging.
2. Execute the confirmed staging command, if needed.
3. Run `git diff --cached --stat` to compare the entire staged file set with the prepared scope. Apply the recheck conditions before proceeding.
4. Execute the selected commit command and verify the result below.

### Verify the result

- A zero exit status and the normal `git commit` stdout are the primary evidence that the commit succeeded. Reuse that output for the resulting hash, subject, file summary, and hook results.
- If the commit exits with a nonzero status, report the failure and run `git status --short`; do not inspect the existing HEAD as evidence of a new commit.
- After a successful standard commit or amend, run `git status --short` to report remaining staged, unstaged, or untracked files.
- Run `git log -1 --oneline` only when successful commit stdout is unavailable or ambiguous, or when an amend requires independent confirmation of the new HEAD.
- After a successful commit, run `git show --stat` or `git show` only when a hook reports changes that may have entered the commit, the commit summary differs from the prepared scope, or the user requests an independent audit of final commit content.
- Do not run both `git log` and `git show` after an ordinary successful commit.

## Output contract

1. If the changes should be split, present a numbered split proposal first, followed by a combined fallback only when useful.
2. If no split is needed and language selection produces one language, provide one recommended commit message. Include language-detection narration, subject counts, and language-selection rationale only for mixed-language history with no explicit language choice (rules 6–8); otherwise omit them from progress updates and final output.
3. If classification is ambiguous for reasons other than language history, provide up to two alternatives with a one-line rationale for each.
4. When showing both staging and commit commands, place `git add` and `git commit` in separate fenced `bash` blocks.
5. Wrap literal commit messages passed through shell arguments in single quotes unless shell expansion is intentional.
6. For mixed-language history with no explicit language choice, state the Chinese and English subject counts and provide equivalent messages as candidate `A` (Simplified Chinese) and `B` (English). Recommend the language used by more classifiable recent subjects; if counts tie, recommend the language of the most recent classifiable subject. Mark the recommended candidate and briefly explain why.
7. In that mixed-language case, when commands are requested, state that they have not been executed, show one shared staging command and two alternative commit commands in separate `bash` blocks, and report relevant verification results and unrelated working-tree changes. End with a short choice prompt: `Reply A for Simplified Chinese or B for English`. State that the reply authorizes the displayed staging command and only the selected commit command. Wait for that reply before executing either command.
8. In that mixed-language case, when only messages are requested, show the two labeled messages and the recommendation without staging or commit commands.
