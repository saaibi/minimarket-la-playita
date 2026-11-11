"""Install the tracked Credential Manager bridge into generated Android sources."""
from pathlib import Path
root = Path('apps/web/android')
if root.exists():
    dest = root / 'app/src/main/java/co/laplayita/minimarket'
    dest.mkdir(parents=True, exist_ok=True)
    (dest / 'GoogleSignInPlugin.java').write_text(Path('apps/web/native/android/GoogleSignInPlugin.java').read_text())
    (dest / 'MainActivity.java').write_text('''package co.laplayita.minimarket;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle savedInstanceState) {
    registerPlugin(GoogleSignInPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
''')
    gradle = root / 'app/build.gradle'
    s = gradle.read_text()
    if '// Playita Google Credential Manager' not in s:
        s += '''\n// Playita Google Credential Manager — stable dependencies, no Firebase or paid service.
dependencies {
  implementation "androidx.credentials:credentials:1.6.0"
  implementation "androidx.credentials:credentials-play-services-auth:1.6.0"
  implementation "com.google.android.libraries.identity.googleid:googleid:1.1.1"
}
'''
        gradle.write_text(s)
