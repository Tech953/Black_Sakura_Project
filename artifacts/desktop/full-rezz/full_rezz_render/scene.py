"""Qt raster compositing with held body motion and continuous face/camera layers."""
import math
import os
from fractions import Fraction
import numpy as np
from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QImage, QPainter, QFont, QFontDatabase, QGuiApplication, QColor, QLinearGradient
from .project import local_file
from .rig import CelMesh, MotionCurve, smooth

BLINKS = [2.45, 4.88, 6.48, 8.04, 10.55]
_application = None


def initialize_qt():
    global _application
    if QGuiApplication.instance() is None:
        # No WebEngine, browser, window, network or model download is involved.
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        _application = QGuiApplication([])


def array(image):
    image = image.convertToFormat(QImage.Format.Format_RGBA8888)
    return np.frombuffer(image.bits(), dtype=np.uint8, count=image.height() * image.bytesPerLine()).reshape(image.height(), image.bytesPerLine())[:, :image.width()*4].reshape(image.height(), image.width(), 4).copy()


def image(rgba):
    rgba = np.ascontiguousarray(rgba, dtype=np.uint8)
    return QImage(rgba.data, rgba.shape[1], rgba.shape[0], rgba.strides[0], QImage.Format.Format_RGBA8888).copy()


def ellipse_mask(size, ellipse):
    y, x = np.mgrid[0:size[1], 0:size[0]]
    return (((x + .5 - ellipse[0]) / ellipse[2]) ** 2 + ((y + .5 - ellipse[1]) / ellipse[3]) ** 2) <= 1


def drive_states(speech, offset, fps, count):
    samples = np.frombuffer(speech, dtype="<i2").astype(np.float64) / 32768
    duration = len(samples) / 24000
    rms = []
    for t in np.arange(math.ceil(duration * 120) + 1) / 120:
        end = min(len(samples), round(t * 24000))
        start = max(0, end - 720)
        rms.append(float(np.sqrt(np.mean(samples[start:end] ** 2))) if end > start else 0)
    rms = np.asarray(rms)
    gate = 10 ** (-44 / 20)
    valid = rms[rms > gate]
    ceiling = float(np.percentile(valid, 95)) if len(valid) else gate + 1
    targets = np.clip((rms - gate) / max(ceiling - gate, 1e-10), 0, 1) ** .75
    envelope, previous = [], 0.
    for target in targets:
        tau = .02 if target > previous else .055
        previous += (1 - math.exp(-1 / (120 * tau))) * (target - previous)
        if previous < .015 and target == 0:
            previous = 0.
        envelope.append(previous)
    apertures, states, energies = [], [], []
    drive = 0.
    state = 0
    for i in range(count):
        relative = Fraction(i, fps) - Fraction(str(offset))
        t = float(relative)
        active = 0 <= relative < Fraction(len(samples), 24000)
        energy = 0.
        if active:
            start, end = max(0, math.floor((t - .035) * 120)), min(len(envelope) - 1, math.ceil((t + .035) * 120))
            energy = float(np.mean(envelope[start:end+1]))
        tau = .045 if energy > drive else .070
        drive += (energy - drive) * (1 - math.exp(-1 / (fps * tau)))
        if not active:
            drive = 0.
            state = 0
        elif drive < .09:
            state = 0
        elif drive > .50 or (state == 2 and drive > .30):
            state = 2
        else:
            state = 1
        energies.append(energy)
        states.append(state)
        apertures.append(min(1., max(.15, .35 + drive * .75)) if state else 0.)
    return states, apertures, energies


def blink(t):
    for center in BLINKS:
        d = t - (center - .125)
        if 0 <= d < .25:
            return float(smooth(d/.075)) if d < .075 else 1. if d < .15 else float(1-smooth((d-.15)/.1))
    return 0.


class Scene:
    def __init__(self, project):
        initialize_qt()
        self.project = project
        preset = project.preset
        self.width, self.height = preset["width"], preset["height"]
        self.factor = self.width / 1280 * preset["supersampling"]
        self.internal = (self.width * preset["supersampling"], self.height * preset["supersampling"])
        self.texture_scale = self.factor * 1.06
        self.curve = MotionCurve(project.clock.keys, project.poses, float(project.clock.duration), float(project.clock.rate))
        self.states, self.apertures, self.energies = drive_states(project.speech, project.offset, project.clock.fps, project.clock.frames)
        self.base, self.face, self.meshes, self.protected = {}, {}, {}, {}
        for pose in project.poses.values():
            base = QImage(str(local_file(project.root, pose["base"])))
            face = QImage(str(local_file(project.root, pose["face"])))
            if base.isNull() or face.isNull() or (base.width(), base.height(), face.width(), face.height()) != (496, 544, 496, 544):
                raise ValueError("An authored cel must decode to 496 × 544 pixels.")
            self.base[pose["id"]] = base
            self.face[pose["id"]] = face
            rgba = array(base)
            self.meshes[pose["id"]] = CelMesh(rgba, pose, self.texture_scale,
                project.config["audit"]["maximum_arm_offset_source_pixels"], project.config["audit"]["minimum_triangle_area_ratio"])
            # Rim lights do not repaint the inner face, eyes, mouth, or held prop.
            protected = ellipse_mask((496,544), [np.mean(np.asarray(pose["eyes"])[:,0]), np.mean(np.asarray(pose["eyes"])[:,1])+8, 59, 47])
            protected[:, :185] = True
            self.protected[pose["id"]] = protected
        background = QImage(str(local_file(project.root, "assets/background.png")))
        if background.isNull() or background.width() > 8192 or background.height() > 8192:
            raise ValueError("Background failed decoding or exceeds the size limit.")
        self.background = background.scaled(*self.internal, Qt.AspectRatioMode.IgnoreAspectRatio, Qt.TransformationMode.SmoothTransformation)
        self.static = QImage(*self.internal, QImage.Format.Format_RGBA8888)
        self.static.fill(QColor("#132220"))
        painter = QPainter(self.static)
        painter.drawImage(0, 0, self.background)
        painter.scale(self.factor, self.factor)
        painter.fillRect(QRectF(0,0,1280,720), QColor(6,20,22,45))
        gradient = QLinearGradient(0,0,0,720)
        gradient.setColorAt(0,QColor(8,22,24,35)); gradient.setColorAt(.62,QColor(8,20,20,0)); gradient.setColorAt(1,QColor(8,16,21,140))
        painter.fillRect(QRectF(0,0,1280,720), gradient)
        painter.setPen(Qt.PenStyle.NoPen); painter.setBrush(QColor(7,20,17,72)); painter.drawEllipse(QRectF(518,607,244,26)); painter.end()
        families = []
        for name in ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"]:
            fid = QFontDatabase.addApplicationFont(str(local_file(project.root, "assets/fonts/" + name)))
            if fid < 0:
                raise ValueError("Bundled font failed to load.")
            families.extend(QFontDatabase.applicationFontFamilies(fid))
        self.family = families[0]
        self.last_pose = None

    def face_texture(self, pose, aperture, closed):
        rgba = array(self.base[pose["id"]])
        original_face = array(self.face[pose["id"]])
        if aperture > 0:
            e = pose["mouth"]
            y, x = np.mgrid[0:544,0:496]
            sy = np.rint(e[1] + (y-e[1]) / max(.15,aperture)).astype(int)
            valid = ellipse_mask((496,544), e) & (sy >= 0) & (sy < 544)
            # Alpha blending, rather than RGB-only replacement, preserves source opacity.
            patch = original_face[np.clip(sy,0,543), x]
            rgba[valid] = patch[valid]
        if closed:
            y, _ = np.mgrid[0:544,0:496]
            for e in pose["eyes"]:
                mask = ellipse_mask((496,544),e) & ((y+.5) <= e[1]-e[3]+2*e[3]*closed)
                rgba[mask] = original_face[mask]
        return rgba

    def light_texture(self, rgba, pose):
        cfg = self.project.config["lighting"]
        if not cfg["enabled"]:
            return rgba
        alpha = rgba[:,:,3].astype(np.float32)/255
        delta = max(1, round(cfg["edge_width_source_pixels"]))
        left, right = np.zeros_like(alpha), np.zeros_like(alpha)
        left[:,delta:] = alpha[:,:-delta]; right[:,:-delta] = alpha[:,delta:]
        exposed = (~self.protected[pose["id"]]).astype(float)
        warm = np.maximum(alpha-left,0) * cfg["warm_strength"] * exposed
        cool = np.maximum(alpha-right,0) * cfg["cool_strength"] * exposed
        weight = (warm+cool)[:,:,None]
        rgb = rgba[:,:,:3] * (1-weight) + warm[:,:,None] * np.asarray(cfg["warm_rgb"]) + cool[:,:,None] * np.asarray(cfg["cool_rgb"])
        out = rgba.copy(); out[:,:,:3] = np.rint(np.clip(rgb,0,255)).astype(np.uint8)
        return out

    def render(self, index):
        clock = self.project.clock.at(index)
        pose = self.project.poses[clock["pose_id"]]
        mesh = self.meshes[pose["id"]]
        if self.last_pose != pose["id"]:
            if self.last_pose is not None:
                previous = self.meshes[self.last_pose]
                previous.cache_key = None
                for field in ["sx", "sy", "output_indices"]:
                    if hasattr(previous, field): delattr(previous, field)
            self.last_pose = pose["id"]
        t = index / self.project.clock.fps
        breath = 1 + .0025 * math.sin(clock["body_time"] * math.pi * 1.12)
        rig_mode=self.project.config.get("rig",{}).get("mode","authored_cels")
        if rig_mode not in ("authored_cels","semantic_arm"):raise ValueError("Unsupported cel rig mode.")
        if rig_mode=="semantic_arm" and not pose.get("rig_domains",{}).get("arm"):raise ValueError("Semantic arm animation needs an authored arm domain for this pose.")
        mapping = mesh.mapping(pose["hand"] if rig_mode=="authored_cels" else self.curve.at(clock["body_time"]))
        face = self.face_texture(pose, self.apertures[index], blink(t))
        actor = image(mesh.sample(self.light_texture(face, pose)))
        push = 1 + self.project.config["camera"]["push_fraction"] * float(smooth(t / float(self.project.clock.duration)))
        pivot = self.project.config["camera"]["pivot"]
        full = QImage(*self.internal, QImage.Format.Format_RGBA8888); full.fill(QColor("#132220"))
        matte = QImage(320,180,QImage.Format.Format_RGBA8888); matte.fill(Qt.GlobalColor.transparent)
        wx, wy = 640-238*1.06, 618-530*1.06
        def camera(p): return [pivot[0]+push*(p[0]-pivot[0]), pivot[1]+push*(p[1]-pivot[1])]
        def world(p): return [wx+1.06*p[0], wy+530*1.06*(1-breath)+1.06*breath*p[1]]
        def actor_paint(painter, factor):
            painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
            painter.scale(factor,factor); painter.translate(*pivot); painter.scale(push,push); painter.translate(-pivot[0],-pivot[1])
            painter.drawImage(QRectF(wx,wy+530*1.06*(1-breath),actor.width()/self.factor,actor.height()/self.factor*breath),actor)
        painter = QPainter(full); painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        painter.translate(pivot[0]*self.factor,pivot[1]*self.factor); painter.scale(push,push); painter.translate(-pivot[0]*self.factor,-pivot[1]*self.factor)
        painter.drawImage(0,0,self.static); painter.resetTransform(); actor_paint(painter,self.factor)
        painter.resetTransform(); painter.scale(self.factor,self.factor)
        painter.fillRect(QRectF(24,24,335,64),QColor(10,26,29,210))
        font = QFont(self.family); font.setPixelSize(15); font.setBold(True); painter.setFont(font); painter.setPen(QColor("#c9f88e")); painter.drawText(40,49,"FULL_REZZ  /  RENDER REVIEW")
        font.setPixelSize(12); font.setBold(False); painter.setFont(font); painter.setPen(QColor("#d2e9dd")); painter.drawText(40,71,"SUPPLIED SYNTHETIC · NON-CANON")
        if self.project.offset <= t < self.project.offset + self.project.speech_samples/24000:
            lines = self.project.config["statement"].split("\n")
            font.setPixelSize(18); painter.setFont(font)
            width = max(painter.fontMetrics().horizontalAdvance(line) for line in lines)+42
            painter.fillRect(QRectF((1280-width)/2,653,width,57),QColor(8,17,22,225)); painter.setPen(QColor("#f4f8ee"))
            for j,line in enumerate(lines): painter.drawText(QRectF(0,659+j*24,1280,24),Qt.AlignmentFlag.AlignHCenter,line)
        painter.end()
        painter = QPainter(matte); actor_paint(painter,.25); painter.end()
        output = full.scaled(self.width,self.height,Qt.AspectRatioMode.IgnoreAspectRatio,Qt.TransformationMode.SmoothTransformation)
        thumb = array(output.scaled(128,72,Qt.AspectRatioMode.IgnoreAspectRatio,Qt.TransformationMode.SmoothTransformation))[:,:,:3]
        mask = array(matte)[:,:,3]
        state = {**clock,"time_seconds":t,"mouth_state":self.states[index],"mouth_aperture":self.apertures[index],"blink":blink(t),
                 "breath":breath,"camera_zoom":push,"camera_pivot":pivot,"world_contacts":[world(p) for p in pose["registered_contacts"]],
                 "screen_contacts":[camera(world(p)) for p in pose["registered_contacts"]],"hand":world(mapping["hand"]),
                 "arm_offset":mapping["delta"],"arm_offset_limited":mapping["limited"],"minimum_triangle_area_ratio":mapping["minimum_triangle_area_ratio"],
                 "arm_rig_mode":rig_mode,"hand_target_supported":mapping["hand_target_supported"]}
        return output, thumb, mask, state
