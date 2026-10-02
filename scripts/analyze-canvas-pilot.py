import cv2, numpy as np, sys, json
p=sys.argv[1]
cap=cv2.VideoCapture(p)
fps=cap.get(cv2.CAP_PROP_FPS) or 30
step=max(1,int(round(fps/2)))
frames=[]
brightness=[]
edges=[]
i=0
while True:
    ok, frame=cap.read()
    if not ok: break
    if i%step==0:
        small=cv2.resize(frame,(160,90))
        gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
        frames.append(gray)
        brightness.append(float(gray.mean()/255.0))
        e=cv2.Canny(gray,60,140)
        edges.append(float((e>0).mean()))
    i+=1
cap.release()
diffs=[]
for a,b in zip(frames,frames[1:]):
    diffs.append(float(cv2.absdiff(a,b).mean()/255.0))
a=np.asarray(diffs)
print(json.dumps({
  "samples":len(frames),
  "brightness_mean":float(np.mean(brightness)),
  "brightness_median":float(np.median(brightness)),
  "edge_mean":float(np.mean(edges)),
  "edge_median":float(np.median(edges)),
  "motion_mean":float(np.mean(a)) if len(a) else 0,
  "motion_median":float(np.median(a)) if len(a) else 0,
  "motion_p90":float(np.percentile(a,90)) if len(a) else 0,
  "low_motion_share":float(np.mean(a<0.02)) if len(a) else 0,
  "high_motion_share":float(np.mean(a>0.08)) if len(a) else 0
},indent=2))
