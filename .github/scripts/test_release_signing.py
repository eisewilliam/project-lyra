"""Exercise release signing and metadata updates without credentials or network calls."""

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest


SCRIPT = Path(__file__).with_name("prepare-macos-signing.sh")
APPLE_SECRETS = {
    "APPLE_CERTIFICATE": "test-certificate",
    "APPLE_CERTIFICATE_PASSWORD": "test-password",
    "APPLE_SIGNING_IDENTITY": "Developer ID Application: Test",
    "APPLE_API_ISSUER": "test-issuer",
    "APPLE_API_KEY": "TESTKEY",
    "APPLE_API_PRIVATE_KEY": "test-private-key",
}


class ReleaseSigningTests(unittest.TestCase):
    def test_release_updates_keep_the_version_tag(self):
        workflow = (SCRIPT.parent.parent / "workflows" / "release.yml").read_text()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = root / "calls.jsonl"
            gh = root / "gh"
            gh.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, sys\n"
                "if '-X' in sys.argv and sys.argv[sys.argv.index('-X') + 1] == 'PATCH':\n"
                "    with open(os.environ['RELEASE_TEST_CALLS'], 'a') as target:\n"
                "        target.write(json.dumps(sys.argv[1:]) + '\\n')\n"
                "else:\n"
                "    print('Existing release notes')\n"
            )
            gh.chmod(0o755)
            env = {
                "PATH": f"{root}{os.pathsep}{os.environ['PATH']}",
                "TAG": "v0.2.0-beta.2",
                "GITHUB_REPOSITORY": "test/lyra",
                "RELEASE_TEST_CALLS": str(calls),
            }
            for name in ("Label the unsigned macOS prerelease", "Publish"):
                with self.subTest(step=name):
                    step = workflow.split(f"            - name: {name}\n", 1)[1]
                    step = step.split("\n            - name: ", 1)[0]
                    script = textwrap.dedent(step.split("              run: |\n", 1)[1])
                    script = script.replace("${{ needs.prepare.outputs.release-id }}", "123")
                    result = subprocess.run(
                        ["bash", "-eu", "-c", script], env=env,
                        capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
            updates = [json.loads(line) for line in calls.read_text().splitlines()]
            self.assertEqual(len(updates), 2)
            for args in updates:
                fields = {
                    args[i + 1].split("=", 1)[0]: args[i + 1].split("=", 1)[1]
                    for i, arg in enumerate(args) if arg in ("-f", "-F")
                }
                self.assertEqual(fields.get("tag_name"), env["TAG"])
            self.assertIn("draft=false", updates[-1])

    def test_unsigned_build_omits_apple_certificate_environment(self):
        # Tauri imports APPLE_CERTIFICATE even when it is present but empty.
        workflow = SCRIPT.parent.parent / "workflows" / "release.yml"
        step = next(
            block for block in workflow.read_text().split("            - name: ")
            if block.startswith("Build unsigned macOS and upload\n")
        )
        env = step.split("              env:\n", 1)[1].split("              with:\n", 1)[0]
        names = set(re.findall(r"^\s+([A-Z_]+):", env, re.MULTILINE))
        self.assertEqual(names, {
            "GITHUB_TOKEN", "TAURI_SIGNING_PRIVATE_KEY",
            "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "APPLE_SIGNING_IDENTITY",
        })
        self.assertIn('APPLE_SIGNING_IDENTITY: "-"', env)

    def prepare(self, tag, secrets):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        env = {"PATH": os.environ["PATH"], "TAG": tag, "RUNNER_TEMP": str(root)}
        for name in ("GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_STEP_SUMMARY"):
            path = root / name
            path.touch()
            env[name] = str(path)
        result = subprocess.run(
            ["bash", str(SCRIPT)], env={**env, **secrets}, capture_output=True, text=True
        )
        self.assertNotIn("test-private-key", result.stdout + result.stderr)
        return root, result

    def test_prerelease_without_apple_secrets_uses_unsigned_build(self):
        root, result = self.prepare("v0.2.0-beta.1", {})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((root / "GITHUB_OUTPUT").read_text(), "unsigned=true\n")
        self.assertEqual((root / "GITHUB_ENV").read_text(), "")
        self.assertIn("no notarization", (root / "GITHUB_STEP_SUMMARY").read_text())
        self.assertEqual(list(root.glob("*.p8")), [])

    def test_stable_release_without_apple_secrets_fails(self):
        root, result = self.prepare("v0.2.0", {})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("::error::", result.stdout)
        self.assertEqual((root / "GITHUB_OUTPUT").read_text(), "")

    def test_partial_apple_configuration_never_falls_back(self):
        for missing in APPLE_SECRETS:
            with self.subTest(missing=missing):
                secrets = {k: v for k, v in APPLE_SECRETS.items() if k != missing}
                root, result = self.prepare("v0.2.0-beta.1", secrets)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(missing, result.stdout)
                self.assertEqual((root / "GITHUB_OUTPUT").read_text(), "")
                self.assertEqual(list(root.glob("*.p8")), [])

    def test_complete_configuration_signs_both_stable_and_prerelease(self):
        for tag in ("v0.2.0", "v0.2.0-beta.1"):
            with self.subTest(tag=tag):
                root, result = self.prepare(tag, APPLE_SECRETS)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((root / "GITHUB_OUTPUT").read_text(), "unsigned=false\n")
                key = root / "AuthKey_TESTKEY.p8"
                self.assertEqual(key.read_text(), "test-private-key\n")
                self.assertEqual(key.stat().st_mode & 0o777, 0o600)
                self.assertEqual(
                    (root / "GITHUB_ENV").read_text(), f"APPLE_API_KEY_PATH={key}\n"
                )


if __name__ == "__main__":
    unittest.main()
