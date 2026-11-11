#!/bin/sh
# Run from repository root. Requires the locally installed SDK and JDK 21.
set -eu
export ANDROID_HOME="$PWD/.runtime/android-sdk"
export ANDROID_USER_HOME="$PWD/.runtime/android-user"
export GRADLE_USER_HOME="$PWD/.runtime/gradle"
mkdir -p "$ANDROID_USER_HOME" "$GRADLE_USER_HOME"
npm run build
if [ ! -d apps/web/android ]; then
  npm run cap:android -w @playita/web
fi
npm run cap:sync -w @playita/web -- android
"$PWD/.runtime/brand-venv/bin/python" scripts/native-brand.py
python3 scripts/native-google.py
# Standard generated debug signing only. No release/distribution keystore.
python3 - <<'PY'
from pathlib import Path
import os, re
version = os.environ.get("PLAYITA_ANDROID_VERSION_NAME", "0.1.0-debug")
code = os.environ.get("PLAYITA_ANDROID_VERSION_CODE", "1")
if not re.fullmatch(r"[0-9A-Za-z.\-]+", version) or not code.isdigit() or int(code) < 1:
    raise SystemExit("Invalid Android version")
p = Path('apps/web/android/app/build.gradle')
s = re.sub(r'versionName "[^"\n]+"', f'versionName "{version}"', p.read_text())
s = re.sub(r"versionCode \d+", f"versionCode {code}", s)
p.write_text(s)
PY
apps/web/android/gradlew -p apps/web/android assembleDebug --no-daemon --no-watch-fs --console=plain
