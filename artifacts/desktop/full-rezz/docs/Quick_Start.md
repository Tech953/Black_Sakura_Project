# Local voice repair candidate — quick start

This guide describes the active ENGRAM integration on the review branch. Imported material under `components/full_rezz/upstream` is preserved historical source, with separate checksums.

1. Use a Windows desktop package containing the verified FULL_REZZ runtime. A source checkout or an ordinary desktop build without staged models cannot synthesize or transcribe audio. No Python, Node, API key, model service, or first-run download should be required of the installed application's user.
2. Open a writable conversation. Choose **Transcription language**, or leave it on Automatic. Choose **Record microphone**, then **Stop and transcribe locally**. Recording stops automatically after about 55 seconds, below the 60-second decoding limit.
3. Review the transcript in the message composer before sending. It is never sent automatically. Cancel discards the capture or pending transcription. Navigating to another conversation releases the microphone. Archived conversations and archival engrams cannot start this flow.
4. To speak a saved reply, first import and explicitly bind the intended reference profile. Select **Speech language** and **Voice engine**. Reference-conditioned F5 supports English and Mandarin. Other languages require an explicit generic eSpeak selection, which does not imitate the character.
5. Choose **Speak saved reply**. Listen and record the five review ratings. An ASR agreement score or signal-check pass cannot approve pronunciation, likeness, purity, or naturalness.

If the local runtime is unavailable, repair the complete installed bundle. There is no cloud speech fallback. Microphone capture requires HTTPS or localhost in a supported browser. Microphone uploads are limited to 12 MiB; temporary server audio is removed after success, failure, or cancellation.

The two-source separator produces 8 kHz estimated audio. This is not high-fidelity isolation; only reviewed standard-quality export can accept it. Full-band isolation and Windows hardware acceptance remain release gates.
