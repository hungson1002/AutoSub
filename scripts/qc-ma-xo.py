import cv2, numpy as np, json, sys
p = sys.argv[1] if len(sys.argv) > 1 else r'tmp/ma-xo-pilot/ma-xo-pilot.mp4'
cap=cv2.VideoCapture(p)
fps=cap.get(cv2.CAP_PROP_FPS) or 30
frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
dur=frames/fps
sample_step=max(1,int(round(fps/2)))
prev=None; diffs=[]; br=[]; sat=[]; edge=[]; idx=0
while True:
    ok, frame=cap.read()
    if not ok: break
    if idx % sample_step == 0:
        small=cv2.resize(frame,(160,90),interpolation=cv2.INTER_AREA)
        hsv=cv2.cvtColor(small,cv2.COLOR_BGR2HSV)
        gray=cv2.cvtColor(small,cv2.COLOR_BGR2GRAY)
        br.append(float(gray.mean()/255))
        sat.append(float(hsv[:,:,1].mean()/255))
        ed=cv2.Canny(gray,70,140)
        edge.append(float((ed>0).mean()))
        if prev is not None:
            diffs.append(float(np.mean(np.abs(gray.astype(np.float32)-prev.astype(np.float32)))/255))
        prev=gray
    idx+=1
cap.release()
a=np.array(diffs) if diffs else np.array([0.0])
out={
    'duration':dur,
    'motion_mean':float(a.mean()),
    'motion_median':float(np.median(a)),
    'motion_p75':float(np.quantile(a,.75)),
    'motion_p90':float(np.quantile(a,.9)),
    'motion_p95':float(np.quantile(a,.95)),
    'low_motion_share':float((a<.02).mean()),
    'high_motion_share':float((a>.08).mean()),
    'brightness_mean':float(np.mean(br)),
    'brightness_median':float(np.median(br)),
    'saturation_mean':float(np.mean(sat)),
    'edge_density_mean':float(np.mean(edge)),
}
print(json.dumps(out,indent=2))
