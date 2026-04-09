import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import puppeteer from "puppeteer";

function parseArgs(argv) {
  const args = {
    gpx: "",
    output: "out.mp4",
    duration: 40,
    fps: 30,
    format: "landscape",
    frontendUrl: "http://127.0.0.1:5173",
    apiUrl: "http://127.0.0.1:8000",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    i += 1;

    if (key === "gpx") args.gpx = value;
    if (key === "output") args.output = value;
    if (key === "duration") args.duration = Number(value);
    if (key === "fps") args.fps = Number(value);
    if (key === "format") args.format = value === "portrait" ? "portrait" : "landscape";
    if (key === "frontend-url") args.frontendUrl = value;
    if (key === "api-url") args.apiUrl = value;
  }

  return args;
}

async function parseGpxThroughBackend(apiUrl, gpxFilePath) {
  const fileBuffer = await fs.readFile(gpxFilePath);
  const fileName = path.basename(gpxFilePath);

  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), fileName);

  const response = await fetch(`${apiUrl}/api/gpx/parse`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GPX parse failed (${response.status}): ${text}`);
  }

  return response.json();
}

function ensureDir(dirPath) {
  return fs.mkdir(dirPath, { recursive: true });
}

function runFfmpeg(framesGlob, fps, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      framesGlob,
      "-c:v",
      "libx264",
      "-crf",
      "16",
      "-preset",
      "slow",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ];

    const child = spawn("ffmpeg", ffmpegArgs, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.gpx) {
    throw new Error("Missing --gpx <path-to-file.gpx>");
  }

  const absoluteGpx = path.resolve(args.gpx);
  const absoluteOutput = path.resolve(args.output);
  const workDir = path.resolve("render", "tmp-frames");

  await ensureDir(workDir);

  console.log("[1/5] Parsing GPX via backend ...");
  const parsed = await parseGpxThroughBackend(args.apiUrl, absoluteGpx);

  console.log("[2/5] Starting headless browser ...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const viewport =
    args.format === "portrait"
      ? { width: 1080, height: 1920, deviceScaleFactor: 1 }
      : { width: 1920, height: 1080, deviceScaleFactor: 1 };

  await page.setViewport(viewport);
  await page.goto(args.frontendUrl, { waitUntil: "networkidle2" });

  console.log("[3/5] Loading route and prewarming tiles ...");
  await page.evaluate(
    async ({ parsedData, format, duration }) => {
      if (!window.gpxOverlay) {
        throw new Error("window.gpxOverlay is not available");
      }

      window.gpxOverlay.applyFormat(format);
      const durationInput = document.getElementById("durationInput");
      if (durationInput) {
        durationInput.value = String(duration);
      }

      await window.gpxOverlay.loadParsedData(parsedData);
      await window.gpxOverlay.prewarmTiles();
    },
    { parsedData: parsed, format: args.format, duration: args.duration }
  );

  console.log("[4/5] Capturing frames ...");
  const totalSeconds = args.duration + Math.max(2, Math.round(args.duration * 0.18));
  const totalFrames = Math.ceil(totalSeconds * args.fps);

  await page.evaluate(() => {
    window.gpxOverlay.play();
  });

  const start = Date.now();
  for (let i = 0; i < totalFrames; i += 1) {
    const targetTime = start + Math.floor((i * 1000) / args.fps);
    const now = Date.now();
    const waitMs = targetTime - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const framePath = path.join(workDir, `frame-${String(i).padStart(6, "0")}.png`);
    await page.screenshot({ path: framePath, type: "png" });
  }

  await browser.close();

  console.log("[5/5] Encoding MP4 with ffmpeg ...");
  await runFfmpeg(path.join(workDir, "frame-%06d.png"), args.fps, absoluteOutput);

  console.log(`Done: ${absoluteOutput}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
