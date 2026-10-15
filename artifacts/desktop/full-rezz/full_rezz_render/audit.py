"""Every-frame decoding and raster/audio checks, separate from the drawing code.

The offline path uses packaged Qt, NumPy and PyAV. An optional second decoder
uses FFmpeg/ffprobe in development. Human fidelity approval is always separate.
"""
from fractions import Fraction
import hashlib, json, math, subprocess, wave, zlib
from pathlib import Path
import numpy as np
import av
from PySide6.QtCore import Qt
from PySide6.QtGui import QImage
from .project import Project, digest, read_json
from .timing import ExposureClock


def _array(image):
    if image.isNull():
        raise ValueError("Image decoding failed.")
    image = image.convertToFormat(QImage.Format.Format_RGBA8888)
    return np.frombuffer(image.bits(), dtype=np.uint8, count=image.height()*image.bytesPerLine()).reshape(image.height(),image.bytesPerLine())[:,:image.width()*4].reshape(image.height(),image.width(),4).copy()


def _thumbnail(rgb):
    rgb = np.ascontiguousarray(rgb)
    image = QImage(rgb.data,rgb.shape[1],rgb.shape[0],rgb.strides[0],QImage.Format.Format_RGB888)
    return _array(image.scaled(128,72,Qt.AspectRatioMode.IgnoreAspectRatio,Qt.TransformationMode.SmoothTransformation))[:,:,:3]


def psnr(a,b):
    mse = float(np.mean((a.astype(np.float64)-b.astype(np.float64))**2))
    return 120. if mse == 0 else 10*math.log10(255**2/mse)


def read_rasters(path, count):
    """Bounded decompression: exactly one complete raster record per expected frame."""
    record_size = 128*72*3 + 320*180
    decoder = zlib.decompressobj()
    pending = bytearray()
    produced = 0
    with Path(path).open("rb") as source:
        while produced < count:
            while len(pending) < record_size:
                compressed = decoder.unconsumed_tail or source.read(65536)
                if not compressed:
                    raise ValueError("Truncated raster reference.")
                pending.extend(decoder.decompress(compressed, record_size-len(pending)))
            record = bytes(pending[:record_size]); del pending[:record_size]
            produced += 1
            yield np.frombuffer(record[:128*72*3],dtype=np.uint8).reshape(72,128,3), np.frombuffer(record[128*72*3:],dtype=np.uint8).reshape(180,320)
        compressed = decoder.unconsumed_tail or source.read(65536)
        # A bounded extra byte detects excess expanded data without allocating it.
        if decoder.decompress(compressed,1) or pending:
            raise ValueError("Excess raster reference data.")
        while not decoder.eof:
            compressed = source.read(65536)
            if not compressed:
                raise ValueError("Incomplete zlib footer.")
            if decoder.decompress(compressed,1):
                raise ValueError("Excess raster reference data.")
        if decoder.unused_data or source.read(1):
            raise ValueError("Trailing raster reference data.")


def audio_metrics(reference, decoded, start, count):
    if len(decoded)<len(reference):raise ValueError("Decoded speech timeline is truncated.")
    x=reference[start:start+count].astype(float)/32768
    y=decoded[start:start+count].astype(float)
    if np.std(x)<1e-7:raise ValueError("Speech reference is silent.")
    correlation=float(np.corrcoef(x,y)[0,1])
    signal=float(np.mean(x*x));error=float(np.mean((x-y)**2))
    snr=120. if error==0 else 10*math.log10(signal/max(error,1e-20))
    # Compare the first second of non-silent speech over a ±10 ms lag window.
    n=min(24000,len(x));size=1 << ((2*n-1).bit_length())
    xc=np.fft.irfft(np.fft.rfft(x[:n],size)*np.conj(np.fft.rfft(y[:n],size)),size)
    lags=np.arange(-240,241);best_lag=int(lags[np.argmax(xc[lags%size])])
    return {"correlation":correlation,"signal_to_error_db":snr,"best_alignment_lag_samples":best_lag,
            "decoded_peak":float(np.max(np.abs(decoded))),"speech_samples":count,"offset_samples":start}


def audit(project_root, output_directory, ffmpeg=None, ffprobe=None, raw_reference=None):
    output=Path(output_directory).resolve()
    receipt=read_json(output/"render_receipt.json")
    project=Project(project_root,receipt["preset"],receipt["fps"])
    checks=[];metrics={};flags=[]
    def check(name, function):
        try:
            value=function()
            if value is False:raise ValueError("Criterion failed.")
            checks.append({"name":name,"status":"passed"})
            return value
        except Exception as error:
            checks.append({"name":name,"status":"failed","detail":str(error)})
            return None
    def require(condition,message):
        if not condition:raise ValueError(message)
        return True
    config=project.config;limits=config["audit"]
    check("Project assets and configuration match the render snapshot",lambda: require(project.assets==receipt["asset_sha256"] and config==receipt["config"],"Input bytes/configuration changed after rendering."))
    def output_hashes():
        for name, expected in receipt["output_sha256"].items():
            if name not in {"Rebecca_Full_Voiced_Action.mp4","sequence.audio.wav","raster_reference.zlib"}:raise ValueError("Unsupported output hash path.")
            require(digest(output/name)==expected,f"Output byte mismatch: {name}")
        require(len(receipt["output_sha256"])==3,"Incomplete output hashes.")
    check("Movie, PCM timeline and raster reference retain their declared bytes",output_hashes)
    frames=receipt["frame_evidence"]
    def clock_check():
        require(len(frames)==project.clock.frames==receipt["frames"],"Frame evidence count disagrees.")
        require(receipt["dimensions"]==[project.preset["width"],project.preset["height"]],"Dimensions disagree.")
        require(receipt["internal_dimensions"]==[project.preset["width"]*project.preset["supersampling"],project.preset["height"]*project.preset["supersampling"]],"Supersampling dimensions disagree.")
        for index,row in enumerate(frames):
            clock=project.clock.at(index)
            for key in ["index","source_frame","sample_source_frame","pose_id","key_source_frame","hold"]:
                require(row[key]==clock[key],f"Invalid exposure evidence at frame {index}: {key}")
            require(abs(row["time_seconds"]-index/project.clock.fps)<1e-10,"Time grid drift.")
        require(receipt["fps"]>=60,"Output is below 60 fps.")
        metrics["exposure_holds_used"]=sorted({row["hold"] for row in frames})
        metrics["authored_drawings_used"]=len({row["pose_id"] for row in frames})
        metrics["body_sample_count"]=len({(row["pose_id"],row["sample_source_frame"]) for row in frames})
    check("Every frame follows the rational exposure clock and authored key boundaries",clock_check)
    def rig_check():
        for row in frames:
            require(row["minimum_triangle_area_ratio"]>=limits["minimum_triangle_area_ratio"]-1e-9,"Reported triangle fold or excess compression.")
            require(np.linalg.norm(row["arm_offset"])<=limits["maximum_arm_offset_source_pixels"]+1e-8,"Arm displacement exceeds guard.")
            require(np.allclose(row["world_contacts"],[[546.72,618],[733.28,618]],atol=1e-8,rtol=0),"Reported planted contact drift.")
        metrics["minimum_triangle_area_ratio"]=min(r["minimum_triangle_area_ratio"] for r in frames)
        metrics["limited_arm_frames"]=sum(r["arm_offset_limited"] for r in frames)
    check("Reported geometry preserves orientation, displacement bounds and planted contacts",rig_check)
    witness_images={}
    def witnesses():
        for index in receipt["witnesses"]:
            path=output/"witnesses"/f"frame_{index:04d}.png"
            require(digest(path)==receipt["witness_sha256"][str(index)],"Witness PNG byte mismatch.")
            rgb=_array(QImage(str(path)))[:,:,:3]
            require(list(rgb.shape[:2][::-1])==receipt["dimensions"],"Witness dimensions mismatch.")
            require(hashlib.sha256(rgb.tobytes()).hexdigest()==frames[index]["raw_rgb_sha256"],"Witness does not reproduce its raw pixels.")
            witness_images[index]=rgb
    check("All full-resolution witness PNGs decode to the declared raw RGB frames",witnesses)
    reference_metrics={};raster_records=[]
    def raster_check():
        previous=None;max_contact_drift=0.;baseline_bottom=None;steps=[];outside_support=[]
        for index,(thumb,matte) in enumerate(read_rasters(output/"raster_reference.zlib",project.clock.frames)):
            row=frames[index]
            require(hashlib.sha256(thumb.tobytes()).hexdigest()==row["thumbnail_sha256"],"Thumbnail raster mismatch.")
            require(hashlib.sha256(matte.tobytes()).hexdigest()==row["actor_matte_sha256"],"Actor matte mismatch.")
            require(2500<np.count_nonzero(matte>128)<10000,"Empty, fragmented or implausibly sized silhouette.")
            require(not np.any(matte[[0,-1],:]) and not np.any(matte[:,[0,-1]]),"Actor silhouette touches a frame boundary.")
            bottoms=[]
            for cx,cy in row["screen_contacts"]:
                x,y=round(cx/4),round(cy/4)
                require(np.mean(matte[y-2:y,x-2:x+3])>200,"Declared sole lacks real opaque raster support.")
                roi=matte[y-4:y+4,x-6:x+7]
                dense=np.flatnonzero(np.count_nonzero(roi>128,axis=1)>=4)
                require(len(dense)>0,"No raster boot sole in contact neighborhood.")
                bottoms.append((y-4+dense[-1])*4-cy)
            if baseline_bottom is None:baseline_bottom=bottoms
            max_contact_drift=max(max_contact_drift,max(abs(a-b) for a,b in zip(bottoms,baseline_bottom)))
            if previous is not None:
                # Low-resolution area changes are review proxies, not optical tracking.
                changed=float(np.count_nonzero((matte>128)!=(previous>128))/max(np.count_nonzero(previous>128),1))
                if changed>limits["silhouette_jump_review_fraction"]:
                    flags.append({"kind":"silhouette_change","frame":index,"fraction":round(changed,6),"authored_pose_boundary":row["pose_id"]!=frames[index-1]["pose_id"]})
                steps.append(changed)
            previous=matte
            raster_records.append(thumb.copy())
        metrics["maximum_raster_contact_bottom_change_design_pixels"]=max_contact_drift
        metrics["maximum_silhouette_change_fraction"]=max(steps,default=0)
        # 4 px thumbnails have a quantified 4 px sampling floor; this is separate
        # from the exact geometry guard and must not pretend subpixel tracking.
        require(max_contact_drift<=limits["maximum_contact_drift_design_pixels"]+4,"Boot raster displacement exceeds guard plus measured sampling floor.")
        require(len(raster_records)==project.clock.frames,"Missing lossless raster records.")
    check("Every lossless matte preserves a complete visible silhouette and real sole support",raster_check)
    movie=output/"Rebecca_Full_Voiced_Action.mp4"
    decoded_count=0;thumb_psnr=[];witness_psnr=[];video_time=[];full_psnr=[]
    full_reference=receipt.get("full_resolution_reference")
    full_path=Path(raw_reference).resolve() if raw_reference else output/"full_resolution.rgb"
    full_available=bool(full_reference and full_path.exists())
    metrics["exhaustive_full_resolution_available"]=full_available
    def full_reference_check():
        require(full_reference["name"]=="full_resolution.rgb" and not full_path.is_symlink(),"Unexpected raw raster path.")
        expected=project.preset["width"]*project.preset["height"]*3*project.clock.frames
        require(full_reference["bytes"]==expected and full_path.stat().st_size==expected,"Incomplete full-resolution reference.")
        require(digest(full_path)==full_reference["sha256"],"Full-resolution reference byte mismatch.")
    if full_available:check("Full-resolution raster reference has its exact complete bytes",full_reference_check)
    def decoded_video():
        nonlocal decoded_count
        from contextlib import nullcontext
        with av.open(str(movie)) as container,(full_path.open("rb") if full_available else nullcontext(None)) as raw:
            require(len(container.streams.video)==1 and len(container.streams.audio)==1,"Expected one video and one audio stream.")
            stream=container.streams.video[0]
            require([stream.width,stream.height]==receipt["dimensions"],"Encoded dimensions disagree.")
            require(stream.average_rate==Fraction(project.clock.fps,1),"Encoded fps differs from requested fps.")
            require(stream.codec_context.name=="h264" and stream.codec_context.format.name=="yuv420p","Unexpected video codec/format.")
            for index,frame in enumerate(container.decode(video=0)):
                require(index<project.clock.frames,"Extra encoded video frames.")
                time=float(frame.pts*frame.time_base)
                require(abs(time-index/project.clock.fps)<1e-7,f"Missing or irregular presentation timestamp at {index}.")
                rgb=frame.to_ndarray(format="rgb24")
                require(float(np.std(rgb))>1,"Black/flat decoded frame.")
                value=psnr(_thumbnail(rgb),raster_records[index]);thumb_psnr.append(value)
                if raw is not None:
                    pixels=raw.read(project.preset["width"]*project.preset["height"]*3)
                    require(hashlib.sha256(pixels).hexdigest()==frames[index]["raw_rgb_sha256"],f"Raw pixels disagree at frame {index}.")
                    expected_rgb=np.frombuffer(pixels,dtype=np.uint8).reshape(rgb.shape)
                    full_psnr.append(psnr(rgb,expected_rgb))
                if index in witness_images:witness_psnr.append({"frame":index,"psnr_db":psnr(rgb,witness_images[index])})
                video_time.append(time);decoded_count+=1
            require(decoded_count==project.clock.frames,"Missing encoded frames.")
            require(min(thumb_psnr)>=limits["minimum_full_frame_psnr_db"],"Decoded thumbnail differs excessively from rendered image.")
            require(len(witness_psnr)==len(receipt["witnesses"]),"Missing full-resolution decode comparisons.")
            require(min(r["psnr_db"] for r in witness_psnr)>=limits["minimum_full_frame_psnr_db"],"Full-resolution witness differs excessively after encoding.")
            if raw is not None:
                require(not raw.read(1),"Excess full-resolution raster data.")
                require(len(full_psnr)==project.clock.frames and min(full_psnr)>=limits["minimum_full_frame_psnr_db"],"A full-resolution frame differs excessively after encoding.")
        metrics["decoded_video_frames"]=decoded_count
        metrics["minimum_every_frame_thumbnail_psnr_db"]=min(thumb_psnr)
        metrics["full_resolution_witness_psnr"]=witness_psnr
        if full_psnr:
            metrics["every_frame_full_resolution_psnr_db"]={"minimum":min(full_psnr),"mean":float(np.mean(full_psnr)),"frames":len(full_psnr),"values":full_psnr}
    check("Every encoded frame decodes with exact CFR timestamps and raster agreement",decoded_video)
    reference=None
    def pcm():
        nonlocal reference
        with wave.open(str(output/"sequence.audio.wav")) as reader:
            require((reader.getframerate(),reader.getsampwidth(),reader.getnchannels())==(24000,2,1),"Unexpected PCM format.")
            reference=np.frombuffer(reader.readframes(reader.getnframes()),dtype="<i2")
        start=round(project.offset*24000);count=project.speech_samples
        require(len(reference)==round(float(project.clock.duration)*24000),"PCM duration mismatch.")
        require(reference[start:start+count].tobytes()==project.speech,"Speech samples changed.")
        require(not np.any(reference[:start]) and not np.any(reference[start+count:]),"Lead or tail was altered.")
        require(start==receipt["speech_offset_samples"] and count==receipt["source_speech_samples"],"Receipt audio grid mismatch.")
    check("Original speech PCM remains byte-exact at its intended sample offset",pcm)
    decoded_audio=None
    def sound():
        nonlocal decoded_audio
        with av.open(str(movie)) as container:
            stream=container.streams.audio[0]
            require(stream.codec_context.sample_rate==24000 and stream.codec_context.channels==1,"Unexpected audio stream format.")
            pieces=[];expected=0
            for frame in container.decode(audio=0):
                start=round(float(frame.pts*frame.time_base)*24000)
                require(start==expected,"Audio decode contains a gap, overlap or timestamp shift.")
                values=frame.to_ndarray().reshape(-1).astype(float)
                pieces.append(values);expected+=len(values)
            decoded_audio=np.concatenate(pieces)
        values=audio_metrics(reference,decoded_audio,receipt["speech_offset_samples"],project.speech_samples)
        metrics["audio"]=values
        require(values["correlation"]>=limits["minimum_audio_correlation"] and values["signal_to_error_db"]>=limits["minimum_audio_snr_db"],"Encoded voice differs or is misaligned.")
        require(abs(values["best_alignment_lag_samples"])<=1,"Speech alignment drift exceeds one sample.")
        require(values["decoded_peak"]<1,"Decoded audio clips.")
        tail=decoded_audio[receipt["speech_offset_samples"]+project.speech_samples+1024:len(reference)]
        require(not len(tail) or float(np.sqrt(np.mean(tail*tail)))<1e-4,"Closing hold is not silent.")
    check("Decoded AAC preserves complete speech, sample alignment, headroom and silent tail",sound)
    def performance():
        for row in frames:
            t=row["time_seconds"]
            if t<project.offset or t>=project.offset+project.speech_samples/24000:
                require(row["mouth_state"]==0 and row["mouth_aperture"]==0,"Mouth activity outside supplied speech.")
        hands=np.asarray([row["hand"] for row in frames]);steps=np.linalg.norm(np.diff(hands,axis=0),axis=1)
        metrics["maximum_hand_step_design_pixels"]=float(np.max(steps))
        for i in np.flatnonzero(steps>limits["pose_jump_review_design_pixels"]):
            flags.append({"kind":"hand_landmark_jump","frame":int(i+1),"pixels":float(steps[i]),"authored_pose_boundary":frames[i]["pose_id"]!=frames[i+1]["pose_id"]})
    check("Facial activity stays in the voice interval and pose jumps are surfaced",performance)
    if ffmpeg or ffprobe:
        def second_decoder():
            if not ffmpeg or not ffprobe:raise ValueError("Provide both independent decoder commands.")
            probe=json.loads(subprocess.run([ffprobe,"-v","error","-count_frames","-show_streams","-of","json",str(movie)],check=True,capture_output=True).stdout)
            video=next(s for s in probe["streams"] if s["codec_type"]=="video")
            require(int(video["nb_read_frames"])==project.clock.frames and video["avg_frame_rate"]==f"{project.clock.fps}/1","Independent frame count/fps disagree.")
            subprocess.run([ffmpeg,"-nostdin","-v","error","-i",str(movie),"-map","0:v:0","-f","null","-"],check=True,capture_output=True)
            pcm=subprocess.run([ffmpeg,"-nostdin","-v","error","-i",str(movie),"-map","0:a:0","-f","f32le","-ac","1","-ar","24000","pipe:1"],check=True,capture_output=True).stdout
            other=np.frombuffer(pcm,dtype="<f4")
            require(len(other)==len(decoded_audio) and np.max(np.abs(other-decoded_audio))<1e-7,"Independent decoded audio disagrees.")
            metrics["independent_ffmpeg_verified"]=True
        check("Independent FFmpeg/ffprobe confirms the full export and decoded audio",second_decoder)
    passed=sum(r["status"]=="passed" for r in checks);failed=len(checks)-passed
    report={"schema_version":"1.0.0","passed":passed,"failed":failed,"technical_status":"passed" if not failed else "failed",
            "human_quality_review":"pending","studio_equivalence_validated":False,"audit_engine":"Qt PNG decode + PyAV full decode; independent mathematical/raster/audio checks; optional FFmpeg second decoder",
            "metrics":metrics,"review_flags":flags,"checks":checks,"thresholds":limits,
            "output_identity":{"movie_sha256":digest(movie),"receipt_sha256":digest(output/"render_receipt.json")},
            "audit_coverage":"exhaustive" if full_available and not failed else "portable subset" if not failed else "failed",
            "measurement_limits":["All encoded frames are decoded. Exhaustive runs compare every full-resolution raw RGB frame and its hash. Portable packages omit the large raw reference; repeat an exhaustive audit after rendering again.",
                "Matte/contact checks use a 320 × 180 alpha raster with a 4 design-pixel quantization floor; geometry checks also inspect renderer-reported data.",
                "Hand landmarks are authored geometry proxies; silhouette changes are area proxies. Neither establishes anatomy, acting, likeness or studio quality.",
                "No official shot timing or studio QA thresholds were recovered from Google screenshots. Local thresholds are declared engineering choices.",
                "Silhouette and hand discontinuities remain review flags even at authored boundaries; deliberate timing does not automatically excuse anatomy errors."]}
    temporary=output/"audit_report.json.staged";temporary.write_text(json.dumps(report,indent=2)+"\n");temporary.replace(output/"audit_report.json")
    return {k:report[k] for k in ["passed","failed","technical_status","human_quality_review","audit_coverage"]}|{"review_flags":len(flags),"report":str(output/"audit_report.json")}
