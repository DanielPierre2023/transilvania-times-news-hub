"""
Shot-matching grade — prototype.

The failure both films shared: every shot came back a different colour, and
nothing corrected it after assembly. Professional colour is decided ONCE over
the finished cut, matching every shot to a single look. That is a deterministic
image operation, not a prompt.

Correct implementation detail that matters: sRGB is not linear. Averaging and
scaling in sRGB skews toward the mids and desaturates. Everything here converts
to linear light, corrects, and converts back.
"""
import subprocess, json, math, sys
from PIL import Image
import numpy as np

def srgb_to_linear(x):
    a = 0.055
    return np.where(x <= 0.04045, x / 12.92, ((x + a) / (1 + a)) ** 2.4)

def linear_to_srgb(x):
    a = 0.055
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, (1 + a) * x ** (1 / 2.4) - a)

def frame(path, t, w=240):
    out = f"/tmp/grade/_f_{str(t).replace('.','_')}.png"
    subprocess.run(["ffmpeg","-v","error","-ss",str(t),"-i",path,"-frames:v","1",
                    "-vf",f"scale={w}:-1",out,"-y"], check=True)
    return np.asarray(Image.open(out).convert("RGB"), dtype=np.float64) / 255.0

def stats(rgb_srgb):
    """Trimmed mean in LINEAR light. Trimming drops specular highlights and
    crushed blacks, which otherwise drag the estimate around."""
    lin = srgb_to_linear(rgb_srgb).reshape(-1, 3)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    lo, hi = np.percentile(lum, [10, 90])
    keep = lin[(lum >= lo) & (lum <= hi)]
    if len(keep) < 50:
        keep = lin
    return keep.mean(axis=0)

# Golden-hour daylight target, expressed as a chromaticity ratio and then
# normalised so applying it never changes overall luminance.
TARGET = np.array([1.16, 1.00, 0.74])
TARGET = TARGET / (TARGET @ np.array([0.2126, 0.7152, 0.0722]))

def gains_for(mean_lin, strength=1.0, clamp=(0.45, 2.6)):
    lum = mean_lin @ np.array([0.2126, 0.7152, 0.0722])
    desired = TARGET * lum
    g = desired / np.maximum(mean_lin, 1e-6)
    g = 1.0 + (g - 1.0) * strength
    return np.clip(g, *clamp)

def shots(path, n, dur):
    step = dur / n
    return [(i * step, (i + 1) * step) for i in range(n)]

if __name__ == "__main__":
    src, nshots = sys.argv[1], int(sys.argv[2])
    dur = float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
        "-of","default=nw=1:nk=1",src], capture_output=True, text=True).stdout.strip())
    print(f"source: {dur:.2f}s, {nshots} shots\n")
    print(f"{'shot':>4} {'mean linear RGB':>26}  {'gains R/G/B':>22}   before B-R   after B-R")
    report = []
    for i,(a,b) in enumerate(shots(src, nshots, dur)):
        mid = (a + b) / 2
        m = stats(frame(src, mid))
        g = gains_for(m)
        after = m * g
        s_before = linear_to_srgb(m) * 255
        s_after = linear_to_srgb(after) * 255
        print(f"{i+1:>4} {m[0]:8.4f}{m[1]:9.4f}{m[2]:9.4f}   "
              f"{g[0]:6.3f}{g[1]:7.3f}{g[2]:7.3f}   "
              f"{s_before[2]-s_before[0]:+9.1f}   {s_after[2]-s_after[0]:+9.1f}")
        report.append({"shot": i+1, "start": a, "end": b, "gains": list(g)})
    json.dump(report, open("/tmp/grade/plan.json","w"), indent=1)
    print("\nplan written")
