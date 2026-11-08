"""Bounded triangle deformation and premultiplied-alpha texture sampling."""
import math
import numpy as np


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def legacy_arm_weights(points, pose):
    x, y = np.asarray(points).T
    hx, hy = pose["hand"]
    ex, ey = np.mean(np.asarray(pose["eyes"])[:, :2], axis=0)
    influence = np.exp(-.5 * (((x - hx) / 85) ** 2 + ((y - hy) / 95) ** 2))
    protect = smooth((np.hypot((x - ex) / 75, (y - ey) / 57) - 1) / .6)
    return influence * protect * smooth((x - ex + 85) / 50) * (1 - smooth((y - 380) / 42))


def polygon_contains(points, polygon):
    points=np.asarray(points,dtype=float);polygon=np.asarray(polygon,dtype=float)
    if polygon.ndim!=2 or polygon.shape[1]!=2 or len(polygon)<3 or not np.isfinite(polygon).all():
        raise ValueError("An authored rig domain needs a finite polygon.")
    x,y=points.T;inside=np.zeros(len(points),dtype=bool)
    on_edge=np.zeros(len(points),dtype=bool)
    for a,b in zip(polygon,np.roll(polygon,-1,axis=0)):
        edge=b-a;cross=(x-a[0])*edge[1]-(y-a[1])*edge[0]
        on_edge|=(np.abs(cross)<=1e-8)&(x>=min(a[0],b[0])-1e-8)&(x<=max(a[0],b[0])+1e-8)&(y>=min(a[1],b[1])-1e-8)&(y<=max(a[1],b[1])+1e-8)
        crossing=(a[1]>y)!=(b[1]>y)
        boundary=a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1] if b[1]!=a[1] else 1)
        inside^=crossing&(x<boundary)
    return inside|on_edge


def arm_weights(points, pose):
    """No guessed anatomy: a cel without an authored arm domain remains rigid.

    New live animation uses articulated parts or skinned 3D surfaces. The old
    Gaussian is retained only for historical numerical comparisons.
    """
    points=np.asarray(points,dtype=float);domain=pose.get("rig_domains",{}).get("arm")
    if domain is None:return np.zeros(len(points),dtype=float)
    mask=polygon_contains(points,domain["polygon"])
    for protected in pose.get("rig_domains",{}).get("protected_polygons",[]):mask&=~polygon_contains(points,protected)
    return legacy_arm_weights(points,pose)*mask


def areas(points, triangles):
    a, b, c = (points[triangles[:, i]] for i in range(3))
    return (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])


class MotionCurve:
    def __init__(self, keys, poses, duration, source_rate=24):
        nodes = []
        for i, key in enumerate(keys):
            t = key["source_frame"] / source_rate
            end = keys[i + 1]["source_frame"] / source_rate if i + 1 < len(keys) else duration
            hand = np.asarray(poses[key["pose_id"]]["hand"], dtype=float)
            if end - t > 25 / 60:
                nodes.extend([(t + 10 / 60 if i else t, hand), (end - 15 / 60, hand)])
            else:
                nodes.append(((t + end - 1 / 60) / 2, hand))
        nodes.append((duration - 1 / 60, np.asarray(poses[keys[-1]["pose_id"]]["hand"])))
        self.nodes = nodes
        self.tangents = []
        for i, (t, hand) in enumerate(nodes):
            tangent = np.zeros(2)
            if 0 < i < len(nodes) - 1:
                a = (hand - nodes[i - 1][1]) / (t - nodes[i - 1][0])
                b = (nodes[i + 1][1] - hand) / (nodes[i + 1][0] - t)
                valid = a * b > 0
                tangent[valid] = 2 * a[valid] * b[valid] / (a[valid] + b[valid])
            self.tangents.append(tangent)

    def at(self, time):
        i = 0
        while i < len(self.nodes) - 2 and self.nodes[i + 1][0] < time:
            i += 1
        a, b = self.nodes[i], self.nodes[i + 1]
        d = b[0] - a[0]
        t = float(np.clip((time - a[0]) / d, 0, 1))
        return (2 * t ** 3 - 3 * t * t + 1) * a[1] + (t ** 3 - 2 * t * t + t) * d * self.tangents[i] + (-2 * t ** 3 + 3 * t * t) * b[1] + (t ** 3 - t * t) * d * self.tangents[i + 1]


class CelMesh:
    def __init__(self, rgba, pose, scale, max_offset=45, minimum_ratio=.4):
        height, width = rgba.shape[:2]
        xs = sorted(set([0, width, pose["hand"][0], *range(16, width, 16)]))
        ys = sorted(set([0, height, pose["hand"][1], *range(16, height, 16)]))
        self.points = np.asarray([(x, y) for y in ys for x in xs], dtype=np.float64)
        triangles = []
        for j in range(len(ys) - 1):
            for i in range(len(xs) - 1):
                # Full-pixel occupancy avoids missing a thin strand between sample rows.
                if np.any(rgba[int(ys[j]): min(height, math.ceil(ys[j + 1]) + 1), int(xs[i]): min(width, math.ceil(xs[i + 1]) + 1), 3]):
                    a = j * len(xs) + i
                    triangles.extend([(a, a + 1, a + len(xs)), (a + 1, a + len(xs) + 1, a + len(xs))])
        self.triangles = np.asarray(triangles, dtype=int)
        self.original_areas = areas(self.points, self.triangles)
        normal = float(arm_weights([pose["hand"]], pose)[0])
        self.weights = arm_weights(self.points, pose) / normal if normal > .01 else np.zeros(len(self.points))
        self.pose = pose
        self.scale = scale
        self.size = (math.ceil(width * scale), math.ceil(height * scale))
        self.max_offset = max_offset
        self.minimum_ratio = minimum_ratio
        self.hand_index = np.flatnonzero(np.all(self.points == pose["hand"], axis=1))[0]
        self.cache_key = None

    def mapping(self, target):
        target=np.asarray(target,dtype=float)
        if target.shape!=(2,) or not np.isfinite(target).all():
            raise ValueError("A hand target must contain two finite coordinates.")
        offset = target - self.pose["hand"]
        length = float(np.linalg.norm(offset))
        delta = offset * min(1, self.max_offset / max(length, 1e-12))
        supported=bool(np.any(self.weights))
        if not supported:delta=np.zeros(2,dtype=float)
        safety = 1.
        for _ in range(100):
            positions = self.points + self.weights[:, None] * delta
            ratio = float(np.min(areas(positions, self.triangles) / self.original_areas))
            if ratio >= self.minimum_ratio:
                break
            safety *= .85
            delta *= .85
        else:
            raise ValueError("Cannot preserve triangle orientation.")
        key = tuple(delta)
        if key != self.cache_key:
            width, height = self.size
            sx = np.full((height, width), -1, dtype=np.float32)
            sy = np.full_like(sx, -1)
            for ids in self.triangles:
                source = self.points[ids]
                A, B, C = positions[ids] * self.scale
                d = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])
                x0, x1 = max(0, math.floor(min(A[0], B[0], C[0]))), min(width, math.ceil(max(A[0], B[0], C[0])))
                y0, y1 = max(0, math.floor(min(A[1], B[1], C[1]))), min(height, math.ceil(max(A[1], B[1], C[1])))
                if x1 <= x0 or y1 <= y0:
                    continue
                y, x = np.mgrid[y0:y1, x0:x1].astype(np.float32) + .5
                w0 = ((B[0] - x) * (C[1] - y) - (B[1] - y) * (C[0] - x)) / d
                w1 = ((C[0] - x) * (A[1] - y) - (C[1] - y) * (A[0] - x)) / d
                w2 = 1 - w0 - w1
                valid = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
                xx = w0 * source[0, 0] + w1 * source[1, 0] + w2 * source[2, 0] - .5
                yy = w0 * source[0, 1] + w1 * source[1, 1] + w2 * source[2, 1] - .5
                sx[y0:y1, x0:x1][valid] = xx[valid]
                sy[y0:y1, x0:x1][valid] = yy[valid]
            valid = sx > -1
            self.output_indices = np.flatnonzero(valid)
            self.sx, self.sy = sx[valid], sy[valid]
            self.cache_key = key
        return {"delta": delta.tolist(), "minimum_triangle_area_ratio": ratio,
                "limited": length > self.max_offset or safety < 1 or (not supported and length>1e-9),
                "hand_target_supported":supported,"authored_geometry_preserved":not supported,
                "requested_hand":target.tolist(),"domain_policy":"authored arm minus protected polygons; rigid when missing",
                "hand": positions[self.hand_index].tolist()}

    def sample(self, texture):
        # Premultiplication excludes hidden RGB in transparent pixels from the edge filter.
        height, width = texture.shape[:2]
        x, y = np.clip(self.sx, 0, width - 1), np.clip(self.sy, 0, height - 1)
        ix, iy = x.astype(int), y.astype(int)
        bx, by = np.minimum(ix + 1, width - 1), np.minimum(iy + 1, height - 1)
        u, v = x - ix, y - iy
        premult = texture.astype(np.float32)
        premult[:, :, :3] *= premult[:, :, 3:4] / 255
        sample = np.zeros((len(x), 4), dtype=np.float32)
        for xx, yy, weight in [(ix, iy, (1-u)*(1-v)), (bx, iy, u*(1-v)), (ix, by, (1-u)*v), (bx, by, u*v)]:
            sample += premult[yy, xx] * weight[:, None]
        alpha = sample[:, 3:4]
        sample[:, :3] = np.divide(sample[:, :3] * 255, alpha, out=np.zeros_like(sample[:, :3]), where=alpha > .1)
        out = np.zeros((self.size[1] * self.size[0], 4), dtype=np.uint8)
        out[self.output_indices] = np.rint(np.clip(sample, 0, 255)).astype(np.uint8)
        return out.reshape(self.size[1], self.size[0], 4)
