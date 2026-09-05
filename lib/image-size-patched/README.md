# Vendored image-size compatibility package

Expo SDK 54's Metro dependency resolves `image-size@1.2.1`. Its ICNS parser and
its ISO-box traversal used by HEIF/JXL can loop forever when a crafted box has a
zero length. No upstream package release fixes the advisory. This local package
keeps the `image-size` CommonJS API Metro consumes, gives the replacement a
post-advisory local version, and rejects malformed or unsupported container
images rather than parsing them indefinitely.

The override is intentionally workspace-wide because Metro is reached through
several Expo dependency paths. The regression test covers each advisory input.