"""Generate a multi-resolution Windows ICO using only Python's standard library."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'build'
OUTLINE = [(50,56),(150,56),(188,94),(188,134),(156,158),(200,207),(140,207),(100,156),(100,207),(50,207)]
HOLE = [(100,100),(140,100),(151,115),(142,125),(100,125)]
STAR = [(204,22),(212,42),(233,50),(212,58),(204,78),(196,58),(175,50),(196,42)]

def inside(x, y, points):
    result = False
    j = len(points)-1
    for i, (px, py) in enumerate(points):
        qx, qy = points[j]
        if (py > y) != (qy > y) and x < (qx-px)*(y-py)/(qy-py)+px:
            result = not result
        j = i
    return result

def rgba(x,y):
    dx,dy=max(55-x,0,x-201),max(55-y,0,y-201)
    if dx*dx+dy*dy>55*55: return (0,0,0,0)
    if inside(x,y,STAR): return (255,114,204,255)
    if inside(x,y,OUTLINE) and not inside(x,y,HOLE): return (198,255,74,255)
    return (20,18,30,255)

def chunk(kind, data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))

def png(size):
    rows=[]
    for y in range(size):
        row=bytearray([0])
        for x in range(size):
            samples=[rgba((x+(a+.5)/3)*256/size,(y+(b+.5)/3)*256/size) for a in range(3) for b in range(3)]
            row.extend(round(sum(c[i] for c in samples)/9) for i in range(4))
        rows.append(row)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),9))+chunk(b'IEND',b'')

ROOT.mkdir(exist_ok=True)
sizes=[16,24,32,48,64,128,256]
images=[png(size) for size in sizes]
offset=6+16*len(sizes)
directory=[]
for size,data in zip(sizes,images):
    directory.append(struct.pack('<BBBBHHII',size%256,size%256,0,0,1,32,len(data),offset))
    offset+=len(data)
(ROOT/'icon.ico').write_bytes(struct.pack('<HHH',0,1,len(images))+b''.join(directory)+b''.join(images))
(ROOT/'icon.png').write_bytes(images[-1])
print('Generated build/icon.ico and build/icon.png')
