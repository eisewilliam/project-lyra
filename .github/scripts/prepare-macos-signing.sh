#!/usr/bin/env bash
set -euo pipefail

# Prereleases may use ad-hoc signing only when no Apple credentials are set.
# A partially configured account must not silently fall back to unsigned builds.
names=(APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY
    APPLE_API_ISSUER APPLE_API_KEY APPLE_API_PRIVATE_KEY)
present=0
missing=""
for name in "${names[@]}"; do
    if [ -n "${!name:-}" ]; then
        present=$((present + 1))
    else
        missing="$missing $name"
    fi
done

if [ "$present" -eq "${#names[@]}" ]; then
    echo "unsigned=false" >> "$GITHUB_OUTPUT"
    umask 077
    key_path="$RUNNER_TEMP/AuthKey_$APPLE_API_KEY.p8"
    printf '%s\n' "$APPLE_API_PRIVATE_KEY" > "$key_path"
    echo "APPLE_API_KEY_PATH=$key_path" >> "$GITHUB_ENV"
elif [ "$present" -eq 0 ] && [[ "$TAG" == *-* ]]; then
    echo "unsigned=true" >> "$GITHUB_OUTPUT"
    echo "::notice::Building an unsigned macOS prerelease without Apple signing or notarization."
    echo "macOS: unsigned internal build (ad-hoc signature, no notarization)." >> "$GITHUB_STEP_SUMMARY"
else
    echo "::error::Missing Apple signing secrets:$missing. Unsigned macOS builds require a prerelease tag and no Apple secrets. See docs/RELEASING.md."
    exit 1
fi
