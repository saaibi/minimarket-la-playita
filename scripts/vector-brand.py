"""Trace the approved raster into SVG color contours; no generated brand artwork."""
from pathlib import Path
from PIL import Image, ImageFilter
from collections import defaultdict
root=Path(__file__).resolve().parents[1]
palette=Image.new('P',(1,1))
colors=[(255,250,244),(255,253,250),(70,135,12),(56,116,12),(3,70,32),(4,83,39),(80,39,8),(57,28,5),(220,85,12),(190,66,8),(0,80,146),(0,103,172),(0,134,199),(0,65,116),(0,117,185),(181,200,190)]
palette.putpalette([v for color in colors for v in color]+[0]*(768-len(colors)*3))
im=Image.open(root/'apps/web/public/assets/marca.png').convert('RGB').filter(ImageFilter.MedianFilter(3)).quantize(palette=palette,dither=Image.Dither.NONE)
w,h=im.size; pix=im.load(); pal=im.getpalette()
def simplify(points,eps=0.85):
    if len(points)<3:return points
    a,b=points[0],points[-1]; dx=b[0]-a[0];dy=b[1]-a[1];den=(dx*dx+dy*dy)**.5
    vals=[abs(dy*(p[0]-a[0])-dx*(p[1]-a[1]))/den if den else ((p[0]-a[0])**2+(p[1]-a[1])**2)**.5 for p in points]
    m=max(vals);i=vals.index(m)
    if m<=eps:return [a,b]
    return simplify(points[:i+1],eps)[:-1]+simplify(points[i:],eps)
normal=[];mountain=[]
for c in sorted(set(im.getdata())):
    edges=defaultdict(list)
    for y in range(h):
      for x in range(w):
        if pix[x,y]!=c:continue
        if y==0 or pix[x,y-1]!=c:edges[x,y].append((x+1,y))
        if x==w-1 or pix[x+1,y]!=c:edges[x+1,y].append((x+1,y+1))
        if y==h-1 or pix[x,y+1]!=c:edges[x+1,y+1].append((x,y+1))
        if x==0 or pix[x-1,y]!=c:edges[x,y+1].append((x,y))
    while edges:
      start=next(iter(edges));cur=start;pts=[start]
      while True:
        nxt=edges[cur].pop()
        if not edges[cur]:del edges[cur]
        pts.append(nxt);cur=nxt
        if cur==start:break
      area=abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:])))/2
      if area<5:continue
      half=len(pts)//2;out=simplify(pts[:half+1])[:-1]+simplify(pts[half:])
      r,g,b=pal[c*3:c*3+3];color=f'#{r:02x}{g:02x}{b:02x}'
      path='<path fill="'+color+'" d="M'+' L'.join(f'{x},{y}' for x,y in out)+'Z"/>'
      (mountain if g>r*1.25 and g>b*1.25 and max(p[1] for p in pts)<240 else normal).append(path)
import re
def combine(paths):
    colors=defaultdict(list)
    for path in paths:
        color,d=re.match(r'<path fill="([^"]+)" d="([^"]+)"/>',path).groups()
        colors[color].append(d)
    return ['<path fill="'+color+'" fill-rule="evenodd" d="'+''.join(ds)+'"/>' for color,ds in colors.items()]
normal=combine(normal);mountain=combine(mountain)
head=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img"><title>Minimarket La Playita</title>'
# Draw largest background regions before smaller foreground contours, retaining source tracing order.
static=head+''.join(normal)+''.join(mountain)+'</svg>'
(root/'apps/web/public/assets/marca-vector.svg').write_text(static)
animated=head+'''<style>@keyframes draw{0%{width:0}75%,100%{width:570px}}.reveal{animation:draw 1.8s ease-in-out infinite}@media(prefers-reduced-motion:reduce){.reveal{animation:none;width:570px}}</style><defs><clipPath id="mountain-reveal"><rect class="reveal" width="570" height="250"/></clipPath></defs>'''+''.join(normal)+'<g clip-path="url(#mountain-reveal)">'+''.join(mountain)+'</g></svg>'
(root/'apps/web/public/assets/marca-cargando.svg').write_text(animated)
print(len(static),len(mountain),'mountain contours')
