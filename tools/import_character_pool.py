# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "opencv-python-headless", "Pillow"]
# ///
"""Extract previous user references and trace editable hair/face parts with logperch.
Source images are immutable. Every automatic crop and inferred hidden fill is recorded.
"""
from pathlib import Path
import argparse,json,hashlib,subprocess
from concurrent.futures import ThreadPoolExecutor
import cv2,numpy as np
from PIL import Image,ImageDraw
from import_character_references import DEFAULT_VECTORIZER,describe_trace
from split_character_layers import face_layers
ROOT=Path(__file__).resolve().parents[1];REF=ROOT/'docs/character-system/references';OUT=REF/'pool'
cv2.setNumThreads(1)
GRIDS={1:(6,2),2:(5,2),3:(6,2),4:(5,2),5:(5,2),6:(5,2),7:(5,2),8:(5,2),9:(5,1),10:(5,2),11:(1,1),12:(1,1)}
GENDERS={1:'FMMMMMFMMFMM',2:'FMMMMMFMFM',3:'FMMFFMFMMFMM',4:'FMFFMMMFFF',5:'MMFFFMFFMF',6:'FMMFFFMFMF',7:'MFFFFFFMMM',8:'MMMMFMMMMM',9:'MFMFM',10:'FFFMFFFFMM',11:'F',12:'F'}
MANUAL_HEADS={(1,5):((899,160),(845,96,956,205)),(3,6):((128,480),(85,435,177,521)),(4,4):((904,213),(816,184,977,260)),(7,3):((707,165),(630,81,789,198)),(7,8):((710,602),(635,535,788,634)),(8,6):((330,500),(250,474,398,616)),(10,8):((706,616),(633,553,786,640))}
# Source palette/occlusion annotations for pale hair and hair touching clothing.
HAIR_COLORS={(3,6):[241,228,173],(5,9):[235,219,187],(8,2):[230,224,205],(8,4):[225,220,201],(8,7):[225,220,201]}
HAIR_ENDS={(1,5):0,(1,8):0,(2,3):.25,(3,1):0,(3,2):.3,(3,3):.3,(3,4):1.0,(4,4):0,(4,7):1.7,(5,0):0,(5,5):.5,(6,0):0,(6,6):0,(7,0):2.5,(7,5):.8,(8,2):-.65,(10,0):2.4,(10,5):1.5}
BALD_SOURCES={(1,7),(2,7),(3,7),(4,6),(8,1),(8,3),(8,6),(8,8)}
LONG_SOURCES={(1,0),(1,1),(1,3),(1,9),(1,10),(2,0),(2,2),(2,3),(3,0),(3,3),(3,4),(3,6),(3,9),(4,0),(4,2),(4,3),(4,7),(4,8),(5,4),(5,7),(5,9),(6,4),(6,5),(6,9),(7,0),(7,1),(7,3),(7,5),(8,4),(8,5),(9,3),(9,4),(10,0),(10,7),(11,0),(12,0)}
HANGING_SOURCES={(2,4),(2,6),(5,3),(5,6),(6,1),(6,2),(6,6),(6,7),(7,2),(7,4),(7,6),(7,9),(8,7),(8,9),(10,2),(10,5),(10,6)}
DOT_HAIR=[(85,15,255,159),(61,194,279,340),(84,351,262,502),(83,509,255,705),(65,706,273,839),(56,850,279,965),(79,977,250,1143),(61,1143,254,1248),(74,1254,239,1410),(69,1404,253,1536)]
DOT_FACE=[(526,34,682,190),(503,218,704,330),(524,351,683,499),(507,515,694,692),(512,720,689,840),(492,855,705,970),(525,991,675,1138),(491,1147,699,1254),(525,1261,677,1404),(477,1412,700,1536)]

def filled(mask):
 x=np.pad((~mask).astype('uint8'),1,constant_values=1);cv2.floodFill(x,None,(0,0),2);return x[1:-1,1:-1]!=2

def face_candidate(im):
 h,w=im.shape[:2];small=im[:min(h,max(300,int(h*.72))) ]
 q=(small//12).astype('int32');keys=q[:,:,0]*1024+q[:,:,1]*32+q[:,:,2]
 colors,counts=np.unique(keys,return_counts=True);candidates=[]
 for key in colors[np.argsort(counts)[-36:]]:
  color=np.median(small[keys==key],axis=0);r,g,b=color
  if not(r>b+12 and r>g+3 and g>b+2 and r>65 and g>38 and b>25):continue
  mask=(np.max(np.abs(small.astype(float)-color),axis=2)<17).astype('uint8')
  n,labels,stats,centers=cv2.connectedComponentsWithStats(mask)
  for label,(x,y,bw,bh,area) in enumerate(stats):
   if not label or area<45 or bw<10 or bh<12 or bw>w*.92 or abs(centers[label,0]-w*.5)>w*.35:continue
   interior=mask[y+int(bh*.35):y+int(bh*.8),x+int(bw*.3):x+int(bw*.7)]
   # A U-shaped hair region can enclose both eyes after hole filling. It is
   # not skin: the actual source colour must occupy the centre of the face.
   if not interior.size or interior.mean()<.35:continue
   shape=filled(labels==label);eroded=cv2.erode(shape.astype('uint8'),np.ones((3,3),'uint8'))>0
   dark=(small.max(2)<165)&eroded&(mask==0)
   nn,ll,ss,cc=cv2.connectedComponentsWithStats(dark.astype('uint8'));eyes=[]
   for j,(ex,ey,ew,eh,ea) in enumerate(ss):
    if not j or ea<2 or ea>area*.16:continue
    if not(y+bh*.15<cc[j,1]<y+bh*.78):continue
    ring=cv2.dilate((ll==j).astype('uint8'),np.ones((15,15),'uint8'))>0
    ring&=ll!=j
    if ring.any() and (mask[ring]>0).mean()>.22:eyes.append(j)
   pairs=[(a,b) for a in eyes for b in eyes if cc[b,0]-cc[a,0]>bw*.22 and abs(cc[a,1]-cc[b,1])<bh*.15]
   score=float(area)*(3.5 if pairs else .5)*np.exp(-2*abs(centers[label,0]-w*.5)/w-2*y/small.shape[0])/(1+max(0,bh/bw-1.5))
   candidates.append((score,shape,color,(x,y,bw,bh),cc[pairs[0][0]:pairs[0][0]+1].tolist() if pairs else []))
 if not candidates:raise ValueError('No face candidate')
 score,mask,color,box,_=max(candidates,key=lambda x:x[0]);full=np.zeros((h,w),bool);full[:mask.shape[0]]=mask
 yy,xx=np.nonzero(mask);x0,x1=xx.min(),xx.max();y0,y1=yy.min(),yy.max();fw=x1-x0+1
 # A narrow skin neck is not part of the head.
 widths=np.array([np.count_nonzero(row) for row in mask]);low=np.flatnonzero((np.arange(len(widths))>y0+fw*.65)&(widths<fw*.26)&(widths>0))
 if len(low):y1=min(y1,int(low[0])+1)
 full[y1+1:]=False
 return full,color,(int(x0),int(y0),int(x1+1),int(y1+1)),score

def colored_hair(im,skin,face,skin_color,source_color=None,end=None):
 h,w=im.shape[:2];x0,y0,x1,y1=face;cx=(x0+x1)*.5
 widths=np.count_nonzero(skin,axis=1);widths=widths[widths>max(5,(x1-x0)*.25)];fw=float(np.percentile(widths,60)) if len(widths) else x1-x0
 top=max(0,int(y0-fw*1.25));bottom=min(h,int(y1+fw*3.6));left=max(0,int(cx-fw*1.35));right=min(w,int(cx+fw*1.35))
 # Sample the scalp itself. The earlier sheets overlap vertically: sampling
 # everything above a head picked the preceding character's boots as hair.
 sample_top=max(top,int(y0-fw*.5));sample_bottom=min(h,int(y0+fw*.22))
 region=im[sample_top:sample_bottom,left:right]
 allowed=(region.min(2)<246)&~skin[sample_top:sample_bottom,left:right]
 if region.size==0:raise ValueError('Empty hair region')
 q=(region//16).astype('int32');keys=q[:,:,0]*256+q[:,:,1]*16+q[:,:,2];ks,counts=np.unique(keys[allowed],return_counts=True)
 candidates=[];skin_dilate=cv2.dilate(skin.astype('uint8'),np.ones((3,3),'uint8'))>0
 skin_color=np.asarray(skin_color)
 palette=[np.asarray(source_color)] if source_color is not None else [np.median(region[keys==key],axis=0) for key in ks[np.argsort(counts)[-10:]]]
 for color in palette:
  if source_color is None and (color.min()>220 or np.max(np.abs(color-skin_color))<18):continue
  mask=np.max(np.abs(im.astype(float)-color),axis=2)<24
  mask&=~skin_dilate;mask[:top]=False;mask[bottom:]=False;mask[:,:left]=False;mask[:,right:]=False
  if end is not None:mask[max(0,int(y1+fw*end)):]=False
  # Only outer strands below the neck are visible hair; clothing is not imported.
  cut=int(y1+fw*.08);a=max(0,int(cx-fw*.46));b=min(w,int(cx+fw*.46));mask[cut:,a:b]=False
  # Facial ink is never part of a wig, even when an eyelid touches the hair.
  mask[int(y0+(y1-y0)*.4):y1,max(0,int(cx-fw*.36)):min(w,int(cx+fw*.36))]=False
  n,labels,stats,_=cv2.connectedComponentsWithStats(mask.astype('uint8'));keep=np.zeros_like(mask)
  for j,(x,y,bw,bh,area) in enumerate(stats):
   if not j or area<max(6,fw*fw*.004) or y+bh<y0+fw*.05:continue
   if x>cx-fw*.36 and x+bw<cx+fw*.36 and y>y0+fw*.18 and y+bh<y1:continue
   component=labels==j
   # A part must touch the scalp neighbourhood; detached props and boots do
   # not qualify. Side locks may start below the cap after skin removal.
   contact=component[sample_top:min(h,int(y1-fw*.12)),max(0,int(cx-fw*.83)):min(w,int(cx+fw*.83))]
   if np.count_nonzero(contact)>=max(3,fw*.035):keep|=component
  score=np.count_nonzero(keep[sample_top:sample_bottom])
  if np.max(color)-np.min(color)<25:score*=.8
  if score:candidates.append((score,keep,color))
 if not candidates:return np.zeros((*im.shape[:2],4),'uint8'),{'color':[20,20,20],'empty':True}
 _,mask,color=max(candidates,key=lambda x:x[0])
 # Include only adjacent source ink; do not invent replacement contours.
 adjacent=cv2.dilate(mask.astype('uint8'),np.ones((3,3),'uint8'))>0
 ink=(im.max(2)<85)&~skin_dilate
 mask|=adjacent&ink
 mask[int(y0+(y1-y0)*.32):y1,max(0,int(x0+(x1-x0)*.08)):min(w,int(x1-(x1-x0)*.08))]=False
 yy,xx=np.nonzero(mask)
 if not len(xx):return np.zeros((*im.shape[:2],4),'uint8'),{'color':color.tolist(),'empty':True}
 alpha=mask.astype('uint8')*255;rgba=np.dstack([im,alpha])
 return rgba,{'color':list(map(int,color)),'empty':False,'bounds':[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]}

def main():
 p=argparse.ArgumentParser();p.add_argument('--prepare-only',action='store_true');p.add_argument('--trace-only',action='store_true');p.add_argument('--jobs',type=int,default=3);args=p.parse_args()
 for folder in ('crops','vectors','derived'):(OUT/folder).mkdir(parents=True,exist_ok=True)
 jobs=[];colored=[];faces=[];dots=[]
 if args.trace_only:
  def collect(value):
   if isinstance(value,dict):
    if value.get('svg') and 'png' in value:jobs.append((OUT/value['png'],OUT/value['svg'],'keep'))
    else:
     for child in value.values():collect(child)
   elif isinstance(value,list):
    for child in value:collect(child)
  collect(json.loads((OUT/'manifest.json').read_text()));trace_all(jobs,args);return
 def save(name,pixels,background='keep'):
  file=OUT/'crops'/f'{name}.png';Image.fromarray(pixels).save(file);svg=OUT/'vectors'/f'{name}.svg'
  if np.array(pixels).shape[2]==4 and not np.array(pixels)[:,:,3].any():return {'png':str(file.relative_to(OUT)),'svg':None,'empty':True}
  jobs.append((file,svg,background));return {'png':str(file.relative_to(OUT)),'svg':str(svg.relative_to(OUT)),'empty':False}
 # Retrace previous visible hair and back fills at fidelity settings, from their
 # original layer images. The source curves are not replaced by schematic art.
 previous=[]
 for i in range(19):
  row={}
  for part in ('hair','back'):
   image=np.array(Image.open(REF/'layers'/f'{i:02}-{part}.png').convert('RGB'));ink=image.min(2)<235;opaque=filled(ink)
   if part=='hair':
    old=json.loads((ROOT/'src/game/assets/characters/character-library.json').read_text())['heads'][i]['hair']['registration'];sc=old['scale'];offset=old['offset']
    n,labels=cv2.connectedComponents((~ink).astype('uint8'))
    for xx,yy in ((0,1.5),(-.7,1.5),(.7,1.5)):
     x=int(round((xx-offset[0])/sc));y=int(round((yy-offset[1])/sc))
     if 0<=y<labels.shape[0] and 0<=x<labels.shape[1] and labels[y,x]>0:opaque[labels==labels[y,x]]=False
   alpha=opaque.astype('uint8')*255
   row[part]=save(f'original-{i:02}-{part}',np.dstack([image,alpha]))
  previous.append(row)
 dot=np.array(Image.open(OUT/'source/dot-constructions.png').convert('RGB'))
 for i,(hb,fb) in enumerate(zip(DOT_HAIR,DOT_FACE)):
  crop=dot[fb[1]:fb[3],fb[0]:fb[2]];gray=cv2.cvtColor(crop,cv2.COLOR_RGB2GRAY)
  band=[(87,135),(253,303),(398,448),(566,614),(753,802),(884,937),(1037,1077),(1175,1228),(1303,1347),(1444,1495)][i];band=(max(0,band[0]-fb[1]),min(gray.shape[0]-1,band[1]-fb[1]));skull,ears,record=face_layers(gray,band);rec={'name':f'Dot construction {i+1}','anatomy':record,'face':save(f'dot-{i:02}-face',skull),'ears':[save(f'dot-{i:02}-ear-{side}',a) for side,a in enumerate(ears)]};faces.append(rec)
  crop=dot[hb[1]:hb[3],hb[0]:hb[2]];alpha=(crop.min(2)<220).astype('uint8')*255
  dots.append({'hair':save(f'dot-{i:02}-hair',np.dstack([crop,alpha])),'box':list(hb),'gender':'F' if i in (2,3,6,8,9) else 'M'})
 elf=np.array(Image.open(OUT/'source/flat-lid-elf.png').convert('RGB'))
 raw=elf[153:370,697:1079];gray=cv2.cvtColor(raw,cv2.COLOR_RGB2GRAY);skull,ears,record=face_layers(gray,(82,170))
 faces.append({'name':'Flat-lid elf','anatomy':record,'face':save('elf-face',skull),'ears':[save(f'elf-ear-{i}',a) for i,a in enumerate(ears)]})
 hair=elf[78:930,22:425];alpha=(hair.min(2)<220).astype('uint8')*255;elf_hair=save('elf-hair',np.dstack([hair,alpha]))
 eyes=elf[200:313,417:651];eyecrop=save('elf-eyes',np.dstack([eyes,np.full(eyes.shape[:2],255,'uint8')]))
 # All twelve earlier colour sheets, including the two long-haired elf studies.
 for sheet,(cols,rows) in GRIDS.items():
  path=ROOT/'docs/portrait-style/references/source'/f'reference-{sheet:02}.png';image=np.array(Image.open(path).convert('RGB'));ih,iw=image.shape[:2]
  row_counts=[cols]*rows
  if sheet==3:row_counts=[6,5]
  centers={1:[[150,310,473,615,753,896],[143,317,507,629,759,906]],2:[[191,394,573,731,888],[181,321,523,739,876]],3:[[148,279,423,568,719,881],[130,350,568,714,880]],4:[[128,320,514,707,906],[128,328,520,721,907]],5:[[143,319,519,716,912],[145,321,520,718,918]],6:[[134,320,520,720,914],[134,320,520,720,914]],7:[[122,315,512,709,910],[125,319,516,712,914]],8:[[113,335,545,712,901],[124,324,537,709,891]],10:[[128,321,513,707,904],[128,321,513,707,904]]}
  lower=400 if sheet==3 else 430 if sheet==8 else 450 if sheet in (5,6,7,10) else 540 if sheet==1 else 570 if sheet==2 else 512
  for row in range(rows):
   for col in range(row_counts[row]):
    index=sum(row_counts[:row])+col;bounds=[round(col*iw/cols),round(row*ih/rows),round((col+1)*iw/cols),round((row+1)*ih/rows)]
    if rows==2:
     bounds[1]=0 if row==0 else lower;bounds[3]=min(ih,lower+30) if row==0 else ih
    if sheet in centers:
     cs=centers[sheet][row];edges=[0]+[round((a+b)*.5) for a,b in zip(cs,cs[1:])]+[iw];bounds[0],bounds[2]=edges[col],edges[col+1]
    if sheet==9:
     bounds=[(0,288,436,577,775)[col],(125,475,475,140,130)[col],(288,436,577,775,1024)[col],1024]
    cell=image[bounds[1]:bounds[3],bounds[0]:bounds[2]].copy()
    try:
     if (sheet,index) in MANUAL_HEADS:
      seed,head=MANUAL_HEADS[(sheet,index)];color=image[seed[1],seed[0]].astype('int16');skin=np.max(np.abs(cell.astype('int16')-color),axis=2)<14
      x0,y0,x1,y1=head;aa,bb=bounds[:2];limit=np.zeros(skin.shape,bool);limit[max(0,y0-bb):min(skin.shape[0],y1-bb),max(0,x0-aa):min(skin.shape[1],x1-aa)]=True;skin=filled(skin&limit)
      yy,xx=np.nonzero(skin);box=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
     else:skin,color,box,score=face_candidate(cell)
     pixels,info=colored_hair(cell,skin,box,color,HAIR_COLORS.get((sheet,index)),HAIR_ENDS.get((sheet,index)))
     if (sheet,index) in BALD_SOURCES:pixels[:,:,3]=0;info={'color':[20,20,20],'empty':True,'classification':'source bald scalp; beard is not scalp hair'}
    except Exception as e:raise ValueError(f'Colour sheet {sheet}, row {row}, column {col}: {e}') from e
    if (sheet,index) not in LONG_SOURCES|HANGING_SOURCES:pixels=cap_components(pixels,box)
    native=save(f'colour-{sheet:02}-{index:02}-hair',pixels)
    row_record={'sheet':sheet,'index':index,'source':str(path.relative_to(ROOT)),'crop':bounds,'face_box':list(box),'skin_color':list(map(int,color)),'hair_info':info,'hair':native,'gender':GENDERS[sheet][index]}
    row_record['rear_mode']=1 if (sheet,index) in LONG_SOURCES else 3 if (sheet,index) in HANGING_SOURCES else 2
    if row_record['rear_mode']==1:
     row_record['back']=save(f'colour-{sheet:02}-{index:02}-back',back_mass(pixels))
     row_record['back_inference']='fill only between source side-strand extremes on each row; preserve the outer silhouette'
    if (sheet,index) in MANUAL_HEADS:row_record.update(manual_face_seed=list(MANUAL_HEADS[(sheet,index)][0]),manual_head_bounds=list(MANUAL_HEADS[(sheet,index)][1]))
    if (sheet,index) in HAIR_COLORS:row_record['source_hair_color']=HAIR_COLORS[(sheet,index)]
    if (sheet,index) in HAIR_ENDS:row_record['source_hair_end']=HAIR_ENDS[(sheet,index)]
    actual=skin if (sheet,index) in MANUAL_HEADS else np.max(np.abs(cell.astype('int16')-np.array(color)),axis=2)<24
    limit=np.zeros(actual.shape,bool);x0,y0,x1,y1=box;limit[y0:y1,x0:x1]=True;actual&=limit
    widths=np.count_nonzero(actual,axis=1);widths=widths[widths>max(5,(x1-x0)*.25)];row_record['skull_width']=float(np.percentile(widths,60)) if len(widths) else float(x1-x0)
    colored.append(row_record)
 manifest={'version':1,'previous':previous,'dot_faces':faces,'dots':dots,'elf_hair':elf_hair,'elf_eyes':eyecrop,'colored':colored}
 (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 card=Image.new('RGB',(1200,((len(colored)+7)//8)*170),'#d4dcd4');draw=ImageDraw.Draw(card)
 for i,r in enumerate(colored):
  im=Image.open(ROOT/r['source']).crop(r['crop']).convert('RGB');x0,y0,x1,y1=r['face_box'];w=x1-x0;crop=im.crop((max(0,x0-w*.65),max(0,y0-w*.8),min(im.width,x1+w*.65),min(im.height,y1+w*.8)));crop.thumbnail((145,135));x=i%8*150;y=i//8*170;card.paste(crop,(x+(150-crop.width)//2,y));draw.text((x+4,y+138),f'{r["sheet"]:02}-{r["index"]:02} {r["gender"]}',fill='black')
 card.save(OUT/'derived/color-head-analysis.png')
 if args.prepare_only:print('Prepared',len(colored),'earlier colour references');return
 trace_all(jobs,args)

def back_mass(pixels):
 mask=pixels[:,:,3]>127;mass=mask.copy()
 for row in mass:
  xs=np.flatnonzero(row)
  if len(xs)>1:row[xs[0]:xs[-1]+1]=True
 result=np.zeros_like(pixels);result[:,:,:3]=20;result[:,:,3]=mass.astype('uint8')*255
 return result

def cap_components(pixels,face):
 result=pixels.copy();n,labels,stats,_=cv2.connectedComponentsWithStats((pixels[:,:,3]>127).astype('uint8'))
 limit=face[1]+(face[3]-face[1])*.35
 for i,(_,y,_,_,_) in enumerate(stats):
  if i and y>limit:result[labels==i,3]=0
 return result

def trace_all(jobs,args):
 previous_traces={}
 tracefile=OUT/'vectorization.json'
 if tracefile.exists():previous_traces={r['svg']:r for r in json.loads(tracefile.read_text())['results']}
 def trace(job):
  source,svg,background=job;sha=hashlib.sha256(source.read_bytes()).hexdigest();key=str(svg.relative_to(OUT));old=previous_traces.get(key)
  if old and old['input_sha256']==sha and svg.exists():return old
  cmd=['uv','run','--script',str(DEFAULT_VECTORIZER.resolve()),str(source),'-o',str(svg),'--colors','8' if 'colour-' in source.stem else '3','--detail','.92','--smooth','.35','--background',background,'--lines','fill','--progress']
  r=subprocess.run(cmd,capture_output=True,text=True,check=True);describe_trace(svg)
  result=json.loads(r.stdout.splitlines()[-1]);result.update(input=str(source.relative_to(OUT)),input_sha256=sha,svg=key);return result
 with ThreadPoolExecutor(max_workers=args.jobs) as pool:
  result=[]
  for r in pool.map(trace,jobs):
   result.append(r);previous_traces[r['svg']]=r;tracefile.write_text(json.dumps({'tool':str(DEFAULT_VECTORIZER.resolve()),'settings':{'detail':.92,'smooth':.35,'lines':'fill'},'results':list(previous_traces.values())},indent=2)+'\n');print('Traced',r['svg'],flush=True)
 tracefile.write_text(json.dumps({'tool':str(DEFAULT_VECTORIZER.resolve()),'settings':{'detail':.92,'smooth':.35,'lines':'fill'},'results':result},indent=2)+'\n')
if __name__=='__main__':main()
