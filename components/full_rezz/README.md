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
The original [compact Replit ZIP](https://github.com/Tech953/Black_Sakura_Project/releases/download/full-rezz-3.0-delivery-2026-10-14.3/FULL_REZZ_3.0_Replit_Source_Core.zip) is also attached
to the release. Its original SHA-256 and per-file checksums are recorded in
[IMPORT_MANIFEST.json](IMPORT_MANIFEST.json).
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

All delivery files are attached to the [FULL_REZZ component release](https://github.com/Tech953/Black_Sakura_Project/releases/tag/full-rezz-3.0-delivery-2026-10-14.3).
Use the [GitHub download catalog](delivery/FULL_REZZ_3.0_GitHub_Downloads.html)
or the release's Assets list for the 15 installer ZIPs, three complete-source
ZIPs, direct Replit source ZIP, recovery tools and refreshed guides. The catalog
can be downloaded and opened locally. Public links require no ChatGPT sign-in.

The [GitHub asset checksums](delivery/FULL_REZZ_3.0_GitHub_CHECKSUMS.sha256)
cover all other attached assets. GitHub's returned SHA-256 digest was checked
for every upload. Both complete assembly hashes were also checked against the
original delivery manifest; see [RELEASE_PUBLICATION.json](RELEASE_PUBLICATION.json).

For Windows, save all 15 installer ZIPs in one folder and extract only
`FULL_REZZ_3.0_Recovery_Tools.zip` beside them. Leave the installer ZIPs zipped
and run `Assemble_Installer.cmd`. It verifies the files and reconstructs
`FULL_REZZ_3.0_Offline_Windows_x64_Setup.exe`. Allow about 15 GB of free disk
space for downloads, assembly and installation.

For the complete archival source and third-party corresponding sources, save
all three `FULL_REZZ_3.0_Full_Source_NN_of_03.zip` files beside the extracted
tools, leave them zipped and run `Assemble_Full_Source.cmd`. For Replit, use
the separate direct compact-source ZIP.

The earlier download page and guide under `delivery/` are preserved as dated
provenance. Use the GitHub catalog above for the current public download links.

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
