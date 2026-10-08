/**
 * Shared media-tool paths for extraction and the offline codec smoke test.
 *
 * Desktop can point these at bundled binaries; development and server workflows
 * use the names on PATH.
 */
export const FFMPEG_BIN = process.env.FFMPEG_PATH ?? "ffmpeg";
export const FFPROBE_BIN = process.env.FFPROBE_PATH ?? "ffprobe";
