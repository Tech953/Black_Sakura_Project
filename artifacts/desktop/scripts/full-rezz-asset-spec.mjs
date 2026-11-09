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
  ...hf("speechbrain/spkrec-ecapa-voxceleb", "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286", "Apache-2.0", [
  [
    "hyperparams.yaml",
    "speaker/hyperparams.yaml",
    1919,
    "6f78854fa04ba59e761437b76a2575d3aba5e5016de3e9b69f0c9a5077fb1a41",
    true
  ],
  [
    "embedding_model.ckpt",
    "speaker/embedding_model.ckpt",
    83316686,
    "0575cb64845e6b9a10db9bcb74d5ac32b326b8dc90352671d345e2ee3d0126a2",
    true
  ],
  [
    "mean_var_norm_emb.ckpt",
    "speaker/mean_var_norm_emb.ckpt",
    1921,
    "cd70225b05b37be64fc5a95e24395d804231d43f74b2e1e5a513db7b69b34c33",
    true
  ],
  [
    "classifier.ckpt",
    "speaker/classifier.ckpt",
    5534328,
    "fd9e3634fe68bd0a427c95e354c0c677374f62b3f434e45b78599950d860d535",
    true
  ],
  [
    "label_encoder.txt",
    "speaker/label_encoder.txt",
    128619,
    "e13c3a167bb4112685670ee896d20e2b565af16b3a4ceeaa8689fa4d22adb8b9",
    true
  ]
]),
  ...hf("speechbrain/sepformer-wsj02mix", "3a2826343a10e2d2e8a75f79aeab5ff3a2473531", "Apache-2.0", [
  [
    "hyperparams.yaml",
    "separator/hyperparams.yaml",
    1515,
    "939c86a8d36c52ae148859de34a3e7b984f4b576213957bdba09462cc88168bf",
    true
  ],
  [
    "encoder.ckpt",
    "separator/encoder.ckpt",
    17267,
    "3139bb880b29ea77ae8a168b8f2ad6e8eb5c2c0904289676c223d0e93cd2a35d",
    true
  ],
  [
    "decoder.ckpt",
    "separator/decoder.ckpt",
    17202,
    "abea1a2d41151331b4c36071d1b3205aed940a189721f008b12a703e9c63e7e4",
    true
  ],
  [
    "masknet.ckpt",
    "separator/masknet.ckpt",
    113108458,
    "57dd5f49bf21c5a2101bb4e46648d05d34d517a59e26f0b06646d0bebe8214c7",
    true
  ]
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
  ...hf("speechbrain/spkrec-ecapa-voxceleb", "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286", "Apache-2.0", [
    ["README.md", "ECAPA-model-card.md", 5377, "6023cecccb30eba7ed77fea84a9e47d334dd3a6c"],
  ]),
  ...hf("speechbrain/sepformer-wsj02mix", "3a2826343a10e2d2e8a75f79aeab5ff3a2473531", "Apache-2.0", [
    ["README.md", "SepFormer-model-card.md", 4163, "437fca933723bb3e180011190f3438613db38d02"],
  ]),
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
SpeechBrain ECAPA and SepFormer model cards declare Apache-2.0; retain both model cards.
SepFormer produces 8 kHz two-source estimates; high-fidelity isolation remains unaccepted.
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
