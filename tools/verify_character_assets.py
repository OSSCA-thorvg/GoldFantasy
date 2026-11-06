#!/usr/bin/env python3
"""Verify that the runtime costumes are copies of their source SVG geometry."""
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'docs/character-system/references'
TOKEN=re.compile(r'[MLCZ]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?')


def main():
    assets=json.loads((ROOT/'src/game/assets/characters/character-library.json').read_text())
    crops=json.loads((REF/'flat-crops.json').read_text())
    results=[]
    for outfit in assets['outfits']:
        row=next(r for r in crops if r['id']==outfit['id'])
        svg=ROOT/row['parts']['figure']['svg']
        nodes=[n for n in ET.parse(svg).getroot().iter() if n.tag.rsplit('}',1)[-1]=='path']
        assert len(nodes)==len(outfit['paths']),f'Costume path added or removed: {outfit["name"]}'
        scale=outfit['copy_transform']['scale'];origin=outfit['copy_transform']['origin']
        commands=0;compound=0;maximum_error=0
        for node,copied in zip(nodes,outfit['paths']):
            tokens=TOKEN.findall(node.attrib['d']);i=0;source=[]
            while i<len(tokens):
                op=tokens[i];i+=1;count={'M':2,'L':2,'C':6,'Z':0}[op]
                source.append([op]+[float(x) for x in tokens[i:i+count]]);i+=count
            assert len(source)==len(copied['commands'])
            compound+=sum(c[0]=='M' for c in source)>1
            for a,b in zip(source,copied['commands']):
                assert a[0]==b[0] and len(a)==len(b),'Costume topology changed'
                for j,(before,after) in enumerate(zip(a[1:],b[1:])):
                    error=abs(after-(before-origin[j%2])*scale);maximum_error=max(maximum_error,error)
                    assert error<.00001,'Costume was deformed instead of uniformly copied'
                commands+=1
            color=node.get('fill');assert color and color!='none','Costume should preserve filled contours'
            assert copied['tone']==int(color[1:3],16) and copied['stroke']==0,'Original costume fill changed'
            assert copied['evenodd']==(node.get('fill-rule')=='evenodd'),'Compound fill rule changed'
        results.append({'id':outfit['id'],'name':outfit['name'],'source_svg':str(svg.relative_to(ROOT)),
                        'paths':len(nodes),'commands':commands,'compound_paths':compound,
                        'maximum_coordinate_error':maximum_error,'result':'verbatim geometry; uniform placement only'})
    for ref in json.loads((REF.parent/'reference_manifest.json').read_text()):
        source=REF.parent/ref['file']
        assert hashlib.sha256(source.read_bytes()).hexdigest()==ref['sha256'],'Original reference image changed'
    destination=REF/'derived/outfit-copy-check.json';destination.write_text(json.dumps(results,indent=2)+'\n')
    print(f'{len(results)} copied costumes: original paths, subpaths, fills and 5 source image hashes verified.')
    hair_results=[]
    for i,head in enumerate(assets['heads']):
        svg=REF/'layers'/f'{i:02}-hair.svg'
        nodes=[n for n in ET.parse(svg).getroot().iter() if n.tag.rsplit('}',1)[-1]=='path']
        hair=head['hair'];registration=hair['registration'];scale=registration['scale'];offset=registration['offset']
        assert len(nodes)==len(hair['paths']),'Hair path topology changed after tracing'
        maximum_error=0
        for node,copied in zip(nodes,hair['paths']):
            tokens=TOKEN.findall(node.attrib['d']);at=0
            for command in copied['commands']:
                assert command[0]==tokens[at],'Hair was nonlinearly pre-warped'
                at+=1
                for axis,value in enumerate(command[1:]):
                    error=abs(value-(float(tokens[at])*scale+offset[axis%2]));at+=1
                    maximum_error=max(error,maximum_error)
                    assert error<.00001,'Rest hair no longer preserves its source proportions'
            assert at==len(tokens)
        hair_results.append({'index':i,'name':head['name'],'source_svg':str(svg.relative_to(ROOT)),
                             'maximum_coordinate_error':maximum_error,'result':'similarity transform only; no baked nonlinear warp'})
    (REF/'derived/hair-source-check.json').write_text(json.dumps(hair_results,indent=2)+'\n')
    print('19 original wigs: archived rest curves preserve their source proportions. Run verify_character_pool.py for the current retraces.')


if __name__=='__main__':main()
