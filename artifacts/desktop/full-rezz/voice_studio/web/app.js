"use strict";
const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="studio-token"]').content;
let state = {recordings: [], profiles: [], jobs: [], capabilities: {}}, recordingId = null, profileId = null;
const renderReviewDrafts = new Map();
let rendersKey = "";
let rows = [], rowsDirty = false, characterDirty = false, activeSource = null, expression = null;
let paintedRecord = null, paintedProfile = null, toastTimer = null, refreshing = false, uploadBusy = false;
let refreshPending = false, refreshPromise = null, bindingBusy = false;
let characterDraft = {};
let regionRevision = 0, characterRevision = 0;
const regionDrafts = new Map(), characterDrafts = new Map(), submittedJobs = new Set();
let cleanupDirty = false;
let cleanupRevision = 0;
const handledJobs = new Set();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pretty = (value) => JSON.stringify(value ?? {}, null, 2);
const duration = (value) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2,"0")}`;
const currentRecord = () => state.recordings.find(r => r.id === recordingId);
const currentProfile = () => state.profiles.find(p => p.id === profileId);

function toast(message, error = false) {
  clearTimeout(toastTimer); $("toast").textContent = message; $("toast").classList.toggle("error",error); $("toast").hidden=false;
  toastTimer=setTimeout(()=>$("toast").hidden=true,error?11000:5000);
}
async function api(path, body, raw=false) {
  const options = body === undefined ? {} : {method:"POST",headers:{"X-Studio-Token":token},body:raw?body:JSON.stringify(body)};
  if(body!==undefined&&!raw)options.headers["Content-Type"]="application/json";
  const response=await fetch(path,options);
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||"The action failed.");
  return result;
}
function task(fn) { return async (...args) => {try {await fn(...args);}catch(error){toast(error.message,true);}}; }
function rememberRegions() {
  if(recordingId&&rowsDirty)regionDrafts.set(recordingId,{rows,revision:regionRevision});
}
function characterValues() {
  return Object.fromEntries([...$("profile-editor").querySelectorAll("input,textarea,select")]
    .filter(el=>el.id.startsWith("character-")).map(el=>[el.id,el.value]));
}
function rememberCharacter() {
  if(profileId&&characterDirty)characterDrafts.set(profileId,{values:characterValues(),character:characterDraft,
    revision:characterRevision,report:$("draft-report").innerHTML});
}
function selectRecording(id) {
  if(cleanupDirty&&id!==recordingId){toast("Save or discard your cleanup settings before switching recordings.",true);return;}
  rememberRegions();recordingId=id;paintedRecord=null;rowsDirty=false;renderLibraries();renderRecording();
}
function selectProfile(id) {
  rememberCharacter();profileId=id;characterDirty=false;paintedProfile=null;activeSource=null;
  $("source-viewer").hidden=true;renderLibraries();renderProfile();
}
function requireSaved(kind) {
  rememberRegions();rememberCharacter();
  if(["analyze","transcribe","separate","demo","export","expression","quality","render","rebecca","portable_import"].includes(kind)&&cleanupDirty)
    throw new Error("Save your cleanup settings before processing, measuring, or exporting.");
  if(["analyze","transcribe","separate"].includes(kind)&&regionDrafts.has(recordingId))
    throw new Error("Save this recording's edited regions before processing its audio.");
  if(["export","expression","render","rebecca","portable_import"].includes(kind)&&(regionDrafts.size||characterDrafts.size))
    throw new Error("Save pending region and character drafts before exporting. Switch back to each edited item to save it.");
}
async function job(kind, body={}) {
  requireSaved(kind);const submitted=await api("/api/jobs",{kind,...body});submittedJobs.add(submitted.id);await refresh();
}
window.addEventListener("beforeunload",event=>{
  if(hasPendingEdits()){event.preventDefault();event.returnValue="";}
});

function openTab(name) {
  document.querySelectorAll(".tab").forEach(el=>el.hidden=el.id!==name+"-tab");
  document.querySelectorAll(".nav").forEach(el=>el.classList.toggle("active",el.dataset.tab===name));
  $("breadcrumb").textContent="WORKSPACE / "+({recordings:"RECORDINGS",characters:"CHARACTERS & VOICES",integration:"EXPRESSION & EXPORT",animation:"ANIMATION",guide:"USER GUIDE"}[name]);
  if(name==="recordings"&&currentRecord())drawWave(currentRecord());
}
document.querySelectorAll(".nav").forEach(el=>el.addEventListener("click",()=>openTab(el.dataset.tab)));

async function refresh() {
  if(refreshing){refreshPending=true;await refreshPromise;return;}
  refreshing=true;
  let finishRefresh;refreshPromise=new Promise(resolve=>{finishRefresh=resolve;});
  try {
    state=await api("/api/state");
    if(!recordingId&&state.recordings.length)recordingId=state.recordings[0].id;
    if(!profileId&&state.profiles.length)profileId=state.profiles[0].id;
    $("app-version").textContent=state.version; $("recording-count").textContent=state.recordings.length; $("profile-count").textContent=state.profiles.length;
    renderLibraries(); renderRecording(); renderProfile(); renderCapabilities(); renderRenders();
    const running=state.jobs.find(j=>j.status==="queued"||j.status==="running");
    $("job-status").hidden=!running;
    if(running)$("job-status").textContent=({analyze:"Finding speaker regions…",transcribe:"Transcribing audio…",render:"Rendering speech locally…",rebecca:"Restoring the bundled archive…",export:"Building reference package…",expression:"Preparing expression request…",research:"Searching character sources…",source:"Collecting source material…",separate:"Separating overlapping voices…",demo:"Creating a synthetic demo…"}[running.kind]||"Processing…");
    for(const id of ["analyze-button","transcribe-button","separate-button","export-button","expression-button","research-button","source-url-button","demo-button","draft-character-button","quality-button","save-audio-settings","render-button","portable-button","rebecca-button"])$(id).disabled=!!running||uploadBusy;
    if(state.capabilities.offline){$("research-button").disabled=true;$("source-url-button").disabled=true;}
    const audioLocked=!!running&&["analyze","transcribe","separate"].includes(running.kind);
    $("region-rows").querySelectorAll("input,textarea,select,button").forEach(el=>el.disabled=audioLocked);
    $("save-regions-button").disabled=audioLocked;$("add-region-button").disabled=audioLocked;$("discard-regions-button").disabled=audioLocked;
    const characterLocked=running?.kind==="character_draft";
    $("profile-editor").querySelectorAll('[id^="character-"]').forEach(el=>{if(["INPUT","TEXTAREA","SELECT"].includes(el.tagName))el.disabled=characterLocked;});
    $("save-character-button").disabled=characterLocked;$("apply-character-json").disabled=characterLocked;$("discard-character-button").disabled=characterLocked;
    $("profile-list").querySelectorAll("button").forEach(el=>el.disabled=characterLocked);
    for(const item of state.jobs)if(!handledJobs.has(item.id)&&(item.status==="completed"||item.status==="failed")){
      handledJobs.add(item.id);completeJob(item);
    }
  } finally {
    refreshing=false;finishRefresh();
    if(refreshPending){refreshPending=false;await refresh();}
  }
}

function completeJob(item) {
  if(item.status==="failed"){toast(item.error,true);return;}
  const result=item.result;
  if(item.kind==="export") {
    addPackageLink(result.filename);toast(`Reference package ready: ${result.included_count} clips included, ${result.excluded_count} excluded. See quality_report.json for details.`);
  } else if(item.kind==="quality") {
    if(result.recording_id===recordingId)renderQualityResults(result);
  } else if(item.kind==="rebecca") {toast("Rebecca archive restored. Select its recording to inspect the reference.");}
  else if(item.kind==="render") {toast("Local speech rendered. Listen, then save your review.");}
  else if(item.kind==="research")renderResearch(result);
  else if(item.kind==="source") {toast("Source attached. Review it before citing character facts.");if(currentProfile()?.sources?.some(s=>s.id===result.id))viewSource(result.id);}
  else if(item.kind==="expression") {
    expression=result;$("expression-output").textContent=pretty(result);$("expression-output").hidden=false;$("expression-download").hidden=false;if(result.reference_package)addPackageLink(result.reference_package.filename);toast("Expression request and its matching reference package are ready.");
  } else if(item.kind==="character_draft") {
    if(!submittedJobs.has(item.id))return;
    selectProfile(result.profile_id);characterToEditor(result.character);characterRevision=result.base_revision??characterRevision;characterDirty=true;$("character-save-note").textContent="Unsaved source draft. Review before saving.";
    $("draft-report").innerHTML=`<div class="info-note">${result.adopted_fields.length} fields added · ${result.conflicts.length} conflicting candidates · ${result.ignored_fields?.length||0} invalid fields skipped. Review the source draft.</div>`+(result.conflicts.length?`<pre>${esc(pretty(result.conflicts))}</pre>`:"")+(result.ignored_fields?.length?`<pre>${esc(pretty(result.ignored_fields))}</pre>`:"");rememberCharacter();openTab("characters");toast("Source draft applied to the editor. Review its facts and save.");
  } else if(item.kind==="demo"||item.kind==="separate") {
    selectRecording(result.recording_ids[0]);openTab("recordings");toast(item.kind==="demo"?"Synthetic demo loaded. These channels are test tones, not speech.":"Estimated sources imported. Listen and review each source.");
  } else {
    if(result.recording_id===recordingId&&!regionDrafts.has(recordingId)){paintedRecord=null;rowsDirty=false;renderRecording();}
    toast(item.kind==="transcribe"?"Transcription completed.":"Regions found. Review them and assign a named profile.");
  }
}

function renderLibraries() {
  $("recording-list").innerHTML=state.recordings.length?state.recordings.map(r=>`<button class="record-card ${r.id===recordingId?"active":""}" data-record="${r.id}"><div class="card-icon">〰</div><b>${esc(r.name)}</b><div class="card-meta">${duration(r.duration)} · ${r.channels} ch · ${(r.sample_rate/1000).toFixed(1)} kHz</div><div class="card-meta">${r.segments.length} regions · ${Object.keys(r.bindings).length} linked voices</div></button>`).join(""):"<div class='recording-list-empty'>Your recording library is empty.</div>";
  $("recording-list").querySelectorAll("[data-record]").forEach(el=>el.onclick=()=>selectRecording(el.dataset.record));
  $("profile-list").innerHTML=state.profiles.length?state.profiles.map(p=>`<button class="profile-card ${p.id===profileId?"active":""}" data-profile="${p.id}"><div class="card-icon">◇</div><b>${esc(p.name)}</b><div class="card-meta">${esc(p.character?.kind||"voice")} · ${p.sources?.length||0} sources</div><div class="card-meta">${state.recordings.reduce((n,r)=>n+Object.values(r.bindings).filter(x=>x===p.id).length,0)} linked speaker tracks</div></button>`).join(""):"<div class='recording-list-empty'>No character profiles yet.</div>";
  $("profile-list").querySelectorAll("[data-profile]").forEach(el=>el.onclick=()=>selectProfile(el.dataset.profile));
  const selected=$("expression-profile").value;
  $("expression-profile").innerHTML=state.profiles.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  if(state.profiles.some(p=>p.id===selected))$("expression-profile").value=selected;
}

function renderRecording() {
  const record=currentRecord();$("recording-empty").hidden=!!record;$("recording-editor").hidden=!record;
  if(!record)return;
  if(paintedRecord===record.id+":"+record.revision||(rowsDirty&&paintedRecord?.startsWith(record.id+":"))||bindingBusy)return;
  paintedRecord=record.id+":"+record.revision;
  const draft=regionDrafts.get(record.id);rows=structuredClone(draft?.rows||record.segments);rowsDirty=!!draft;regionRevision=draft?.revision??record.revision;
  $("recording-title").textContent=record.name;$("recording-meta").textContent=`${duration(record.duration)} · ${record.channels} channels`;
  const player=$("audio-player");if(player.dataset.record!==record.id){player.src="/api/audio/"+record.id;player.dataset.record=record.id;}
  $("separate-end").value=Math.min(10,record.duration).toFixed(2);
  $("analysis-note").textContent=record.analysis?.note||record.origin?.note||"Reference mode declares one voice. Physical channel separation needs review. Automatic speaker detection needs its AI setup.";
  renderRegions();renderBindings(record);drawWave(record);renderAudioSettings(record);
}

function addPackageLink(filename) {
  const a=document.createElement("a");a.href="/api/exports/"+encodeURIComponent(filename);a.className="download-link";a.textContent="Download reference package ↓ "+filename;a.download=filename;$("export-links").prepend(a);
}
function renderAudioSettings(record) {
  const reports=record.quality?.channels||[];
  $("source-quality-summary").textContent=reports.map((q,i)=>`Channel ${i+1}: ${q.status.replaceAll("_"," ")} · peak ${q.peak_dbfs} dBFS${q.issues.length?" · "+q.issues.map(x=>x.message).join(" "):""}`).join("\n")||"Use Measure selected signal to inspect this recording.";
  if(record.channels>1&&record.quality?.mono_mix?.status==="reject"&&reports.some(q=>q.status!=="reject"))$("source-quality-summary").textContent+="\nThe mono mix may cancel. Preview and extract an individual channel.";
  if(cleanupDirty)return;
  cleanupRevision=record.revision;
  const s=record.audio_processing||{enabled:false,remove_dc:true,highpass_hz:30,peak_dbfs:-3,fade_ms:5,denoise_db:0};
  $("cleanup-enabled").value=String(s.enabled);$("cleanup-dc").value=String(s.remove_dc);
  for(const [id,key] of [["cleanup-highpass","highpass_hz"],["cleanup-peak","peak_dbfs"],["cleanup-fade","fade_ms"],["cleanup-denoise","denoise_db"],["noise-start","noise_start"],["noise-end","noise_end"]])$(id).value=s[key]??"";
  if($("quality-channel").dataset.record!==record.id){
    $("quality-channel").innerHTML='<option value="">Mono mix</option>'+Array.from({length:record.channels},(_,i)=>`<option value="${i}">Channel ${i+1}</option>`).join("");
    if(record.channels===1)$("quality-channel").value="0";
    $("quality-channel").dataset.record=record.id;$("quality-start").value=0;$("quality-end").value=Math.min(10,record.duration);$("quality-results").innerHTML="";
  }
}
function renderQualityResults(result) {
  const card=(q,title)=>`<div class="quality-card"><h3>${title}</h3><p>${esc(q.status.replaceAll("_"," "))} · Peak ${q.peak_dbfs} dBFS · RMS ${q.rms_dbfs} dBFS · DC ${q.dc_offset}</p><p>${q.estimated_snr_db===null?"Noise estimate unavailable: this selection does not establish a quiet baseline.":`Quiet-frame contrast ${q.estimated_snr_db} dB (estimate).`}</p>${q.issues.map(i=>`<p class="quality-${i.severity}">${esc(i.message)}</p>`).join("")}</div>`;
  $("quality-results").innerHTML=spectrumCard(result.spectral_balance)+card(result.source_quality,"Source signal")+card(result.output_quality,"Output signal")+`<p class="muted">${result.enabled?"Applied: "+esc(result.steps.join(", ")):"Preserved working samples exactly."} Listen for noise, bleed, and altered timbre; signal checks cannot verify those.</p>`;
}
function spectrumCard(q){return q?`<div class="info-note">Spectral energy · ${esc(pretty(q))}<br>Band energy describes the signal. It does not infer emotion.</div>`:"";}
function qualitySelection() {return {recording_id:recordingId,start:Number($("quality-start").value),end:Number($("quality-end").value),channel:$("quality-channel").value===""?null:Number($("quality-channel").value)};}
$("audio-quality-panel").querySelectorAll('[id^="cleanup-"],[id^="noise-"]').forEach(el=>el.addEventListener("input",()=>cleanupDirty=true));
function audioSettingsValues(){return {enabled:$("cleanup-enabled").value==="true",remove_dc:$("cleanup-dc").value==="true",highpass_hz:Number($("cleanup-highpass").value),peak_dbfs:Number($("cleanup-peak").value),fade_ms:Number($("cleanup-fade").value),denoise_db:Number($("cleanup-denoise").value),noise_start:$("noise-start").value===""?null:Number($("noise-start").value),noise_end:$("noise-end").value===""?null:Number($("noise-end").value)};}
$("save-audio-settings").onclick=task(async()=>{
  const settings=audioSettingsValues();
  const id=recordingId,snapshot=pretty(settings);
  const saved=await api("/api/audio-settings",{recording_id:id,settings,expected_revision:cleanupRevision});
  if(recordingId===id){
    cleanupRevision=saved.revision;regionRevision=saved.revision;
    const pending=regionDrafts.get(id);if(pending)pending.revision=saved.revision;
    if(pretty(audioSettingsValues())===snapshot){cleanupDirty=false;paintedRecord=null;}
  }
  await refresh();toast("Cleanup settings saved. Compare the original and cleaned previews.");
});
async function qualityPreview(processed) {
  if(processed&&cleanupDirty)throw new Error("Save cleanup settings before previewing the cleaned signal.");
  const selected=qualitySelection();const response=await fetch("/api/preview?"+new URLSearchParams({...selected,channel:selected.channel??"",processed:processed?"1":"0"}));
  if(!response.ok)throw new Error((await response.json()).error||"Preview failed.");
  const url=URL.createObjectURL(await response.blob()), player=$("audio-player");
  if(player.dataset.blob)URL.revokeObjectURL(player.dataset.blob);player.src=url;player.dataset.blob=url;player.dataset.record="preview";await player.play();
}
$("preview-original").onclick=task(()=>qualityPreview(false));$("preview-cleaned").onclick=task(()=>qualityPreview(true));$("quality-button").onclick=task(()=>job("quality",qualitySelection()));
function drawWave(record) {
  const canvas=$("waveform"),ctx=canvas.getContext("2d"),width=canvas.width,height=canvas.height;
  ctx.clearRect(0,0,width,height);ctx.strokeStyle="#dbe3d0";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,height/2);ctx.lineTo(width,height/2);ctx.stroke();
  const values=record.waveform,peak=Math.max(...values,0.001),step=width/values.length;
  ctx.fillStyle="#708a5c";values.forEach((v,i)=>{const h=Math.max(2,v/peak*88);ctx.fillRect(i*step,height/2-h/2,Math.max(1,step*.55),h);});
  ctx.fillStyle="#647957";ctx.font="15px Segoe UI";ctx.fillText("0:00",14,125);ctx.fillText(duration(record.duration),width-54,125);
}
function renderRegions() {
  $("region-count").textContent=`(${rows.length})`;
  if(!rows.length){$("region-rows").innerHTML="<tr><td colspan='5' class='muted-empty'>Find regions or add a region manually.</td></tr>";return;}
  $("region-rows").innerHTML=rows.map((s,i)=>`<tr data-index="${i}"><td><div class="time-pair"><input data-field="start" type="number" step="0.01" min="0" value="${s.start.toFixed(2)}" aria-label="Region start"><input data-field="end" type="number" step="0.01" min="0" value="${s.end.toFixed(2)}" aria-label="Region end"></div></td><td><input data-field="speaker" value="${esc(s.speaker)}" aria-label="Speaker label"><input data-field="style" value="${esc(s.style)}" placeholder="neutral / gentle / urgent" aria-label="Reference style"></td><td><select data-field="channel" aria-label="Audio channel"><option value="">Mono mix</option>${Array.from({length:currentRecord().channels},(_,ch)=>`<option value="${ch}" ${s.channel===ch?"selected":""}>Channel ${ch+1}</option>`).join("")}</select><select data-field="purity" aria-label="Reference review status">${[["unreviewed","Unreviewed"],["user_declared_single_voice","Declared one voice"],["model_nonoverlap","Model detected"],["reviewed_single_voice","Reviewed one voice"]].map(([key,title])=>`<option value="${key}" ${s.purity===key?"selected":""}>${title}</option>`).join("")}</select></td><td><textarea data-field="text" rows="2" placeholder="Transcript / voice log" aria-label="Voice log">${esc(s.text)}</textarea></td><td><button class="play-button" data-preview="${i}" aria-label="Preview region">▶</button><button class="delete-button" data-delete="${i}" aria-label="Delete region">×</button></td></tr>`).join("");
  $("region-rows").querySelectorAll("[data-field]").forEach(el=>el.addEventListener("input",()=>{const row=rows[Number(el.closest("tr").dataset.index)],key=el.dataset.field;row[key]=key==="channel"?(el.value===""?null:Number(el.value)):key==="start"||key==="end"?Number(el.value):el.value;rowsDirty=true;rememberRegions();}));
  $("region-rows").querySelectorAll("[data-delete]").forEach(el=>el.onclick=()=>{rows.splice(Number(el.dataset.delete),1);rowsDirty=true;rememberRegions();renderRegions();});
  $("region-rows").querySelectorAll("[data-preview]").forEach(el=>el.onclick=task(async()=>{
    const s=rows[Number(el.dataset.preview)];const query=new URLSearchParams({recording_id:recordingId,start:s.start,end:Math.min(s.end,s.start+60),channel:s.channel??""});
    const player=$("audio-player");player.src="/api/preview?"+query;player.dataset.record="preview";await player.play();
  }));
}
function renderBindings(record) {
  const speakers=[...new Set(record.segments.map(s=>s.speaker))];
  const container=$("speaker-bindings"),key=JSON.stringify([record.id,speakers]);
  if(container.dataset.key!==key){
    container.dataset.key=key;
    container.innerHTML=speakers.length?"<div class='panel-heading research-heading'><h2>Assign named profiles</h2><button class='text-button' id='binding-new-profile'>+ New profile</button></div>"+speakers.map(s=>`<div class="binding"><b>${esc(s)}</b><span>→</span><select data-speaker="${esc(s)}" aria-label="Assign ${esc(s)} to a profile"></select></div>`).join(""):"";
  }
  const profileKey=JSON.stringify(state.profiles.map(p=>[p.id,p.name]));
  container.querySelectorAll("select[data-speaker]").forEach(el=>{
    // Retain the select element and its event path while profiles are added.
    if(el.dataset.profiles!==profileKey){
      el.replaceChildren(new Option("Unassigned",""),...state.profiles.map(p=>new Option(p.name,p.id)));
      el.dataset.profiles=profileKey;
    }
    el.value=record.bindings[el.dataset.speaker]||"";
  });
  if($("binding-new-profile"))$("binding-new-profile").onclick=showProfileDialog;
}
$("speaker-bindings").addEventListener("change",task(async event=>{
  const el=event.target.closest("select[data-speaker]");if(!el)return;
  requireSaved("analyze");const rid=recordingId,speaker=el.dataset.speaker,selected=el.value||null,revision=regionRevision;bindingBusy=true;el.disabled=true;
  try{await api("/api/bind",{recording_id:rid,speaker,profile_id:selected,expected_revision:revision});}
  finally{bindingBusy=false;el.disabled=false;paintedRecord=null;}
  await refresh();toast("Speaker track linked to the selected voice profile.");
}));
function showProfileDialog() {if(characterDirty){toast("Save your character edits before creating another profile.",true);return;}$("profile-dialog").showModal();$("new-profile-name").focus();}
$("new-profile-button").onclick=showProfileDialog;$("cancel-profile-button").onclick=()=>$("profile-dialog").close();
$("new-profile-form").onsubmit=task(async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.target));const p=await api("/api/profiles",values);rememberCharacter();profileId=p.id;paintedProfile=null;characterDirty=false;$("profile-dialog").close();event.target.reset();paintedRecord=null;await refresh();toast("Character / voice profile created.");});

function characterToEditor(c) {
  characterDraft=structuredClone(c);
  $("character-kind").value=c.kind||"unspecified";$("character-incarnation").value=c.incarnation||"";$("character-bio").value=c.biography||"";
  for(const key of ["demographics","statistics","persona"])$("character-"+key).value=pretty(c[key]);
  for(const key of ["system","dialogue","scenario"])$("character-"+key).value=c.prompts?.[key]||"";
  $("character-canon").value=c.canon_notes||"";$("character-citations").value=pretty(c.field_sources);
}
function editorToCharacter() {
  const result=structuredClone(characterDraft||currentProfile()?.character||{});
  result.kind=$("character-kind").value;result.incarnation=$("character-incarnation").value;result.biography=$("character-bio").value;
  for(const key of ["demographics","statistics","persona"]) {try{result[key]=JSON.parse($("character-"+key).value||"{}");}catch{throw new Error(`Fix the ${key} JSON before saving.`);}}
  result.prompts={...(result.prompts||{}),system:$("character-system").value,dialogue:$("character-dialogue").value,scenario:$("character-scenario").value};
  result.canon_notes=$("character-canon").value;
  try{result.field_sources=JSON.parse($("character-citations").value||"{}");}catch{throw new Error("Fix the field citations JSON before saving.");}
  return result;
}
$("profile-editor").querySelectorAll("input,textarea,select").forEach(el=>{if(el.id.startsWith("character-"))el.addEventListener("input",()=>{characterDirty=true;rememberCharacter();$("character-save-note").textContent="Unsaved character edits.";});});
function renderProfile() {
  const p=currentProfile();$("profile-empty").hidden=!!p;$("profile-editor").hidden=!p;if(!p)return;
  const linked=state.recordings.flatMap(r=>r.segments.filter(s=>r.bindings[s.speaker]===p.id).map(s=>({...s,record:r})));
  $("profile-title").textContent=p.name;$("profile-coverage").textContent=`${linked.length} voice regions · ${p.sources?.length||0} sources`;
  if(!characterDirty&&paintedProfile!==p.id+":"+(p.updated_at||p.created_at)){
    paintedProfile=p.id+":"+(p.updated_at||p.created_at);$("character-name").value=p.name;$("character-language").value=p.language;characterToEditor(p.character||{});$("character-save-note").textContent="Unknown information can remain empty.";
    characterRevision=p.revision??0;$("draft-report").innerHTML="";
    const draft=characterDrafts.get(p.id);
    if(draft){characterDraft=structuredClone(draft.character);for(const [id,value] of Object.entries(draft.values))$(id).value=value;characterRevision=draft.revision;characterDirty=true;$("draft-report").innerHTML=draft.report;$("character-save-note").textContent="Unsaved character edits restored.";}
  }
  renderSources(p);
  const logs=linked.map(s=>`<div class="voice-log"><div class="muted">${s.start.toFixed(1)}–${s.end.toFixed(1)}s<br>${esc(s.style)}</div><div><p>${esc(s.text||"No manual transcript yet.")}</p><div class="muted">${esc(s.record.name)} · ${esc(s.speaker)} · ${esc(s.purity)}</div></div></div>`);
  for(const record of state.recordings)for(const segment of record.transcript_rows||[]){
    if(segment.assignment!=="manual"&&segment.profile_id===p.id)logs.push(`<div class="voice-log"><div class="muted">${segment.start.toFixed(1)}–${segment.end.toFixed(1)}s<br>ASR</div><div><p>${esc(segment.text)}</p><div class="muted">${esc(record.name)} · ${esc(segment.assignment)} · review timing attribution</div></div></div>`);
  }
  $("voice-logs").innerHTML=logs.join("")||"<div class='muted-empty'>Assign a speaker track from Recordings to collect voice logs here.</div>";
}
async function saveCharacter() {
  const id=profileId,values=characterValues();rememberCharacter();
  const saved=await api("/api/character",{profile_id:id,character:editorToCharacter(),name:values["character-name"],language:values["character-language"],expected_revision:characterRevision});
  const pending=characterDrafts.get(id);
  if(!pending||pretty(pending.values)===pretty(values)){characterDrafts.delete(id);if(profileId===id){characterDirty=false;paintedProfile=null;}}
  else pending.revision=saved.revision;
  if(profileId===id)characterRevision=saved.revision;
  await refresh();
}
$("save-character-button").onclick=task(async()=>{await saveCharacter();toast("Character context and source citations saved.");});
$("discard-character-button").onclick=()=>{characterDrafts.delete(profileId);characterDirty=false;paintedProfile=null;renderProfile();};
$("apply-character-json").onclick=task(async()=>{const value=JSON.parse($("character-full-json").value);if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Paste a character object or an object with a character field.");const c=value.character||value;characterToEditor({...editorToCharacter(),...c});characterDirty=true;rememberCharacter();toast("JSON applied to the editor. Save the character to keep it.");});

function renderSources(p) {
  $("sources-list").innerHTML=(p.sources||[]).map(s=>`<div class="source-card"><div class="source-controls"><b>${esc(s.title)}</b><button class="text-button" data-view-source="${s.id}">Read source ↗</button></div><div class="source-id">${s.id}</div><p>${esc(s.kind)} · ${s.text_characters.toLocaleString()} characters · ${esc(s.review_status)}</p>${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open original source</a>`:""}${s.warnings?.length?`<div class="source-note">${s.warnings.map(esc).join("<br>")}</div>`:""}</div>`).join("")||"<div class='muted-empty'>Attach sources to keep research traceable.</div>";
  $("sources-list").querySelectorAll("[data-view-source]").forEach(el=>el.onclick=task(()=>viewSource(el.dataset.viewSource)));
}
async function viewSource(sid) {
  const id=profileId,result=await api("/api/source?"+new URLSearchParams({profile_id:id,source_id:sid}));if(profileId!==id)return;activeSource=result.source;
  $("source-viewer").hidden=false;$("source-title").textContent=result.source.title;$("source-text").value=result.text;$("source-find").value="";$("source-matches").innerHTML="";
  $("source-claims").innerHTML=(result.source.claims||[]).map((c,i)=>`<div class="claim"><b>${esc(c.label)}</b>${esc(c.display_value)}<div><select data-claim-category="${i}"><option value="demographics">Demographics</option><option value="statistics">Statistics</option></select> <input data-claim-field="${i}" value="${esc(c.label.replace(/[^a-zA-Z0-9]+/g,"_"))}" aria-label="Character field"><button class="text-button" data-adopt-claim="${i}">Add sourced field</button></div></div>`).join("");
  $("source-claims").querySelectorAll("[data-adopt-claim]").forEach(el=>el.onclick=task(async()=>{const i=Number(el.dataset.adoptClaim),claim=activeSource.claims[i],category=document.querySelector(`[data-claim-category="${i}"]`).value,field=document.querySelector(`[data-claim-field="${i}"]`).value.trim();if(!field||["__proto__","constructor","prototype"].includes(field))throw new Error("Choose a valid character field name.");const c=editorToCharacter();c[category][field]={value:claim.display_value,raw_value:claim.value,source_id:activeSource.id,property:claim.property,qualifiers:claim.qualifiers,statement_id:claim.statement_id,references:claim.references,rank:claim.rank,review_status:"user_selected"};c.field_sources[category+"."+field]=[...(c.field_sources[category+"."+field]||[]),activeSource.id];characterToEditor(c);characterDirty=true;rememberCharacter();toast("Sourced field added to the editor. Save to keep it.");}));
}
$("close-source").onclick=()=>$("source-viewer").hidden=true;
$("source-find-button").onclick=task(async()=>{if(!activeSource)return;const result=await api("/api/source?"+new URLSearchParams({profile_id:profileId,source_id:activeSource.id,q:$("source-find").value}));$("source-matches").innerHTML=result.matches?.map(m=>`<div class="match">${esc(m.excerpt)}</div>`).join("")||"<div class='muted-empty'>No matches. Enter a word or phrase to find within this source.</div>";});
function renderResearch(result) {
  $("research-results").innerHTML=result.results.map((r,i)=>`<div class="research-result"><span class="small-label">${esc(r.provider)}</span><b>${esc(r.title)}</b><p>${esc(r.description)}</p><button class="text-button" data-collect="${i}">Attach this source ↗</button></div>`).join("")+(result.errors||[]).map(e=>`<div class="source-note">${esc(e.provider)}: ${esc(e.message)}</div>`).join("")||"<div class='muted-empty'>No matching sources found. Import a document or add a URL.</div>";
  $("research-results").querySelectorAll("[data-collect]").forEach(el=>el.onclick=task(async()=>{const r=result.results[Number(el.dataset.collect)];await job("source",{profile_id:profileId,provider:r.provider,key:r.key});}));
}
$("research-button").onclick=task(()=>job("research",{query:$("research-query").value}));
$("source-url-button").onclick=task(()=>job("source",{profile_id:profileId,provider:"url",key:$("source-url").value}));
$("draft-character-button").onclick=task(async()=>{if(characterDirty)await saveCharacter();await job("character_draft",{profile_id:profileId});});
$("source-import-button").onclick=()=>$("source-input").click();
$("source-input").onchange=task(async event=>{const id=profileId;for(const file of event.target.files){await api("/api/source-import?"+new URLSearchParams({profile_id:id,name:file.name}),file,true);}await refresh();toast("Reference documents imported. Review their extraction notes.");event.target.value="";});

$("import-button").onclick=()=>$("audio-input").click();$("dropzone").onclick=()=>$("audio-input").click();$("dropzone").onkeydown=e=>{if(e.key==="Enter"||e.key===" "){$("audio-input").click();e.preventDefault();}};
async function importFiles(files) {
  if(cleanupDirty)throw new Error("Save or discard cleanup settings before importing more audio.");
  rememberRegions();uploadBusy=true;toast("Importing audio and preparing its preview…");
  try{for(const file of files){if(file.size>250*1024*1024)throw new Error("Audio upload limit is 250 MiB. Split large recordings.");const record=await api("/api/import?"+new URLSearchParams({name:file.name}),file,true);recordingId=record.id;}paintedRecord=null;rowsDirty=false;await refresh();toast("Audio imported. Choose a processing mode or add regions manually.");}
  finally{uploadBusy=false;}
}
$("audio-input").onchange=task(async e=>{await importFiles(e.target.files);e.target.value="";});
for(const name of ["dragenter","dragover"])$("dropzone").addEventListener(name,e=>{e.preventDefault();$("dropzone").classList.add("dragging");});
$("dropzone").ondragleave=()=>$("dropzone").classList.remove("dragging");$("dropzone").ondrop=task(async e=>{e.preventDefault();$("dropzone").classList.remove("dragging");await importFiles(e.dataTransfer.files);});
$("analyze-button").onclick=task(()=>job("analyze",{recording_id:recordingId,method:$("analysis-method").value,speaker_count:$("speaker-count").value?Number($("speaker-count").value):null}));
$("transcribe-button").onclick=task(()=>job("transcribe",{recording_id:recordingId,model:$("whisper-model").value,language:$("whisper-language").value||null}));
$("separate-button").onclick=task(()=>job("separate",{recording_id:recordingId,start:Number($("separate-start").value),end:Number($("separate-end").value)}));
$("add-region-button").onclick=()=>{rows.push({start:0,end:Math.min(5,currentRecord().duration),speaker:"VOICE_01",channel:null,purity:"unreviewed",text:"",style:"neutral"});rowsDirty=true;rememberRegions();renderRegions();};
$("save-regions-button").onclick=task(async()=>{const id=recordingId,snapshot=pretty(rows);rememberRegions();const saved=await api("/api/segments",{recording_id:id,segments:rows,expected_revision:regionRevision});const pending=regionDrafts.get(id);if(!pending||pretty(pending.rows)===snapshot){regionDrafts.delete(id);if(recordingId===id){rowsDirty=false;paintedRecord=null;}}else pending.revision=saved.revision;if(recordingId===id){regionRevision=saved.revision;cleanupRevision=saved.revision;}await refresh();toast("Speaker regions and voice logs saved.");});
$("discard-regions-button").onclick=()=>{regionDrafts.delete(recordingId);rowsDirty=false;cleanupDirty=false;paintedRecord=null;renderRecording();};
$("demo-button").onclick=task(()=>job("demo"));
$("export-button").onclick=task(()=>job("export",{encoding:$("export-encoding").value,quality_policy:$("export-quality-policy").value}));
$("expression-button").onclick=task(()=>job("expression",{profile_id:$("expression-profile").value,text:$("expression-text").value,style:$("expression-style").value,rate:Number($("expression-rate").value),pitch:Number($("expression-pitch").value),volume:Number($("expression-volume").value),encoding:$("export-encoding").value,quality_policy:$("export-quality-policy").value}));
$("expression-download").onclick=()=>{const blob=new Blob([pretty(expression)],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="expression_request.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function renderCapabilities() {$("capabilities").innerHTML=[["Manual / channel extraction",true],["Automatic speakers",state.capabilities.pyannote],["Transcription",state.capabilities.transcription],["Overlap separation",state.capabilities.separation]].map(([title,ready])=>`<span class="capability ${ready?"ready":""}">${ready?"●":"○"} ${title} · ${ready?"package available":"setup needed"}</span>`).join("");}
task(refresh)();setInterval(()=>task(refresh)(),1800);
window.addEventListener("beforeunload",event=>{if(hasPendingEdits()){event.preventDefault();event.returnValue="";}});

function hasPendingEdits(){return !!(rowsDirty||cleanupDirty||characterDirty||regionDrafts.size||characterDrafts.size||renderReviewDrafts.size);}
function renderRenders(){
 const list=state.renders||[],key=pretty(list);if(key===rendersKey)return;rendersKey=key;
 $("render-list").innerHTML=list.length?list.map(r=>`<article class="render-card"><h3>${esc(r.request.text)}</h3><p>${esc(r.review_status.replaceAll("_"," "))} · ${r.duration_seconds.toFixed(2)} s · ${r.steps} steps · Seed ${r.seed}</p><label>Rendered speech<audio controls preload="none" src="${r.audio_path}"></audio></label><label>Selected reference<audio controls preload="none" src="${r.reference_audio_path}"></audio></label><p><a href="${r.audio_path}?download=1">Download WAV</a> · <a href="${r.receipt_path}?download=1">Download receipt</a></p><label>Listening review notes<textarea id="review-${r.id}" data-review="${r.id}" maxlength="10000">${esc(renderReviewDrafts.get(r.id)||"")}</textarea></label><button data-approve="${r.id}" class="secondary">Approve</button><button data-revise="${r.id}" class="text-button">Needs revision</button><details><summary>Measurements & provenance</summary><pre>${esc(pretty(r))}</pre></details></article>`).join(""):"<p>No rendered statements yet. Link a reviewed reference, then render local speech.</p>";
 $("render-list").querySelectorAll('[data-review]').forEach(el=>el.oninput=()=>renderReviewDrafts.set(el.dataset.review,el.value));
 for(const [attr,status] of [["approve","approved"],["revise","needs_revision"]])$("render-list").querySelectorAll('[data-'+attr+']').forEach(el=>el.onclick=task(async()=>{const id=el.dataset[attr],notes=$("review-"+id).value;await api("/api/render-review",{render_id:id,status,notes});if(renderReviewDrafts.get(id)===notes)renderReviewDrafts.delete(id);await refresh();toast("Listening review saved.");}));
}
$("render-button").onclick=task(()=>job("render",{profile_id:$("expression-profile").value,text:$("expression-text").value,style:$("expression-style").value,rate:Number($("expression-rate").value),pitch:Number($("expression-pitch").value),volume:Number($("expression-volume").value),quality_policy:$("export-quality-policy").value,reference_text:$("reference-words").value,scene_notes:$("scene-notes").value,steps:Number($("render-steps").value),seed:Number($("render-seed").value)}));
$("rebecca-button").onclick=task(()=>job("rebecca"));
$("portable-button").onclick=task(()=>{requireSaved("portable_import");$("portable-input").click();});
$("portable-input").onchange=task(async event=>{const file=event.target.files[0];if(!file)return;requireSaved("portable_import");uploadBusy=true;try{const result=await api("/api/portable-import",file,true);recordingId=result.recording_ids[0]||recordingId;profileId=result.profile_ids[0]||profileId;paintedRecord=null;paintedProfile=null;await refresh();toast("Reference archive restored with its originals.");}finally{uploadBusy=false;event.target.value="";}});
