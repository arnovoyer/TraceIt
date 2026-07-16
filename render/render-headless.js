import fs from "node:fs/promises";
import fsSync from "node:fs";
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
    showAltitude: true,
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
    if (key === "show-altitude") args.showAltitude = value !== "0";
    if (key === "frontend-url") args.frontendUrl = value;
    if (key === "api-url") args.apiUrl = value;
  }

  return args;
}

function parseGpxDirectly(gpxContent) {
  // Simple GPX parser for track points
  const points = [];
  const trkptRegex = /<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>/g;
  let match;

  while ((match = trkptRegex.exec(gpxContent)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    
    // Try to find elevation too
    const endOfTrkpt = gpxContent.indexOf("</trkpt>", match.index);
    const eleMatch = gpxContent.slice(match.index, endOfTrkpt).match(/<ele>([^<]+)<\/ele>/);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : 0;
    
    if (!isNaN(lat) && !isNaN(lon)) {
      points.push({ lat, lon, ele });
    }
  }
  
  // If no track points, try route points
  if (points.length === 0) {
    const rteptRegex = /<rtept[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>/g;
    while ((match = rteptRegex.exec(gpxContent)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      
      const endOfRtept = gpxContent.indexOf("</rtept>", match.index);
      const eleMatch = gpxContent.slice(match.index, endOfRtept).match(/<ele>([^<]+)<\/ele>/);
      const ele = eleMatch ? parseFloat(eleMatch[1]) : 0;
      
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lon, ele });
      }
    }
  }
  
  if (points.length < 2) {
    throw new Error("GPX file contains no valid track or route points");
  }
  
  // Return in same format as backend
  return {
    points: points,
    pointCount: points.length,
    start: points[0],
    end: points[points.length - 1]
  };
}

async function parseGpxThroughBackend(apiUrl, gpxFilePath) {
  const fileBuffer = await fs.readFile(gpxFilePath);
  const gpxContent = fileBuffer.toString("utf8");
  return parseGpxDirectly(gpxContent);
}

function ensureDir(dirPath) {
  return fs.mkdir(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  if (fsSync.existsSync(dirPath)) {
    const files = fsSync.readdirSync(dirPath);
    for (const file of files) {
      fsSync.unlinkSync(path.join(dirPath, file));
    }
  }
}

function runFfmpeg(framesGlob, fps, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpegCmd = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
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

    const child = spawn(ffmpegCmd, ffmpegArgs, { stdio: "inherit" });
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
  // Use tmp-frames inside the render directory, no matter where we call from
  const renderScriptDir = path.dirname(process.argv[1]);
  const normalizedWorkDir = path.resolve(renderScriptDir, "tmp-frames");

  console.log("Using work directory:", normalizedWorkDir);
  await ensureDir(normalizedWorkDir);
  cleanDir(normalizedWorkDir); // Delete old frames before starting

  console.log("[1/5] Parsing GPX via backend ...");
  const parsed = await parseGpxThroughBackend(args.apiUrl, absoluteGpx);

  console.log("[2/5] Starting headless browser ...");
  // Try to launch browser with common fallback paths
  let browser;
  try {
    // First try Puppeteer's own Chrome
    browser = await puppeteer.launch({ headless: true });
  } catch (err) {
    console.log("Puppeteer Chrome not found, trying to find system Chrome...");
    // Try system Chrome paths on different OS
    let executablePath = null;
    if (process.platform === "win32") {
      executablePath = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      ].find(p => fsSync.existsSync(p));
    } else if (process.platform === "darwin") {
      executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      if (!fsSync.existsSync(executablePath)) executablePath = null;
    } else {
      executablePath = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]
        .find(p => {
          try {
            fsSync.accessSync(p, fsSync.constants.X_OK);
            return true;
          } catch { return false; }
        });
    }
    
    if (!executablePath) {
      throw new Error(
        "Could not find Chrome! Please install Chrome or run: npx puppeteer browsers install chrome"
      );
    }
    
    browser = await puppeteer.launch({ headless: true, executablePath });
  }
  
  const page = await browser.newPage();

  const viewport =
    args.format === "portrait"
      ? { width: 1080, height: 1920, deviceScaleFactor: 1 }
      : { width: 1920, height: 1080, deviceScaleFactor: 1 };

  await page.setViewport(viewport);
  await page.goto(args.frontendUrl, { waitUntil: "networkidle2" });

  console.log("[3/5] Loading route and prewarming tiles ...");
  await page.evaluate(
    async ({ parsedData, format, duration, showAltitude }) => {
      if (!window.gpxOverlay) {
        throw new Error("window.gpxOverlay is not available");
      }

      window.gpxOverlay.applyFormat(format);
      if (window.gpxOverlay.setAltitudeOverlayVisible) {
        window.gpxOverlay.setAltitudeOverlayVisible(showAltitude, false);
      }
      const durationInput = document.getElementById("durationInput");
      if (durationInput) {
        durationInput.value = String(duration);
      }

      await window.gpxOverlay.loadParsedData(parsedData);
      await window.gpxOverlay.prewarmTiles();
      window.gpxOverlay.enterRenderMode(); // Hide UI!
    },
    {
      parsedData: parsed,
      format: args.format,
      duration: args.duration,
      showAltitude: args.showAltitude,
    }
  );

  console.log("[4/5] Capturing frames ...");
  const routeSeconds = args.duration;
  const outroSeconds = Math.max(2, Math.round(args.duration * 0.18));
  const holdSeconds = 0;
  const routeFrames = Math.max(1, Math.ceil(routeSeconds * args.fps));
  const outroFrames = Math.max(1, Math.ceil(outroSeconds * args.fps));
  const holdFrames = Math.max(0, Math.ceil(holdSeconds * args.fps));
  const totalFrames = routeFrames + outroFrames + holdFrames;

  console.log(`Total frames to capture: ${totalFrames}`);

  // Capture frames by controlling animation progress directly
  // This eliminates PC performance dependency and ensures all frames are loaded
  for (let i = 0; i < routeFrames; i += 1) {
    const progress = routeFrames <= 1 ? 1 : i / (routeFrames - 1);

    try {
      await page.evaluate((prog) => {
        if (!window.gpxOverlay || !window.gpxOverlay.setProgress) {
          throw new Error("setProgress not available on gpxOverlay");
        }
        window.gpxOverlay.setProgress(prog);
      }, progress);
    } catch (err) {
      console.warn(`Warning setting progress for route frame ${i}:`, err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const framePath = path.join(normalizedWorkDir, `frame-${String(i).padStart(6, "0")}.png`);
    await page.screenshot({ path: framePath, type: "png" });

    if (i % 10 === 0 || i === totalFrames - 1) {
      console.log(`  Captured frame ${i + 1}/${totalFrames}`);
    }
  }

  console.log("  Capturing route outro ...");
  for (let i = 0; i < outroFrames; i += 1) {
    const outroProgress = outroFrames <= 1 ? 1 : i / (outroFrames - 1);

    try {
      await page.evaluate((prog) => {
        if (!window.gpxOverlay || !window.gpxOverlay.setOutroProgress) {
          throw new Error("setOutroProgress not available on gpxOverlay");
        }
        window.gpxOverlay.setOutroProgress(prog);
      }, outroProgress);
    } catch (err) {
      console.warn(`Warning setting outro progress for frame ${i}:`, err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const frameIndex = routeFrames + i;
    const framePath = path.join(normalizedWorkDir, `frame-${String(frameIndex).padStart(6, "0")}.png`);
    await page.screenshot({ path: framePath, type: "png" });

    if (frameIndex % 10 === 0 || frameIndex === totalFrames - 1) {
      console.log(`  Captured frame ${frameIndex + 1}/${totalFrames}`);
    }
  }

  for (let i = 0; i < holdFrames; i += 1) {
    try {
      await page.evaluate(() => {
        if (!window.gpxOverlay || !window.gpxOverlay.setOutroProgress) {
          throw new Error("setOutroProgress not available on gpxOverlay");
        }
        window.gpxOverlay.setOutroProgress(1);
      });
    } catch (err) {
      console.warn(`Warning holding outro frame ${i}:`, err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const frameIndex = routeFrames + outroFrames + i;
    const framePath = path.join(normalizedWorkDir, `frame-${String(frameIndex).padStart(6, "0")}.png`);
    await page.screenshot({ path: framePath, type: "png" });

    if (frameIndex % 10 === 0 || frameIndex === totalFrames - 1) {
      console.log(`  Captured frame ${frameIndex + 1}/${totalFrames}`);
    }
  }

  await browser.close();

  console.log("[5/5] Encoding MP4 with ffmpeg ...");
  await runFfmpeg(path.join(normalizedWorkDir, "frame-%06d.png"), args.fps, absoluteOutput);

  console.log(`Done: ${absoluteOutput}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
