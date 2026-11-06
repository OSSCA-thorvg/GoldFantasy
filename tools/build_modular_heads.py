# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "opencv-python-headless", "Pillow"]
# ///
"""Register the supplied modular construction sheets; never redraw their hair curves.

Canonical temples are (+/-3.2, 0), crown (0,-3.3). Cap contact bands are
elastic; each fringe registration is a similarity. Runtime skinning is separate.
"""
from pathlib import Path
import copy,json
import numpy as np
from PIL import Image
from build_character_assets import paths, normalized, points, code_path
ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'docs/character-system/references/modular'
OUT=ROOT/'src/game/assets/characters'
def write_changed(path,text):
 if not path.exists() or path.read_text()!=text:path.write_text(text)

NAMES=['Side part','Long waves','Side fringe','Wind swept','Curly crown','Flipped bob','Long centre part','Spiky crop','Soft bob','Twin loops','Tousled crop','Braids','Long locks','Short centre part','Wild tuft','Short twin tails','High bun','Light crop','Twin buns']

def image(entry,part):return np.array(Image.open(REF/entry['parts'][part]['crop']).convert('RGBA'))
def source(entry,part):return paths(REF/entry['parts'][part]['svg']) if not entry['parts'][part]['empty'] else []
def box(a):
 y,x=np.nonzero(a[:,:,3]>128);return np.array([x.min(),y.min()]),np.array([x.max(),y.max()])
def clean(raw):
 # Tracing dust has sub-pixel area and does not belong to an authored part.
 return [p for p in raw if len(points(p)) and np.prod(np.ptp(points(p),axis=0))>.0008]
def transform(raw,center,scale):return clean(normalized(raw,tuple(center),scale))
def remap(raw,mapper):
 result=copy.deepcopy(raw)
 for p in result:
  for c in p['commands']:
   for j in range(1,len(c),2):c[j],c[j+1]=[round(float(v),5) for v in mapper(np.array(c[j:j+2]))]
 return clean(result)

def cap(entry):
 a=image(entry,'cap');mask=a[:,:,3]>128;lo,hi=box(a)
 xs=np.flatnonzero(mask[max(0,hi[1]-5):hi[1]+1].any(0));left,right=xs.min(),xs.max()
 center=(left+right)*.5;scale=6.65/max(1,right-left)
 # The skull contact band is elastic; silhouette tips above its crown translate.
 core=[]
 for x in range(int(center-(right-left)*.16),int(center+(right-left)*.16)+1):
  yy=np.flatnonzero(mask[:,x])
  if len(yy):core.append(yy.min())
 crown=float(np.median(core));baseline=hi[1];yscale=3.5/(baseline-crown)
 def at(p):
  y=(p[1]-baseline)*yscale if p[1]>=crown else -3.5+(p[1]-crown)*scale
  return [(p[0]-center)*scale,y]
 return remap(source(entry,'cap'),at),{'origin':[center,int(baseline)],'scale':scale,'crown_y':crown,'contact_y_scale':yscale}

def fringe(entry):
 entry['_curtain']=False
 raw=source(entry,'fringe')
 if not raw:return []
 a=image(entry,'fringe');lo,hi=box(a);middle=(lo[0]+hi[0])*.5
 # Two separate curtains share a crown attachment and have independent temple
 # attachments. Their source curves undergo similarity transforms, never shear.
 mask=a[:,:,3]>128
 from cv2 import connectedComponentsWithStats
 count,labels,stats,_=connectedComponentsWithStats(mask.astype('uint8'))
 components=[j for j in range(1,count) if stats[j,4]>100]
 paired=len(components)==2 and all(stats[j,2]<(hi[0]-lo[0])*.65 for j in components)
 if paired:
  entry['_curtain']=True
  frames=[]
  for side in (-1,1):
   eligible=[j for j in components if (stats[j,0]+stats[j,2]*.5-middle)*side>0]
   label=eligible[0];yy,xx=np.nonzero(labels==label);top=yy.min();bottom=yy.max()
   rootx=float(np.median(xx[yy<=top+2]));tipx=float(np.median(xx[yy>=bottom-2]))
   origin=np.array([rootx,top]);v=np.array([tipx,bottom])-origin;target=np.array([side*3.24,3.5]);den=v@v
   co=(v@target)/den;si=(v[0]*target[1]-v[1]*target[0])/den
   frames.append((origin,co,si))
  entry['_fringe_registration']={'kind':'two-anchor similarity','middle':float(middle),'frames':[{'origin':o.tolist(),'cos_scale':float(c),'sin_scale':float(si)} for o,c,si in frames]}
  def at(p):
   origin,co,si=frames[0 if p[0]<middle else 1];v=p-origin
   return [co*v[0]-si*v[1],-3.5+si*v[0]+co*v[1]]
  return remap(raw,at)
 scale=min(6.85/(hi[0]-lo[0]),3.0/(hi[1]-lo[1]));origin=[middle,float(lo[1]+3.5/scale)];entry['_fringe_registration']={'kind':'similarity','origin':origin,'scale':float(scale)};return transform(raw,origin,scale)

def back(entry,i):
 raw=source(entry,'back')
 if not raw:return [],[]
 a=image(entry,'back');lo,hi=box(a);f=image(entry,'face');flo,fhi=box(f);scale=6.4/(fhi[0]-flo[0]);center=(lo[0]+hi[0])*.5
 tops=[-1.5,-3.3,0,-4.5,-4.6,-3.5,-3.4,-4.2,-3.3,-1.4,-4.4,-3.5,-3.5,0,-3.5,-.7,-3.1,.1,-1.5]
 baseline=lo[1];top=tops[i]
 if i==5:
  raw=[p for p in raw if points(p)[:,0].mean()<155]
  hi[0]=max(points(p)[:,0].max() for p in raw);center=(lo[0]+hi[0])*.5
 if i==10:
  # The antenna belongs to the cap. The isolated back silhouette starts below it.
  raw=[p for p in raw if points(p)[:,1].max()>37]
  baseline=42
  scale*=.87
 if i==16:
  # Register the arch, not the detached bun above it.
  baseline=38
 entry['_back_registration']={'origin':[float(center),float(baseline-top/scale)],'scale':float(scale)}
 result=transform(raw,[center,baseline-top/scale],scale)
 if i==11:
  tied=source(entry,'tied-L')+source(entry,'tied-R')
  return result,transform(tied,[center,baseline-top/scale],scale)
 tied=[]
 if i in (0,9,15,18):tied,result=result,[]
 elif i in (5,16):
  keep=[]
  for p in result:
   cloud=points(p);mn,mx=cloud.min(0),cloud.max(0)
   if (i==5 and mn[0]>2.3) or (i==16 and mx[1]<-3.2):tied.append(p)
   else:keep.append(p)
  result=keep
 return result,tied

def main():
 m=json.loads((REF/'manifest.json').read_text());bases=[];looks=[]
 for i,e in enumerate(m['calibration']):
  raw=source(e,'face');outer=max((p for p in raw if p['tone']<90),key=lambda p:np.prod(np.ptp(points(p),axis=0)))
  a=image(e,'face');lo,hi=box(a);origin=[(lo[0]+hi[0])*.5,[88,88,76.5,97.5][i]];s=6.4/165
  p=transform([outer],origin,s)[0];p['tone']=255;p['stroke']=.065
  # This single closed source contour receives a skin fill and a uniform outline.
  bases.append({'name':['Round','Long jaw','Wide','High crown'][i],'outline':p,'radius':float((hi[0]-lo[0])*s*.5),'crown':(3.3 if i in (0,1) else float((origin[1]-lo[1])*s)),'chin':float((hi[1]-origin[1])*s),'registration':{'origin':origin,'scale':s}})
 for i,e in enumerate(m['looks']):
  c,registration=cap(e);b,t=back(e,i)
  looks.append({'name':NAMES[i],'cap':c,'fringe':fringe(e),'back':b,'tied':t,'curtain':e.get('_curtain',False),'anchors':{'crown':[0,-3.5],'temples':[[-3.24,0],[3.24,0]]},'registration':{**registration,'fringe':e.get('_fringe_registration',{}),'back':e.get('_back_registration',{})},'sheet':e['sheet'],'row':e['row'],'back_extension':max(0.,(3.4 if i==8 else 2.4)-max(float(points(p)[:,1].max()) for p in b)) if i in (8,10) and b else 0.})
 # Measured corrective cap/fringe/back drawings for wider and taller crania.
 # Round and long-jaw explicitly share correction zero: chin never selects hair.
 corrective=[]
 for j in (0,2,3):
  e=m['calibration'][j];c,reg=cap(e);b=source(e,'back');a=image(e,'back');lo,hi=box(a)
  # Ignore the adjacent fringe's ink which slightly enters the back crop.
  b=[p for p in b if points(p)[:,0].mean()>35]
  cloud=np.concatenate([points(p) for p in b]);lo=cloud.min(0);hi=cloud.max(0)
  s=(6.65 if j!=2 else 7.9)/(hi[0]-lo[0]);back_paths=transform(b,[(lo[0]+hi[0])*.5,lo[1]+3.4/s],s)
  # Corrective drawings retain their authored aspect. Fit only the attachment frame.
  corrective.append({'base':j,'cap':c,'fringe':fringe(e),'back':[],'tied':[],'curtain':e.get('_curtain',False),'back_extension':0.})
 data={'version':1,'bases':bases,'looks':looks,'correctives':corrective,'source':'logperch SVG paths; elastic cap contact and similarity fringe registration; runtime positive skin weights'}
 write_changed(OUT/'modular-heads.json',json.dumps(data,indent=2)+'\n')
 lines=['// Generated by tools/build_modular_heads.py. Source paths remain editable.']
 def emit(name,parts):
  if not parts:return '{}'
  lines.append('static const RawPath '+name+'[] = {')
  for p in parts:lines.append(' {"'+code_path(p)+'", '+str(p['tone'])+', '+f'{p["stroke"]:.5f}f, '+str(p['evenodd']).lower()+'},')
  lines.append('};');return name
 for i,b in enumerate(bases):emit('baseOutline'+str(i),[b['outline']])
 groups=[]
 for i,h in enumerate(looks+corrective):groups.append([emit('modular'+str(i)+part.title(),h[part]) for part in ('cap','fringe','back','tied')])
 lines.append('static const SkullSource skullSources[] = {')
 for i,b in enumerate(bases):lines.append('{"'+b['name']+'", baseOutline'+str(i)+'[0], '+', '.join(f'{b[k]:.5f}f' for k in ('radius','crown','chin'))+'},')
 lines.append('};\nstatic const ModularHair modularHairSources[] = {')
 for g,h in zip(groups,looks+corrective):lines.append('{'+', '.join(g)+', '+str(h['curtain']).lower()+', '+f'{h["back_extension"]:.5f}f'+'},')
 lines.append('};')
 write_changed(OUT/'modular-heads.inc','\n'.join(lines)+'\n')
 import xml.etree.ElementTree as ET
 directory=REF/'derived/parts';directory.mkdir(parents=True,exist_ok=True)
 for i,h in enumerate(looks):
  root=ET.Element('svg',{'xmlns':'http://www.w3.org/2000/svg','viewBox':'-8 -10 16 24','width':'320','height':'480','role':'img'})
  ET.SubElement(root,'title').text=h['name']+' editable hair components'
  ET.SubElement(root,'desc').text='Scalp cap, fringe, back and tied components registered from logperch traces. No face or clothing is baked into these parts.'
  character=ET.SubElement(root,'g',{'id':f'CHAR_hair_{i:02}_root'})
  for part in ('back','tied','cap','fringe'):
   group=ET.SubElement(character,'g',{'id':'hair_'+part})
   solid=all(p['tone']<90 for p in h[part])
   for j,p in enumerate(h[part]):
    color=('#1a1a1a' if part in ('back','tied') else '#686867') if solid or p['tone']>=90 else '#191c1b'
    attrs={'id':f'{part}_{j}','d':code_path(p),'fill':color}
    if p['evenodd']:attrs['fill-rule']='evenodd'
    if p['stroke']>0:attrs.update(fill='none',stroke=color,**{'stroke-width':str(p['stroke']),'stroke-linecap':'round','stroke-linejoin':'round'})
    ET.SubElement(group,'path',attrs)
  ET.ElementTree(root).write(directory/f'{i:02}-hair.svg',encoding='utf-8',xml_declaration=True)
 print('Compiled 4 crania, 19 modular hairstyles and 3 corrective part sets.')
if __name__=='__main__':main()
