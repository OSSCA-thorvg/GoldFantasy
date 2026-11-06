# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "opencv-python-headless", "Pillow"]
# ///
"""Trace clean colour masses and interior lines; retain the source scans separately."""
import argparse, hashlib, json, subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from import_character_references import DEFAULT_VECTORIZER

ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'docs/character-system/references'
OUT=REF/'pool/clean'
SETTINGS={'detail':.55,'smooth':.9,'lines':'stroke','outerStroke':.075,'innerStroke':.055}

def bun_regions(source):
    rgba=np.array(Image.open(source).convert('RGBA'));gray=cv2.cvtColor(rgba[:,:,:3],cv2.COLOR_RGB2GRAY)
    alpha=rgba[:,:,3]>127
    # Original ink separates the bun from the cap. Erosion removes the thin
    # antialiased grey halo that otherwise joins their colour components.
    colour=cv2.erode(((gray>65)&(gray<190)&alpha).astype('uint8'),np.ones((3,3),'uint8'))
    n,labels,stats,_=cv2.connectedComponentsWithStats(colour)
    largest=sorted(range(1,n),key=lambda i:int(stats[i,cv2.CC_STAT_AREA]),reverse=True)[:2]
    assert len(largest)==2
    tied,cap=sorted(largest,key=lambda i:int(stats[i,cv2.CC_STAT_TOP]))
    distances=[cv2.distanceTransform((labels!=i).astype('uint8'),cv2.DIST_L2,5) for i in (cap,tied)]
    result=[]
    for i in range(2):
        part=rgba.copy();part[:,:,3]=(alpha&(distances[i]<=distances[1-i]+1.5)).astype('uint8')*255
        result.append(part)
    return result

def curtain_region(source):
    rgba=np.array(Image.open(source).convert('RGBA'));alpha=rgba[:,:,3]>127
    n,labels,stats,_=cv2.connectedComponentsWithStats(alpha.astype('uint8'))
    for i in range(1,n):
        if stats[i,cv2.CC_STAT_AREA]<max(4,np.count_nonzero(alpha)*.00015):alpha[labels==i]=False
    # Keep the authored outer locks; close the obsolete face opening behind them.
    for row in alpha:
        xs=np.flatnonzero(row)
        if len(xs):row[xs[0]:xs[-1]+1]=True
    rgba[:,:,:3]=112;rgba[:,:,3]=alpha.astype('uint8')*255
    return rgba

def prepare(source,kind):
    rgba=np.array(Image.open(source).convert('RGBA'))
    alpha=rgba[:,:,3]>127
    n,labels,stats,_=cv2.connectedComponentsWithStats(alpha.astype('uint8'))
    threshold=max(4,int(np.count_nonzero(alpha)*.00015))
    for i in range(1,n):
        if stats[i,cv2.CC_STAT_AREA]<threshold:alpha[labels==i]=False
    n,labels,stats,_=cv2.connectedComponentsWithStats((~alpha).astype('uint8'))
    for i,(x,y,w,h,area) in enumerate(stats):
        if i and area<8 and x>0 and y>0 and x+w<alpha.shape[1] and y+h<alpha.shape[0]:alpha[labels==i]=True
    result=np.zeros_like(rgba)
    result[:,:,:3]=255 if kind=='ear' else 20 if kind=='back' else 112
    if kind not in ('back','curtain') and alpha.any():
        gray=cv2.cvtColor(rgba[:,:,:3],cv2.COLOR_RGB2GRAY)
        # Source edge ink is replaced by one real stroke. Only ink safely
        # inside a colour mass can become an interior strand/ear line.
        distance=cv2.distanceTransform(alpha.astype('uint8'),cv2.DIST_L2,5)
        interior=(gray<65)&alpha&(distance>2.5)
        if kind=='hair' and np.median(gray[alpha])<65:interior[:]=False
        n,labels,stats,_=cv2.connectedComponentsWithStats(interior.astype('uint8'))
        for i in range(1,n):
            if stats[i,cv2.CC_STAT_AREA]<5:interior[labels==i]=False
        result[interior,:3]=20
    result[:,:,3]=alpha.astype('uint8')*255
    return result

def main():
    p=argparse.ArgumentParser();p.add_argument('--only',nargs='*');p.add_argument('--jobs',type=int,default=3);a=p.parse_args()
    OUT.mkdir(exist_ok=True);m=json.loads((REF/'pool/manifest.json').read_text());jobs=[]
    for i,row in enumerate(m['previous']):
        for kind in ['hair','back']:jobs.append((f'original-{i:02}-{kind}',REF/'pool'/row[kind]['png'],kind))
    for i in range(19):jobs.append((f'ear-{i:02}',REF/'layers'/f'{i:02}-ear-L.png','ear'))
    for i,row in enumerate(m['dot_faces']):jobs.append((f'ear-{i+19:02}',REF/'pool'/row['ears'][0]['png'],'ear'))
    jobs.append(('elf-hair',REF/'pool'/m['elf_hair']['png'],'hair'))
    parent=REF/'pool'/m['previous'][16]['hair']['png'];regions=OUT/'regions';regions.mkdir(exist_ok=True);derived={}
    def provenance(source,parent,method):
        derived[source]={'parentSource':str(parent.relative_to(ROOT)),'parentSourceSha256':hashlib.sha256(parent.read_bytes()).hexdigest(),'segmentation':method}
    for name,pixels in zip(('cap','tied'),bun_regions(parent)):
        source=regions/f'original-16-{name}.png';Image.fromarray(pixels).save(source)
        provenance(source,parent,'source grey regions separated by original ink; nearest-region assignment with hidden overlap')
        jobs.append((f'original-16-{name}',source,'hair'))
    for name,record in [(f'original-{i:02}',m['previous'][i]['hair']) for i in (1,6,11,12)]+[('elf',m['elf_hair'])]:
        parent=REF/'pool'/record['png'];source=regions/f'{name}-curtain.png'
        Image.fromarray(curtain_region(parent)).save(source)
        provenance(source,parent,'original outer hair silhouette; horizontal rear coverage closes the source face opening without importing a skull contour')
        jobs.append((f'{name}-curtain',source,'curtain'))
    if a.only:jobs=[job for job in jobs if job[0] in a.only]
    file=OUT/'manifest.json';manifest=json.loads(file.read_text()) if file.exists() else {'tool':str(DEFAULT_VECTORIZER.resolve()),'settings':SETTINGS,'results':{}}
    def trace(job):
        name,source,kind=job;png=OUT/(name+'.png');svg=OUT/(name+'.svg');Image.fromarray(prepare(source,kind)).save(png)
        sha=hashlib.sha256(png.read_bytes()).hexdigest();key=str(source.relative_to(ROOT));old=manifest['results'].get(key)
        parent_info=derived.get(source,{})
        if old and old['inputSha256']==sha and old.get('settings')==SETTINGS and svg.exists():return key,{**old,**parent_info,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest()}
        command=['uv','run','--script',str(DEFAULT_VECTORIZER.resolve()),str(png),'-o',str(svg),'--colors','2','--detail',str(SETTINGS['detail']),'--smooth',str(SETTINGS['smooth']),'--lines','stroke','--background','keep','--progress']
        subprocess.run(command,check=True,capture_output=True,text=True)
        return key,{'kind':kind,'source':key,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'input':str(png.relative_to(ROOT)),'inputSha256':sha,'svg':str(svg.relative_to(ROOT)),'settings':SETTINGS,**parent_info}
    with ThreadPoolExecutor(max_workers=a.jobs) as pool:
        for key,row in pool.map(trace,jobs):
            manifest['results'][key]=row;file.write_text(json.dumps(manifest,indent=2)+'\n');print('Cleaned',key,flush=True)

if __name__=='__main__':main()
