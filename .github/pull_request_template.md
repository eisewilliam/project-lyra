## Summary

<!-- What does this PR change and why? -->

## Related issue

<!-- e.g. Closes #123 -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / internal change
- [ ] Documentation
- [ ] Build / CI

## Checklist

- [ ] Business logic stays in `lyra-core`; the bridge only delegates and the UI only renders
- [ ] `cargo test -p lyra-core` passes
- [ ] `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets -- -D warnings` pass
- [ ] `npm run lint` passes (in `apps/desktop-tauri`)
- [ ] Tests added/updated for changed `lyra-core` behavior
- [ ] No lyric content is bundled with the app

## Notes for reviewers

<!-- Anything reviewers should focus on, screenshots for UI changes, etc. -->
