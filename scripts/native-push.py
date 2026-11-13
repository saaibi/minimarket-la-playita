"""Generate a monochrome Android status icon; no service credentials in resources."""
from pathlib import Path
root=Path('apps/web/android/app/src/main/res/drawable');root.mkdir(parents=True,exist_ok=True)
(root/'ic_stat_playita.xml').write_text('''<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FFFFFFFF" android:pathData="M2,12 L12,2 L22,12 L19,12 L19,22 L5,22 L5,12 Z M9,14 L9,19 L11,19 L11,14 Z M13,14 L13,19 L15,19 L15,14 Z"/></vector>''')
