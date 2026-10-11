fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        mediaremote::build_framework();
    }
    tauri_build::build()
}

/// Builds the vendored MediaRemote adapter framework before `tauri_build`
/// copies it next to the executable (`tauri.macos.conf.json` lists it under
/// `bundle.macOS.frameworks`). Compiled with clang directly so contributors
/// do not need CMake.
mod mediaremote {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const SOURCE_DIR: &str = "../../../native/macos-sidecar/mediaremote-adapter";
    /// Must match the path in `tauri.macos.conf.json`.
    const OUTPUT_DIR: &str = "native-build/MediaRemoteAdapter.framework";
    const NAME: &str = "MediaRemoteAdapter";

    const SOURCES: &[&str] = &[
        "src/adapter/env.m",
        "src/adapter/get.m",
        "src/adapter/globals.m",
        "src/adapter/keys.m",
        "src/adapter/now_playing.m",
        "src/adapter/repeat.m",
        "src/adapter/seek.m",
        "src/adapter/send.m",
        "src/adapter/shuffle.m",
        "src/adapter/speed.m",
        "src/adapter/stream.m",
        "src/private/MediaRemote.m",
        "src/utility/Debounce.m",
        "src/utility/helpers.m",
    ];

    pub fn build_framework() {
        let source = Path::new(SOURCE_DIR);
        println!("cargo:rerun-if-changed={SOURCE_DIR}/src");
        println!("cargo:rerun-if-changed={SOURCE_DIR}/include");

        let framework = PathBuf::from(OUTPUT_DIR);
        let _ = fs::remove_dir_all(&framework);
        let version_dir = framework.join("Versions/A");
        fs::create_dir_all(version_dir.join("Resources")).expect("create framework directories");

        // /usr/bin/perl runs arm64e on Apple Silicon and x86_64 on Intel (and
        // under Rosetta), so the framework is always universal.
        let status = Command::new("xcrun")
            .args(["clang", "-dynamiclib", "-fobjc-arc", "-fvisibility=default"])
            .args([
                "-arch",
                "arm64",
                "-arch",
                "x86_64",
                "-mmacosx-version-min=11.0",
            ])
            .arg("-I")
            .arg(source.join("include"))
            .arg("-I")
            .arg(source.join("src"))
            .args(SOURCES.iter().map(|s| source.join(s)))
            .args(["-framework", "Foundation", "-framework", "AppKit"])
            .args(["-framework", "UniformTypeIdentifiers"])
            .args(["-install_name", &format!("@rpath/{NAME}.framework/{NAME}")])
            .arg("-o")
            .arg(version_dir.join(NAME))
            .status()
            .expect("run xcrun clang for the MediaRemote adapter");
        assert!(status.success(), "building the MediaRemote adapter failed");

        fs::write(version_dir.join("Resources/Info.plist"), info_plist())
            .expect("write framework Info.plist");
        symlink("A", framework.join("Versions/Current"));
        symlink(&format!("Versions/Current/{NAME}"), framework.join(NAME));
        symlink("Versions/Current/Resources", framework.join("Resources"));

        // Ad-hoc signature for development; release bundling re-signs it
        // with the app's identity.
        let status = Command::new("codesign")
            .args(["--force", "--sign", "-"])
            .arg(&framework)
            .status()
            .expect("run codesign for the MediaRemote adapter");
        assert!(status.success(), "signing the MediaRemote adapter failed");
    }

    fn symlink(target: &str, link: PathBuf) {
        std::os::unix::fs::symlink(target, &link)
            .unwrap_or_else(|e| panic!("symlink {}: {e}", link.display()));
    }

    fn info_plist() -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>{NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>app.lyralyrics.desktop.{NAME}</string>
  <key>CFBundleName</key>
  <string>{NAME}</string>
  <key>CFBundlePackageType</key>
  <string>FMWK</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
</dict>
</plist>
"#
        )
    }
}
