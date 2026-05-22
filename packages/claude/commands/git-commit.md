---
name: git-commit
description: Analyze changes and commit
usage: /git-commit
allowed-tools: Bash(git:*)
---
1. Run `git diff --staged` to see changes
2. Analyze what was changed and why
3. Create a commit message:
   - Format: type(scope): description
   - Types: feat, fix, refactor, docs, test, chore
   - Under 72 chars
   - Body explains WHY if non-obvious
4. Execute the commit
