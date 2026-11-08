/* Stateful UI regressions using a minimal DOM harness; this is not a browser rendering test. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const html = fs.readFileSync(path.join(__dirname,"../voice_studio/web/index.html"),"utf8");
const script = fs.readFileSync(path.join(__dirname,"../voice_studio/web/app.js"),"utf8");
const elements = new Map(), events = {};
class Element {
  constructor(id,tag="div",value="") {
    Object.assign(this,{id,tagName:tag.toUpperCase(),value,hidden:false,dataset:{},listeners:{},_html:"",content:"token"});
    this.classList={toggle(){},add(){},remove(){}};
  }
  get innerHTML(){return this._html;}
  set innerHTML(value){this._html=value;for(const match of value.matchAll(/id=['"]([^'"]+)['"]/g))if(!elements.has(match[1]))elements.set(match[1],new Element(match[1]));}
  addEventListener(name,callback){this.listeners[name]=callback;}
  querySelectorAll(selector){
    if(this.id==="profile-editor"&&(/input|character-/.test(selector)))return [...elements.values()].filter(el=>el.id.startsWith("character-")&&["INPUT","TEXTAREA","SELECT"].includes(el.tagName));
    return [];
  }
  getContext(){return {clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillRect(){},fillText(){}};}
  prepend(){} focus(){} close(){} showModal(){} click(){} play(){return Promise.resolve();}
}
for(const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
  const value=/\bvalue="([^"]*)"/.exec(match[2])?.[1]||"";
  elements.set(match[3],new Element(match[3],match[1],value));
}
let fixture;
const response=value=>({ok:true,json:async()=>value});
const context=vm.createContext({document:{getElementById:id=>elements.get(id)||null,querySelector:()=>new Element("meta"),querySelectorAll:()=>[],createElement:()=>new Element("created")},
  window:{addEventListener:(name,callback)=>{events[name]=callback;}},fetch:async()=>response(fixture||{recordings:[],profiles:[],jobs:[],capabilities:{}}),
  structuredClone,URLSearchParams,Blob,URL,FormData:class {},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,console});
const run=code=>vm.runInContext(code,context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const character=()=>({kind:"original",incarnation:"",biography:"Saved canon",demographics:{},statistics:{},persona:{traits:[],motivations:[],goals:[],speech_style:"",mannerisms:"",boundaries:""},prompts:{system:"",dialogue:"",scenario:""},field_sources:{},canon_notes:"",review_status:"draft"});
function reset(){
  fixture={version:"1.2.0",capabilities:{},jobs:[],profiles:[1,2].map(i=>({id:"voice_"+i,name:"Character "+i,language:"en",created_at:"same",revision:1,character:character(),sources:[]})),
    recordings:[1,2].map(i=>({id:"rec_"+i,name:"Recording "+i,duration:4,channels:1,sample_rate:8000,revision:1,waveform:[.2,.3],bindings:{A:"voice_1"},segments:[{id:"seg_1",start:0,end:3,speaker:"A",channel:null,purity:"reviewed_single_voice",text:"Saved words",style:"neutral"}],transcript_rows:[]}))};
  context.fixture=structuredClone(fixture);
  context.fetch=async()=>response(fixture);
  run('state=fixture;recordingId=null;profileId=null;rowsDirty=false;cleanupDirty=false;characterDirty=false;paintedRecord=null;paintedProfile=null;regionDrafts.clear();characterDrafts.clear();submittedJobs.clear();selectRecording("rec_1");selectProfile("voice_1");');
}
let passed=0;
async function test(name,fn){reset();await fn();passed++;console.log("PASS "+name);}
(async()=>{
  vm.runInContext(script,context);await tick();
  await test("character drafts survive profile switching, including invalid JSON",()=>{
    elements.get("character-bio").value="Unsaved canon";elements.get("character-bio").listeners.input();
    elements.get("character-persona").value="{ unfinished";elements.get("character-persona").listeners.input();
    run('selectProfile("voice_2");selectProfile("voice_1")');
    assert.equal(elements.get("character-bio").value,"Unsaved canon");assert.equal(elements.get("character-persona").value,"{ unfinished");
  });
  await test("region drafts survive recording switches",()=>{
    run('rows[0].text="Unsaved voice log";rowsDirty=true;rememberRegions();selectRecording("rec_2");selectRecording("rec_1")');
    assert.equal(run('rows[0].text'),"Unsaved voice log");assert.equal(run('regionRevision'),1);
  });
  await test("polling preserves drafts and their original save revision",()=>{
    run('rows[0].text="Keep me";rowsDirty=true;rememberRegions();state.recordings[0].revision=7;renderRecording()');
    assert.equal(run('rows[0].text'),"Keep me");assert.equal(run('regionRevision'),1);
  });
  await test("export refuses unsaved drafts belonging to another item",()=>{
    elements.get("character-bio").value="Pending";elements.get("character-bio").listeners.input();run('selectProfile("voice_2")');
    assert.throws(()=>run('requireSaved("export")'),/Save pending/);
  });
  await test("audio processing refuses pending edits",()=>{
    run('rowsDirty=true;rememberRegions()');assert.throws(()=>run('requireSaved("transcribe")'),/Save this recording/);
  });
  await test("historical source-draft jobs cannot replace the current character editor",()=>{
    run('completeJob({id:"old_job",kind:"character_draft",status:"completed",result:{profile_id:"voice_1",character:{biography:"Stale source"}}})');
    assert.equal(elements.get("character-bio").value,"Saved canon");
  });
  await test("character voice logs exclude ambiguous mixed ASR words",()=>{
    run('state.recordings[0].transcript_rows=[{start:1,end:2,text:"Ambiguous private words",profile_id:null,assignment:"ambiguous"},{start:2,end:3,text:"Correct words",profile_id:"voice_1",assignment:"timing_heuristic"}];renderProfile()');
    assert.ok(!elements.get("voice-logs").innerHTML.includes("Ambiguous private words"));assert.ok(elements.get("voice-logs").innerHTML.includes("Correct words"));
  });
  await test("discarding edits restores current saved data",()=>{
    elements.get("character-bio").value="Discard me";elements.get("character-bio").listeners.input();elements.get("discard-character-button").onclick();
    assert.equal(elements.get("character-bio").value,"Saved canon");
    run('rows[0].text="Discard me";rowsDirty=true;rememberRegions()');elements.get("discard-regions-button").onclick();assert.equal(run('rows[0].text'),"Saved words");
  });
  await test("edits typed while saving remain as a draft",async()=>{
    let finish;context.fetch=async(url,options)=>options?.method==="POST"?new Promise(resolve=>{finish=()=>resolve(response({revision:2}));}):response(fixture);
    elements.get("character-bio").value="First edit";elements.get("character-bio").listeners.input();const saving=run('saveCharacter()');await tick();
    elements.get("character-bio").value="Later edit";elements.get("character-bio").listeners.input();finish();await saving;
    assert.equal(elements.get("character-bio").value,"Later edit");assert.equal(run('characterDirty'),true);assert.equal(run('characterRevision'),2);
  });
  await test("stale UI saves send the editor's original revision",async()=>{
    let posted;context.fetch=async(url,options)=>{if(options?.method==="POST"){posted=JSON.parse(options.body);return response({revision:2});}return response(fixture);};
    elements.get("character-bio").value="Edited canon";elements.get("character-bio").listeners.input();run('state.profiles[0].revision=9');await run('saveCharacter()');assert.equal(posted.expected_revision,1);
  });
  await test("multi-document uploads stay attached to their initial profile",async()=>{
    const profiles=[];context.fetch=async(url,options)=>{if(options?.method==="POST"){profiles.push(new URL("http://localhost"+url).searchParams.get("profile_id"));if(profiles.length===1)run('selectProfile("voice_2")');return response({id:"src_fixture"});}return response(fixture);};
    await elements.get("source-input").onchange({target:{files:[{name:"one.txt"},{name:"two.txt"}],value:"files"}});assert.deepEqual(profiles,["voice_1","voice_1"]);
  });
  await test("a late source response cannot enter a different profile's editor",async()=>{
    let finish;context.fetch=async()=>new Promise(resolve=>{finish=()=>resolve(response({source:{id:"src_old",title:"Old source"},text:"Old text"}));});
    const viewing=run('viewSource("src_old")');await tick();run('selectProfile("voice_2")');finish();await viewing;assert.equal(run('activeSource'),null);
  });
  await test("cleanup drafts block recording switches and measurement until saved",()=>{
    elements.get("cleanup-peak").value="-8";run('cleanupDirty=true;selectRecording("rec_2")');
    assert.equal(run('recordingId'),"rec_1");assert.equal(elements.get("cleanup-peak").value,"-8");
    assert.throws(()=>run('requireSaved("quality")'),/Save your cleanup/);
    const event={preventDefault(){this.prevented=true;}};events.beforeunload(event);assert.equal(event.prevented,true);
  });
  await test("cleanup saves retain edits typed during the request and use the original revision",async()=>{
    let finish,posted;context.fetch=async(url,options)=>options?.method==="POST"?new Promise(resolve=>{posted=JSON.parse(options.body);finish=()=>resolve(response({revision:2}));}):response(fixture);
    elements.get("cleanup-peak").value="-6";run('cleanupDirty=true;state.recordings[0].revision=9');
    const saving=elements.get("save-audio-settings").onclick();await tick();
    elements.get("cleanup-peak").value="-9";finish();await saving;
    assert.equal(posted.expected_revision,1);assert.equal(elements.get("cleanup-peak").value,"-9");
    assert.equal(run('cleanupDirty'),true);assert.equal(run('cleanupRevision'),2);
  });
  await test("region saves retain edits typed during the request",async()=>{
    let finish,posted;context.fetch=async(url,options)=>options?.method==="POST"?new Promise(resolve=>{posted=JSON.parse(options.body);finish=()=>resolve(response({revision:2}));}):response(fixture);
    run('rows[0].text="First region edit";rowsDirty=true;rememberRegions()');
    const saving=elements.get("save-regions-button").onclick();await tick();
    run('rows[0].text="Later region edit";rememberRegions()');finish();await saving;
    assert.equal(posted.expected_revision,1);assert.equal(run('rows[0].text'),"Later region edit");
    assert.equal(run('rowsDirty'),true);assert.equal(run('regionRevision'),2);
  });
  console.log(passed+" UI state regressions passed (DOM harness; no browser rendering).");
})().catch(error=>{console.error(error);process.exitCode=1;});
