import cv2
import json
import numpy as np
import sys

path = sys.argv[1]
cap = cv2.VideoCapture(path)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
step = max(1, int(fps * 0.5))
brightness, saturation, edge, diff = [], [], [], []
previous = None
index = 0
samples = 0
while index < frame_count:
    cap.set(cv2.CAP_PROP_POS_FRAMES, index)
    ok, frame = cap.read()
    if not ok:
        break
    frame = cv2.resize(frame, (320, 180))
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    brightness.append(float(gray.mean() / 255))
    saturation.append(float(hsv[:, :, 1].mean() / 255))
    edge.append(float((cv2.Canny(gray, 70, 140) > 0).mean()))
    if previous is not None:
        diff.append(float(np.mean(np.abs(gray.astype(np.float32) - previous.astype(np.float32))) / 255))
    previous = gray
    samples += 1
    index += step
print(json.dumps({
    "duration": frame_count / fps,
    "samples": samples,
    "brightness_mean": float(np.mean(brightness)),
    "brightness_median": float(np.median(brightness)),
    "saturation_mean": float(np.mean(saturation)),
    "edge_mean": float(np.mean(edge)),
    "motion_mean": float(np.mean(diff)),
    "motion_median": float(np.median(diff)),
    "low_motion_share": float(np.mean(np.array(diff) < 0.02)),
    "high_motion_share": float(np.mean(np.array(diff) > 0.08)),
}))
