export const LLAMA_VERSION = "b10242";

export const LLAMA_RUNTIME_ASSETS = Object.freeze({
  "linux-x64": Object.freeze({
    name: `llama-${LLAMA_VERSION}-bin-ubuntu-x64.tar.gz`,
    sha256: "fb13c9fa97a605c6bba16a99b2f54eff6874d58bdbe5b94ece6e358eaa270088",
  }),
  "linux-arm64": Object.freeze({
    name: `llama-${LLAMA_VERSION}-bin-ubuntu-arm64.tar.gz`,
    sha256: "c79ae4262304cdab2698201b1bba01648fcff8f8aada237b64797bc97ebe452d",
  }),
  "darwin-x64": Object.freeze({
    name: `llama-${LLAMA_VERSION}-bin-macos-x64.tar.gz`,
    sha256: "d7ccf0251ff9087ee4f4c0ea6c8c7f4f3575aa187b2c2e755d2d4c5d234490ba",
  }),
  "darwin-arm64": Object.freeze({
    name: `llama-${LLAMA_VERSION}-bin-macos-arm64.tar.gz`,
    sha256: "fd93f5c97086b434d17855eaaf95ba56758ade7a4af3a4ad74714bb70784c8b9",
  }),
  "win32-x64": Object.freeze({
    name: `llama-${LLAMA_VERSION}-bin-win-cpu-x64.zip`,
    sha256: "a9b8966b2ed82d33a87cafb4149a1b40de48a701a0ec431f2d8f5b994827a758",
  }),
});
