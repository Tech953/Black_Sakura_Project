// Reviewed upstream identities. Model bytes must never be accepted by URL alone.
export const SOURCE = {
  repository: "Tech953/Black_Sakura_Project",
  revision: "9887d8978ca0af70301885a4aee399f5dcf6c659",
  prefix: "artifacts/desktop/full-rezz/",
  inventorySha256: "c3ddc8cd1befae275a7b259fc43198e58155e736014d616f313595c41e9b69a8",
};

const hf = (repository, revision, license, entries) => entries.map(
  ([file, path, bytes, digest, lfs = false]) => ({
    path, bytes, license,
    url: `https://huggingface.co/${repository}/resolve/${revision}/${file}`,
    ...(lfs ? { sha256: digest } : { gitBlob: digest }),
  }),
);

export const MODEL_ASSETS = [
  ...hf("SWivid/F5-TTS", "84e5a410d9cead4de2f847e7c9369a6440bdfaca", "CC-BY-NC-4.0", [
    ["F5TTS_v1_Base/model_1250000.safetensors", "tts/model_1250000.safetensors", 1348435761, "670900fd14e6c458b95da6e9ed317cdb20dbaf7a1c02ac06a05475a9d32b6a38", true],
    ["F5TTS_v1_Base/vocab.txt", "tts/vocab.txt", 13800, "cd934390e8f4b3ce98eb319ae618c084d01504b5"],
  ]),
  ...hf("charactr/vocos-mel-24khz", "0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21", "MIT", [
    ["config.yaml", "vocos/config.yaml", 461, "538262138a8b43863802f279909f26ec31c766b3"],
    ["pytorch_model.bin", "vocos/pytorch_model.bin", 54365991, "97ec976ad1fd67a33ab2682d29c0ac7df85234fae875aefcc5fb215681a91b2a", true],
  ]),
  ...hf("Systran/faster-whisper-base", "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66", "MIT", [
    ["config.json", "asr/config.json", 2309, "867cf1a0fece1394e01d55e287ba2f09a577c046"],
    ["model.bin", "asr/model.bin", 145217532, "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9", true],
    ["tokenizer.json", "asr/tokenizer.json", 2203239, "7818adb6de9fa3064d3ff81226fdd675be1f6344"],
    ["vocabulary.txt", "asr/vocabulary.txt", 459861, "c9074644d9d1205686f16d411564729461324b75"],
  ]),
];

export const NOTICES = [
  ...hf("SWivid/F5-TTS", "84e5a410d9cead4de2f847e7c9369a6440bdfaca", "CC-BY-NC-4.0", [
    ["README.md", "F5-TTS-model-card.md", 630, "ab52c656ddb4f42f47a60f7ee4d747237a4803fe"],
  ]),
  ...hf("charactr/vocos-mel-24khz", "0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21", "MIT", [
    ["README.md", "Vocos-model-card.md", 1830, "226bd9452b8561a28a5633a4e1576e883984cc5f"],
  ]),
  ...hf("Systran/faster-whisper-base", "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66", "MIT", [
    ["README.md", "Whisper-model-card.md", 1991, "cddfec65ffb3e3df45d2234f09f3d261bf9a9c0a"],
  ]),
  {
    path: "CC-BY-NC-4.0.txt", license: "CC-BY-NC-4.0",
    url: "https://creativecommons.org/licenses/by-nc/4.0/legalcode.txt",
    sha256: "41003d4a74749c0220e33dd415042164b5a1093ed401f36277234f772d22d3d0",
  },
  {
    path: "Vocos-MIT.txt", license: "MIT",
    url: "https://raw.githubusercontent.com/gemelo-ai/vocos/main/LICENSE",
    sha256: "8f36ba0c214d4f487ffd7ee0b8528da9b67b459bef2d115de9cd001316589f46",
  },
  {
    path: "Whisper-MIT.txt", license: "MIT",
    url: "https://raw.githubusercontent.com/openai/whisper/main/LICENSE",
    sha256: "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d",
  },
];

export const BUNDLE_NOTICE = `# FULL_REZZ personal, noncommercial asset stage

This is an INCOMPLETE runtime stage, not a working installer or a verified
Windows/Android speech runtime. The owner selected personal noncommercial use.
Build-time downloads are allowed; installation and runtime must not download.

## Attribution and terms

F5-TTS / F5TTS_v1_Base by SWivid and the F5-TTS authors:
https://github.com/SWivid/F5-TTS
https://huggingface.co/SWivid/F5-TTS
Pretrained weights are CC-BY-NC-4.0. Full legal text is licenses/CC-BY-NC-4.0.txt;
model-card attribution and references are in licenses/F5-TTS-model-card.md.
Model weights and vocabulary are unchanged. No training or weight modification
is performed. Retain attribution, license links and change disclosures, do not
imply endorsement, and use/distribute only noncommercially under these terms.
Commercial use needs separate authorization. No additional rights are granted.

Vocos-mel-24khz by Charactr / Vocos authors:
https://huggingface.co/charactr/vocos-mel-24khz
MIT; retain licenses/Vocos-MIT.txt and Vocos-model-card.md.

Whisper base by OpenAI, converted to CTranslate2 by SYSTRAN:
https://github.com/openai/whisper
https://huggingface.co/Systran/faster-whisper-base
MIT; retain licenses/Whisper-MIT.txt and Whisper-model-card.md.
All staged model bytes are unchanged; hashes and pinned revisions are inventoried.
These MIT components are NOT relicensed as CC-BY-NC-4.0.

FULL_REZZ authored source retains its upstream LICENSE and THIRD_PARTY_NOTICES.md.
Dependencies and reference recordings have their own terms. This stage does not
grant likeness, actor-performance, recording, trademark, or other third-party
rights. Supplied reference packs and engram seed data are not imported or edited.

## Renderer boundary and remaining requirements

The source renderer and original neutral Studio Unit demo are included exactly
as upstream supplied. Studio Unit is not Rebecca and is not bound as her avatar.
No character assets are inferred or substituted.

A complete platform Python/dependency runtime, fonts and vendor resources with
verified manifests/notices are still required. Android needs an actual native
FULL_REZZ speech implementation. Target-platform fresh-install/network-off
acceptance is still required. Asset verification alone proves none of these.
`;
