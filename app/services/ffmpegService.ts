import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import type { ScanRejectedFile } from "../shared/contracts";

const ffprobeStatic = require("ffprobe-static") as { path: string };

export interface FfmpegPaths {
  ffmpeg: string;
  ffprobe: string;
}

export interface VideoProbeResult {
  valid: boolean;
  status?: ScanRejectedFile["status"];
  reason?: string;
  durationSeconds?: number;
  width?: number | null;
  height?: number | null;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

function resolveBinary(
  candidates: Array<string | null | undefined>,
  fallbackCommand: string
): string {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const normalizedCandidate = normalizeExecutablePath(candidate);
    if (fs.existsSync(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return fallbackCommand;
}

export function resolveFfmpegPaths(): FfmpegPaths {
  const basePath =
    process.env.NODE_ENV === "development"
      ? path.resolve(process.cwd(), "resources/ffmpeg/win32-x64")
      : path.resolve(process.resourcesPath, "ffmpeg/win32-x64");

  return {
    ffmpeg: resolveBinary(
      [path.join(basePath, "ffmpeg.exe"), ffmpegStatic],
      "ffmpeg"
    ),
    ffprobe: resolveBinary(
      [path.join(basePath, "ffprobe.exe"), ffprobeStatic.path],
      "ffprobe"
    )
  };
}

export async function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPaths = resolveFfmpegPaths();
  await runProcess(ffmpegPaths.ffmpeg, args);
}

export async function probeVideoFile(filePath: string): Promise<VideoProbeResult> {
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

    const payload = JSON.parse(result.stdout) as {
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        duration?: string;
      }>;
      format?: {
        duration?: string;
      };
    };

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

    const durationSeconds = firstPositiveNumber(
      payload.format?.duration,
      ...videoStreams.map((stream) => stream.duration)
    );

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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown media probe error";
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes("enoent") ||
      lowerMessage.includes("not recognized") ||
      lowerMessage.includes("could not be found")
    ) {
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

async function runProcess(
  command: string,
  args: string[],
  options?: {
    inheritOutput?: boolean;
  }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const processHandle = spawn(command, args, {
      stdio: options?.inheritOutput ? "inherit" : "pipe",
      windowsHide: true
    });

    if (!options?.inheritOutput) {
      processHandle.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      processHandle.stderr?.on("data", (chunk: Buffer) => {
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
      reject(
        new Error(
          stderr
            ? `${command} exited with code ${code ?? "unknown"}: ${stderr}`
            : `${command} exited with code ${code ?? "unknown"}.`
        )
      );
    });
  });
}

function firstPositiveNumber(...values: Array<number | string | null | undefined>): number | null {
  for (const value of values) {
    const numericValue =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }
  }

  return null;
}

function normalizeExecutablePath(candidate: string): string {
  if (!candidate.includes("app.asar")) {
    return candidate;
  }

  const unpackedCandidate = candidate.replace("app.asar", "app.asar.unpacked");
  return fs.existsSync(unpackedCandidate) ? unpackedCandidate : candidate;
}
