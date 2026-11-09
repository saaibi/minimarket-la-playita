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
# Standard generated debug signing only. No release/distribution keystore.
python3 - <<'PY'
from pathlib import Path
p = Path('apps/web/android/app/build.gradle')
s = p.read_text().replace('versionName "1.0"', 'versionName "0.1.0-debug"')
p.write_text(s)
PY
apps/web/android/gradlew -p apps/web/android assembleDebug --no-daemon --no-watch-fs --console=plain
