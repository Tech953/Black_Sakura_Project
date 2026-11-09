import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRequire = createRequire(path.join(web, "../desktop/package.json"));
const { build } = desktopRequire("esbuild");
const { chromium } = desktopRequire("playwright-core");
const temp = await mkdtemp(path.join(tmpdir(), "voice-browser-"));
const fixture = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{LocalVoiceControls}from'./components/local-voice-controls';
window.evidence={calls:[],stops:0,captures:0,aborts:0,hold:false,available:true};
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{window.evidence.captures++;return{getTracks:()=>[{stop:()=>window.evidence.stops++}]};}}});
class Recorder{static isTypeSupported(){return true;}state='inactive';mimeType='audio/webm';constructor(){}start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['fixture'])});this.onstop?.();});}}
window.MediaRecorder=Recorder;
async function localFetch(url,init){if(url.endsWith('/status'))return new Response(JSON.stringify({available:window.evidence.available}));window.evidence.calls.push({url,language:init.body.get('language')});if(window.evidence.hold)return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>{window.evidence.aborts++;reject(new DOMException('cancelled','AbortError'));}));return new Response(JSON.stringify({text:'reviewed local transcript'}));}
function App(){const[id,setId]=useState(3);const[draft,setDraft]=useState('');const[disabled,setDisabled]=useState(false);const[settings,setSettings]=useState({synthesis_language:'en',speech_engine:'f5'});return <><button onClick={()=>setId(id+1)}>Switch conversation</button><button onClick={()=>setDisabled(!disabled)}>Toggle archival</button><LocalVoiceControls key={id} conversationId={id} endpoint='/api/full-rezz' authFetch={localFetch} disabled={disabled} onTranscript={setDraft} settings={settings} onSettings={setSettings}/><textarea aria-label='draft' value={draft} readOnly/><output>{JSON.stringify(settings)}</output></>;}createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: {
    contents: fixture,
    loader: "tsx",
    resolveDir: path.join(web, "src"),
  },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  tsconfig: path.join(web, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"test"' },
});
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(bundle.outputFiles[0].contents);
  } else {
    res.setHeader("content-type", "text/html");
    res.end(
      '<!doctype html><div id="root"></div><script src="/app.js"></script>',
    );
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.VOICE_TEST_CHROMIUM
      ? { executablePath: process.env.VOICE_TEST_CHROMIUM }
      : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page
    .getByRole("button", { name: "Record microphone", exact: true })
    .waitFor();
  await page
    .getByLabel("Transcription language", { exact: true })
    .selectOption("fr");
  await page
    .getByRole("button", { name: "Record microphone", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop and transcribe locally" })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("textarea").value === "reviewed local transcript",
  );
  assert.equal(
    await page.evaluate(() => window.evidence.calls[0].language),
    "fr",
  );
  assert.ok(await page.evaluate(() => window.evidence.stops > 0));
  await page.getByLabel("Speech language", { exact: true }).selectOption("ja");
  await page.getByLabel("Voice engine", { exact: true }).selectOption("espeak");
  assert.match(await page.locator("output").textContent(), /ja.*espeak/);
  await page.evaluate(() => (window.evidence.hold = true));
  await page
    .getByRole("button", { name: "Record microphone", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop and transcribe locally" })
    .click();
  await page
    .getByRole("button", { name: "Cancel recording or transcription" })
    .click();
  await page.waitForFunction(() => window.evidence.aborts === 1);
  await page
    .getByRole("button", { name: "Record microphone", exact: true })
    .click();
  const stops = await page.evaluate(() => window.evidence.stops);
  await page.getByRole("button", { name: "Switch conversation" }).click();
  await page.waitForFunction((n) => window.evidence.stops > n, stops);
  await page.getByRole("button", { name: "Toggle archival" }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Record microphone", exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "transcript returned to draft",
        "transcription language forwarded",
        "speech language and engine independent",
        "microphone tracks released",
        "pending transcription aborted",
        "conversation switch releases microphone",
        "archival controls disabled",
      ],
      scope:
        "UI fixture; real microphone hardware and neural inference not exercised",
    }),
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  await rm(temp, { recursive: true, force: true });
}
