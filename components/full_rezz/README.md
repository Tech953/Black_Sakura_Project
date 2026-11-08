# FULL_REZZ 3.0 source and guides

This component preserves the supplied FULL_REZZ release files for Black Sakura
development. Imported 6 November 2026; the upstream package is dated 14 October
and the refreshed guides are dated 15 October 2026. This import does not rebuild
or certify the application.

## Start here

- [Quick start](guides/FULL_REZZ_Quick_Start.pdf)
- [User guide](guides/FULL_REZZ_User_Guide.pdf)
- [Product audit and open acceptance checks](guides/FULL_REZZ_3.0_Product_Audit.pdf)
- [Replit integration guide](guides/FULL_REZZ_3.0_Replit_Integration_Guide.pdf)
- [All four guides and editable sources](archives/FULL_REZZ_3.0_Guides.zip)

The `guides/` folder also contains the four editable Markdown sources. These
refreshed guides supersede the older download instructions bundled upstream.

## Source and existing host integration

[`upstream/`](upstream) contains all 801 files extracted byte-for-byte from
`FULL_REZZ_3.0_Replit_Source_Core.zip`. Original paths, fonts, authored assets,
reference fixtures, tests, licenses, evidence and build inputs are preserved.
The ZIP is represented by its expanded files, with its original SHA-256
and per-file checksums recorded in [IMPORT_MANIFEST.json](IMPORT_MANIFEST.json).
`upstream/CORE_OMISSIONS.json` retains the package's original exclusion list.

The active, newer Black Sakura integration remains under
[`artifacts/desktop/full-rezz`](../../artifacts/desktop/full-rezz), with its
[host integration notes](../../artifacts/desktop/full-rezz/REPLIT_INTEGRATION.md).
Compare changes there before porting an upstream module. Preserve the host's
`.replit`, package configuration, persistence and existing dialogue flow.

For an isolated source check, change into `components/full_rezz/upstream` and
run `python3 main.py`. The starter reports a reference/action plan and explicitly
does not perform new inference or generate a new animation. Read
[`upstream/TASK_QUERY.md`](upstream/TASK_QUERY.md) before incorporation.

## Windows installer and complete source archives

The small [recovery tools ZIP](archives/FULL_REZZ_3.0_Recovery_Tools.zip) and its
expanded [assembly scripts](recovery/) are committed. The 15 large installer
ZIPs and three complete-source ZIPs are **external downloads**, not Git blobs
or uploaded LFS objects. Git LFS authentication is unavailable in the current
transfer session. `IMPORT_MANIFEST.json` lists every external filename, exact
byte count, SHA-256 and owner-authenticated download link.

Those ChatGPT download links require the owning account; they are not public
GitHub release assets. The preserved [download page](delivery/FULL_REZZ_3.0_Downloads.html)
and [download guide](delivery/FULL_REZZ_3.0_Download_Guide.md) retain the recovery
instructions and original download provenance. Their older `sandbox:` links
refer to the originating workspace; use this component's relative links or the
authenticated browser links instead.

To assemble on Windows, save all 15 installer ZIPs in one folder and extract
only the recovery tools beside them. Leave the installer ZIPs zipped and run
`Assemble_Installer.cmd`. The tools verify the downloads and reconstruct
`FULL_REZZ_3.0_Offline_Windows_x64_Setup.exe`. The three complete-source ZIPs
use `Assemble_Full_Source.cmd`. Keep matching revisions together.

## Evidence and limitations

The product audit preserves the dated rebuild evidence and 40 open artistic
flags. Native Windows installation, audio/GPU operation and human voice/art
acceptance remain open. This commit does not claim those checks have passed.
Delivery at 60/120/240 fps does not imply newly authored poses or unseen anatomy.
The upstream F5 model terms, Qt/eSpeak corresponding-source obligations and
other license notices remain applicable; see the upstream notices and audit.

`IMPORT_MANIFEST.json` distinguishes committed, expanded and external items.
`CHECKSUMS.sha256` verifies the committed component files independently of the
historical delivery checksum list.

## Import verification

The 8 November 2026 check matched all 801 source files to the archived SHA-256
values. The starter ran successfully; the source suite ran 117 tests, with 96
passing and 21 optional raster checks skipped. No native Windows acceptance or
new neural generation was performed. See [IMPORT_VERIFICATION.json](IMPORT_VERIFICATION.json),
[the test log](IMPORT_TEST_RESULTS.txt), and [the starter result](IMPORT_STARTER_RESULT.json).
