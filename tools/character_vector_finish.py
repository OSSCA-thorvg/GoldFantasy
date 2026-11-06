"""Bilateral head construction and uniform line roles for production vectors."""
import copy,sys
from pathlib import Path
import numpy as np
from scipy.interpolate import PchipInterpolator
from import_character_references import DEFAULT_VECTORIZER
sys.path.insert(0,str(DEFAULT_VECTORIZER.resolve().parent))
from vzlib.curvefit import fit_open,FitSettings

def mirror(parts):
    result=copy.deepcopy(parts)
    for part in result:
        for command in part['commands']:
            for axis in range(1,len(command),2):command[axis]=-command[axis]
    return result

def symmetric_face(face):
    f=copy.deepcopy(face);a=f['anchors']
    for i in range(1,13,2):
        radius=(abs(a[i][0])+abs(a[i+1][0]))*.5
        a[i][0],a[i+1][0]=-radius,radius
    roots=f['ear_roots'];radius=(abs(roots[0][0])+abs(roots[1][0]))*.5;y=(roots[0][1]+roots[1][1])*.5
    f['ear_roots']=[[-radius,y],[radius,y]];a[14:16]=copy.deepcopy(f['ear_roots'])
    for widths in f['scalp_widths']:
        r=sum(widths)*.5;widths[:]=[r,r]
    f['temple']=float((abs(a[3][0])+abs(a[4][0]))*.5)
    ys=np.array([-3.2]+[a[i][1] for i in range(2,14,2)]+[3.2])
    widths=np.array([0]+[a[i][0] for i in range(2,14,2)]+[0])
    angles=np.arccos(np.clip(-ys/3.2,-1,1));t=np.linspace(0,np.pi,160)
    right=np.c_[PchipInterpolator(angles,widths)(t),-3.2*np.cos(t)]*100
    segments=fit_open(right,FitSettings(.65,.6,80,3))
    # Fit one side only. Mirroring the actual Bezier handles gives exact
    # symmetry, including after skull/jaw interpolation, rather than two fits.
    halves=[]
    for s in segments:halves.append([list(np.array(p)/100) for p in (s.p0,s.c1,s.c2,s.p3)])
    halves[0][0]=[0.,-3.2];halves[0][1][1]=-3.2
    halves[-1][3]=[0.,3.2];halves[-1][2][1]=3.2
    commands=[['M',0.,-3.2]]
    for s in halves:commands.append(['C',*s[1],*s[2],*s[3]])
    for s in halves[::-1]:commands.append(['C',-s[2][0],s[2][1],-s[1][0],s[1][1],-s[0][0],s[0][1]])
    commands.append(['Z'])
    shape={'commands':commands,'tone':255,'stroke':0,'evenodd':False,'outline':True}
    f['paths']=[shape];f['coverage']={**copy.deepcopy(shape),'outline':False}
    f['ears'][1]=mirror(f['ears'][0]);f['bilateral']=True
    return f

def finish_parts(parts,kind):
    out=[]
    for original in parts:
        p=copy.deepcopy(original)
        if kind=='hair' and p['tone']<90:
            # Remaining filled ink ribbons are the scan's old edge, already
            # replaced by the mass outline. Tiny line scraps are not strands.
            if p['stroke']==0:continue
            xy=[v for c in p['commands'] for v in zip(c[1::2],c[2::2])]
            if xy and np.ptp(np.asarray(xy),axis=0).max()<.6:continue
        out.append(p)
    for p in out:
        p['outline']=bool(p['stroke']==0 and p['tone']>=(230 if kind=='ear' else 90) and kind!='back')
        if p['stroke']>0:p['stroke']=.055
    return out
