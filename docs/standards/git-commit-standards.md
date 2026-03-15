# Git Commit Standards

## Commit Message Format
Each commit message consists of a **header**, a **body**, and a **footer**. The header has a special format that includes a **type**, a **scope**, and a **subject**:

```
<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>
```

The **header** is mandatory and the **scope** of the header is optional.

### Type
Must be one of the following:

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **perf**: A code change that improves performance
- **test**: Adding missing tests or correcting existing tests
- **build**: Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm)
- **ci**: Changes to our CI configuration files and scripts (example scopes: Travis, Circle, BrowserStack, SauceLabs)
- **chore**: Other changes that don't modify src or test files
- **revert**: Reverts a previous commit

### Scope
The scope should be the name of the npm package affected (as perceived by the person reading the changelog generated from commit messages).

### Subject
The subject contains a succinct description of the change:

- use the imperative, present tense: "change" not "changed" nor "changes"
- don't capitalize the first letter
- no dot (.) at the end

### Body
Just as in the **subject**, use the imperative, present tense: "change" not "changed" nor "changes". The body should include the motivation for the change and contrast this with previous behavior.

### Footer
The footer should contain any information about **Breaking Changes** and is also the place to reference GitHub issues that this commit **Closes**.

## Pre-Commit Checklist

Before finalizing a commit, verify the following:

1.  **Review Staged Files**:
    - Run `git status` to ensure only intended files are staged.
    - Run `git diff --staged` to review the exact changes being committed.

2.  **Clean Up Debug Code**:
    - Remove temporary `console.log`, `debugger` statements, or commented-out code blocks used for testing.
    - Ensure no hardcoded secrets or sensitive data are included.

3.  **Exclude Unwanted Files**:
    - Ensure build artifacts (e.g., `dist/`, `release/`), dependency folders (`node_modules/`), and system files (`.DS_Store`) are excluded.
    - Use `.gitignore` to prevent accidental tracking of these files. Do not use `git add .` blindly if untracked files exist.

4.  **Verify Tests**:
    - Ensure all relevant tests pass locally before committing.

## Example

```
feat(auth): add login functionality

Implement user login using JWT tokens.
- Add login API endpoint
- Create login form component
- Handle token storage in localStorage

Closes #123
```
