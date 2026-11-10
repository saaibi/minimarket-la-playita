"""Deterministic native assets from the owner-approved logo. No image generation."""
from pathlib import Path
from PIL import Image, ImageDraw
import json
root=Path(__file__).resolve().parents[1]
logo=Image.open(root/'apps/web/public/assets/marca.png').convert('RGBA')
bg=(255,250,244,255)
def tile(size,ratio=.84,transparent=False,round_icon=False):
    image=Image.new('RGBA',(size,size),(0,0,0,0) if transparent else bg)
    mark=logo.copy();mark.thumbnail((round(size*ratio),round(size*ratio)),Image.Resampling.LANCZOS)
    image.alpha_composite(mark,((size-mark.width)//2,(size-mark.height)//2))
    if round_icon:
        mask=Image.new('L',(size,size));ImageDraw.Draw(mask).ellipse((0,0,size-1,size-1),fill=255);image.putalpha(mask)
    return image
res=root/'apps/web/android/app/src/main/res'
if res.exists():
    for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
        d=res/f'mipmap-{density}';d.mkdir(parents=True,exist_ok=True)
        tile(size).save(d/'ic_launcher.png');tile(size,round_icon=True).save(d/'ic_launcher_round.png')
        tile(round(size*108/48),.60,True).save(d/'ic_launcher_foreground.png')
    d=res/'mipmap-anydpi-v26';d.mkdir(exist_ok=True)
    adaptive='<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/playita_icon_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>'
    for name in ['ic_launcher.xml','ic_launcher_round.xml']:(d/name).write_text(adaptive)
    colors=res/'values/playita_brand.xml';colors.write_text('<resources><color name="playita_icon_background">#FFFAF4</color></resources>')
    drawable=res/'drawable';drawable.mkdir(exist_ok=True)
    tile(512,.62).save(drawable/'playita_splash_logo.png')
    for path in list(res.glob('drawable*/splash.png')):
        with Image.open(path) as old:size=old.size
        splash=Image.new('RGBA',size,bg);mark=logo.copy();mark.thumbnail((round(min(size)*.50),round(min(size)*.50)),Image.Resampling.LANCZOS);splash.alpha_composite(mark,((size[0]-mark.width)//2,(size[1]-mark.height)//2));splash.convert('RGB').save(path)
    styles=res/'values/styles.xml';text=styles.read_text();start=text.index('<style name="AppTheme.NoActionBarLaunch"');end=text.index('</style>',start)
    text=text[:start]+'''<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="windowSplashScreenBackground">@color/playita_icon_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/playita_splash_logo</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    '''+text[end:];styles.write_text(text)
ios=root/'apps/web/ios/App/App/Assets.xcassets'
if ios.exists():
    d=ios/'AppIcon.appiconset';d.mkdir(exist_ok=True);tile(1024).convert('RGB').save(d/'AppIcon-512@2x.png');(d/'Contents.json').write_text(json.dumps({'images':[{'filename':'AppIcon-512@2x.png','idiom':'universal','platform':'ios','size':'1024x1024'}],'info':{'author':'xcode','version':1}},indent=2))
print('Approved La Playita launcher/adaptive/splash assets prepared; Android generated, iOS only when present.')
