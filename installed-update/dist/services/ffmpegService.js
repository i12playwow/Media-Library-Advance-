"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFfmpegPaths = resolveFfmpegPaths;
exports.runFfmpeg = runFfmpeg;
exports.probeVideoFile = probeVideoFile;
const node_fs_1 = __importDefault(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const ffprobeStatic = require("ffprobe-static");
function resolveBinary(candidates, fallbackCommand) {
 return require("./mediaBinary.cjs").resolveWorkingBinary(candidates, fallbackCommand);
}
function resolveFfmpegPaths() {
    const basePath = process.env.NODE_ENV === "development"
        ? node_path_1.default.resolve(process.cwd(), "resources/ffmpeg/win32-x64")
        : node_path_1.default.resolve(process.resourcesPath, "ffmpeg/win32-x64");
    return {
        ffmpeg: resolveBinary([node_path_1.default.join(basePath, "ffmpeg.exe"), ffmpeg_static_1.default], "ffmpeg"),
        ffprobe: resolveBinary([node_path_1.default.join(basePath, "ffprobe.exe"), ffprobeStatic.path], "ffprobe")
    };
}
async function runFfmpeg(args) {
    const ffmpegPaths = resolveFfmpegPaths();
    await runProcess(ffmpegPaths.ffmpeg, args);
}
async function probeVideoFile(filePath) {
    const ffmpegPaths = resolveFfmpegPaths();
    try {
        const result = await runProcess(ffmpegPaths.ffprobe, [
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            filePath
        ]);
        const payload = JSON.parse(result.stdout);
        const videoStreams = Array.isArray(payload.streams)
            ? payload.streams.filter((stream) => stream.codec_type === "video")
            : [];
        if (videoStreams.length === 0) {
            return {
                valid: false,
                status: "corrupt",
                reason: "No video stream was detected in this file."
            };
        }
        const durationSeconds = firstPositiveNumber(payload.format?.duration, ...videoStreams.map((stream) => stream.duration));
        if (!durationSeconds) {
            return {
                valid: false,
                status: "corrupt",
                reason: "The media probe could not read a valid duration from this file."
            };
        }
        const primaryStream = videoStreams[0];
        return {
            valid: true,
            durationSeconds,
            width: primaryStream.width ?? null,
            height: primaryStream.height ?? null
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown media probe error";
        const lowerMessage = message.toLowerCase();
        if (lowerMessage.includes("enoent") ||
            lowerMessage.includes("not recognized") ||
            lowerMessage.includes("could not be found")) {
            return {
                valid: false,
                status: "invalid",
                reason: "FFprobe is not available, so this video could not be validated safely."
            };
        }
        return {
            valid: false,
            status: "corrupt",
            reason: `Media probe failed: ${message}`
        };
    }
}
async function runProcess(command, args, options) {
    return new Promise((resolve, reject) => {
        const stdoutChunks = [];
        const stderrChunks = [];
        const processHandle = (0, node_child_process_1.spawn)(command, args, {
            stdio: options?.inheritOutput ? "inherit" : "pipe",
            windowsHide: true
        });
        if (!options?.inheritOutput) {
            processHandle.stdout?.on("data", (chunk) => {
                stdoutChunks.push(chunk);
            });
            processHandle.stderr?.on("data", (chunk) => {
                stderrChunks.push(chunk);
            });
        }
        processHandle.once("error", (error) => reject(error));
        processHandle.once("exit", (code) => {
            if (code === 0) {
                resolve({
                    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
                    stderr: Buffer.concat(stderrChunks).toString("utf8")
                });
                return;
            }
            const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
            reject(new Error(stderr
                ? `${command} exited with code ${code ?? "unknown"}: ${stderr}`
                : `${command} exited with code ${code ?? "unknown"}.`));
        });
    });
}
function firstPositiveNumber(...values) {
    for (const value of values) {
        const numericValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
        if (Number.isFinite(numericValue) && numericValue > 0) {
            return numericValue;
        }
    }
    return null;
}
function normalizeExecutablePath(candidate) {
    if (!candidate.includes("app.asar")) {
        return candidate;
    }
    const unpackedCandidate = candidate.replace("app.asar", "app.asar.unpacked");
    return node_fs_1.default.existsSync(unpackedCandidate) ? unpackedCandidate : candidate;
}
