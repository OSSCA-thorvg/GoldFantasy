# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "opencv-python-headless", "Pillow", "scipy"]
# ///
"""Combine original artwork, construction references and prior colour studies.
No source artwork is resculpted to a shared silhouette. Attachments are metadata.
"""
from pathlib import Path
import json,copy
import numpy as np
from PIL import Image
from build_character_assets import paths,normalized,points,code_path,separated_face,eye_model
from character_vector_finish import symmetric_face,finish_parts
ROOT=Path(__file__).resolve().parents[1];REF=ROOT/'docs/character-system/references';POOL=REF/'pool';OUT=ROOT/'src/game/assets/characters'
CLEAN=json.loads((POOL/'clean/manifest.json').read_text())['results'] if (POOL/'clean/manifest.json').exists() else {}

def changed(p,s):
 if not p.exists() or p.read_text()!=s:p.write_text(s)
def load(record):
 if record.get('empty'):return []
 clean=CLEAN.get(str((POOL/record['png']).relative_to(ROOT)))
 return paths(ROOT/clean['svg']) if clean else paths(POOL/record['svg'])
def outer(part):
 q=copy.deepcopy(part);out=[]
 for c in q['commands']:
  if c[0]=='M' and out:break
  out.append(c)
 q.update(commands=out,stroke=0,tone=255,evenodd=False);return q

def main():
 legacy=json.loads((OUT/'character-library.json').read_text());modular=json.loads((OUT/'modular-heads.json').read_text());m=json.loads((POOL/'manifest.json').read_text());faces=[];looks=[]
 for h in legacy['heads']:
  f=copy.deepcopy(h['face']);f.update(name=h['name'],crown=3.2,chin=3.2,layout=h['layout']);faces.append(f)
 for i,f in enumerate(faces):
  key=str((REF/'layers'/f'{i:02}-ear-L.png').relative_to(ROOT))
  if key in CLEAN:
   scale=f['copy_transform']['scale'];root=np.array(f['copy_transform']['origin'])+np.array(f['ear_roots'][0])/scale
   f['ears'][0]=normalized(paths(ROOT/CLEAN[key]['svg']),root,scale)
 for i,row in enumerate(m['dot_faces']):
  raw=load(row['face']);f=separated_face(raw,[load(p) for p in row['ears']],row['anatomy'],{'width':.28,'y':1.95,'curve':0})
  f['coverage']=outer(max(f['paths'],key=lambda p:np.prod(np.ptp(points(p),axis=0))))
  f.update(name=row['name'],crown=3.2,chin=3.2,layout={'eye_spacing':1.65 if i==10 else f['temple']*.47,'eye_y':.2,'eye_radius':1.05 if i==10 else .72,'nose_y':1.12});faces.append(f)
 assert len(faces)==30
 faces=[symmetric_face(f) for f in faces]
 for f in faces:
  f['ears']=[finish_parts(p,'ear') for p in f['ears']]
 male=[True,False,True,True,True,True,False,True,False,False,True,False,False,True,True,False,False,True,False]
 def seam(f):
  ps=[(p[1],abs(p[0])) for p in f['anchors'][2:14:2]]
  for (y0,x0),(y1,x1) in zip(ps,ps[1:]):
   if y0<=0<=y1:
    t=(0-y0)/(y1-y0);t=t*t*(3-2*t);return x0+(x1-x0)*t
  return f['temple']
 def add(name,face,gender,group,full=None,back=None,parts=None,frame=None,split=-1.4,tied=-100,eye=0,rear=0):
  f=faces[face];looks.append({'name':name,'native_face':face,'gender':gender,'group':group,'full':finish_parts(full or [],'hair') if group in (0,4) else full or [],'back':finish_parts(back or [],'hair' if rear==4 else 'back'),'parts':parts,'frame':frame or [seam(f),f['crown']],'split':split,'tied_top':tied,'eye':eye,'rear_mode':rear,'ready':group in (0,4)})
 def curtain(name):
  record=CLEAN[str((POOL/'clean/regions'/f'{name}-curtain.png').relative_to(ROOT))]
  return paths(ROOT/record['svg'])
 for i,h in enumerate(legacy['heads']):
  r=h['hair']['registration'];center=(-np.array(r['offset'])/r['scale']).tolist()
  back=normalized(load(m['previous'][i]['back']),center,r['scale'])
  if i==16:
   def region(name):
    record=CLEAN[str((POOL/'clean/regions'/f'original-16-{name}.png').relative_to(ROOT))]
    return finish_parts(normalized(paths(ROOT/record['svg']),center,r['scale']),'hair')
   parts={'cap':region('cap'),'fringe':[],'back':finish_parts(back,'back'),'tied':region('tied'),'curtain':False,'back_extension':0}
   add(h['name'],i,1,0,parts=parts,eye=i)
  else:
   rear=4 if i in (1,6,11,12) else 0
   if rear==4:back=normalized(curtain(f'original-{i:02}'),center,r['scale'])
   add(h['name'],i,0 if male[i] else 1,0,normalized(load(m['previous'][i]['hair']),center,r['scale']),back,eye=i,rear=rear)
 add('Bald',0,2,0)
 looks[10].update(ready=False,retired=True,retirement_reason='Tousled crop removed from selection: face-shaped nape and difficult asymmetric fringe.')
 for i,h in enumerate(modular['looks']):add('Construction / '+h['name'],i,0 if male[i] else 1,1,parts=h,frame=[3.2,3.3],eye=i)
 def anchored_hair(record,face,raw=None):
  if raw is None:raw=load(record)
  if not raw:return []
  im=np.array(Image.open(POOL/record['png']).convert('RGBA'));mask=im[:,:,3]>128;yy,xx=np.nonzero(mask)
  width=xx.max()-xx.min();cx=(xx.max()+xx.min())*.5
  rows=np.count_nonzero(mask,axis=1);eligible=np.flatnonzero(rows>width*.48);top=float(eligible[0] if len(eligible) else yy.min())
  scale=faces[face]['copy_transform']['scale'];cy=top+(faces[face]['crown']+.18)/scale
  centres=[]
  for y in range(max(0,int(cy-10)),min(mask.shape[0],int(cy+10))):
   xs=np.flatnonzero(mask[y]);left=xs[xs<cx];right=xs[xs>=cx]
   if len(left) and len(right):centres.append((left.max()+right.min())*.5)
  if centres:cx=float(np.median(centres))
  return normalized(raw,[cx,cy],scale)
 for i,r in enumerate(m['dots']):add(f'Dot study / {i+1}',19+i,1 if r['gender']=='F' else 0,3,anchored_hair(r['hair'],19+i))
 elf=anchored_hair(m['elf_hair'],29)
 elf_back=anchored_hair(m['elf_hair'],29,curtain('elf'))
 add('Flat-lid elf',29,1,4,elf,elf_back,eye=19,rear=4)
 for row in m['colored']:
  x0,y0,x1,y1=row['face_box'];fw=row.get('skull_width',x1-x0);fh=y1-y0;gender=1 if row['gender']=='F' else 0
  # The old blank contours provide stable editable face/ear geometry; select the
  # nearest aspect, without importing painted-in eyes or clothing into a wig.
  aspects=[f['temple']/3.2 for f in faces[:19]];face=min(range(19),key=lambda i:abs(aspects[i]-fw/max(fh,1)))
  raw=load(row['hair']);s=faces[face]['temple']/max(6,fw*.44);origin=[(x0+x1)*.5,y0+fh*.43]
  data=normalized(raw,origin,s)
  back=normalized(load(row['back']),origin,s) if row.get('back') else []
  add(f'Colour {row["sheet"]:02}-{row["index"]+1:02}',face,gender,2,data,back,eye=12 if row['sheet']>=11 else face,rear=row.get('rear_mode',2))
 assert len(looks)==150,len(looks)
 dot_fallback=[17,2,6,12,3,15,16,2,9,12]
 for i,h in enumerate(looks):
  h['fallback']=i if h['ready'] else i-20 if 20<=i<39 else dot_fallback[i-39] if 39<=i<49 else 0 if h['gender']==1 else 2
 looks[10]['fallback']=17
 for i,row in enumerate(m['colored']):
  h=looks[50+i];key=(row['sheet'],row['index'])
  if row.get('rear_mode')==1:h['fallback']=12
  if row.get('rear_mode')==3:h['fallback']=11
  if key in {(2,6),(6,6),(7,4),(10,6)}:h['fallback']=16
  if key in {(5,3),(6,1),(7,9),(8,7)}:h['fallback']=18
  if key==(7,6):h['fallback']=15
  if key==(8,5):h['fallback']=4
  if row['hair'].get('empty'):h['fallback']=19
  if row['sheet']>=11:h['fallback']=49
 for h in looks:
  if h['fallback']==10:h['fallback']=17
 # Complete only invisible scalp overlap. Source back fills remain attached to
 # their original images; the renderer partitions cap/fringe/tie coverage.
 extra=eye_model(np.array(Image.open(POOL/m['elf_eyes']['png']).convert('L')))
 data={'version':1,'faces':faces,'looks':looks,'extra_eye':extra,'source':'original and colour reference curves traced by the logperch vectorizer; attachment metadata only'}
 changed(OUT/'character-pool.json',json.dumps(data,indent=2)+'\n')
 lines=['// Generated by tools/build_character_pool.py from original logperch traces.']
 def emit(name,values):
  if not values:return '{}'
  lines.append(f'static const RawPath {name}[] = {{')
  for p in values:lines.append(' {"'+code_path(p)+'", '+str(p['tone'])+', '+f'{p["stroke"]:.5f}f, '+str(p['evenodd']).lower()+', '+str(p.get('outline',False)).lower()+'},')
  lines.append('};');return name
 ff=[]
 for i,f in enumerate(faces):ff.append([emit(f'poolFace{i}',f['paths']),emit(f'poolMask{i}',[f['coverage']]),emit(f'poolEarL{i}',f['ears'][0]),emit(f'poolEarR{i}',f['ears'][1])])
 hh=[]
 for i,h in enumerate(looks):
  full=emit(f'poolHair{i}',h['full']);back=emit(f'poolBack{i}',h['back']);parts=[]
  for p in ('cap','fringe','back','tied'):parts.append(emit(f'poolHair{i}{p.title()}',h['parts'][p]) if h['parts'] else '{}')
  hh.append([full,back,*parts])
 def pts(ps):return '{{'+','.join('{'+f'{x:.5f}f,{y:.5f}f'+'}' for x,y in ps)+'}}'
 lines.append('static const FaceSource faceSources[] = {')
 for i,(f,g) in enumerate(zip(faces,ff)):
  roots=f['ear_roots'];anchors=f['anchors'][:16];layout=f['layout']
  lines.append('{"'+f['name']+'", '+g[0]+', '+g[1]+'[0], '+g[2]+', '+g[3]+', '+pts(anchors)+', '+pts(roots)+', '+','.join(f'{float(v):.5f}f' for v in (f['temple'],f['crown'],f['chin'],layout['eye_spacing'],layout['eye_y'],layout['eye_radius'],layout['nose_y'],f['mouth']['width'],f['mouth']['y']))+'},')
 lines.append('};\nstatic const HairSource hairSources[] = {')
 for i,(h,g) in enumerate(zip(looks,hh)):
  curtain=h['parts']['curtain'] if h['parts'] else False;extension=h['parts']['back_extension'] if h['parts'] else 0
  lines.append('{"'+h['name']+'", '+','.join(g)+', '+str(h['native_face'])+', '+str(h['gender'])+', '+str(h['group'])+', '+','.join(f'{float(v):.5f}f' for v in (*h['frame'],h['split'],h['tied_top'],extension))+', '+str(curtain).lower()+', '+str(h['eye'])+', '+str(h['rear_mode'])+', '+str(h['ready']).lower()+', '+str(h['fallback'])+'},')
 lines.append('};')
 lines.append('static const FeatureSource extraFeature = {'+pts(extra['points'])+', '+pts(extra['brow'])+', '+f'{extra["pupil_radius"]:.5f}f,{extra["pupil_x"]:.5f}f'+'};')
 changed(OUT/'character-pool.inc','\n'.join(lines)+'\n')
 print(f'Compiled {len(looks)} hair assets including bald, {len(faces)} face/ear templates and 20 eye/brow recipes.')
if __name__=='__main__':main()
