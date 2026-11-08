# FULL_REZZ 3.0 build guide

The tools/build_windows_release.py CLI takes a verified frozen Windows Python base, the 20-asset model directory, the pinned NSIS/mingw toolchain, private build/output directories, CPython 3.11.9 embedded bootstrap ZIP, PyOpenGL 3.1.10 wheel and the Qt 6.8.3 multimedia overlay. It compiles the native launcher and NSIS wizard, appends the complete hash-verified ZIP64 payload and checks every member. No external runtime is required after installation.

The source release includes the builder, bootstrap, launcher, notices and corresponding sources. The smaller Replit ZIP excludes model weights, private Windows runtime, build toolchain and historical duplicate media. Native Windows acceptance must be performed separately; Linux archive verification is not loader execution.
