import { app, nativeImage, type NativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";

let cachedNativeImage: NativeImage | undefined;
let cachedDataUrl: string | undefined;

const CANDIDATE_PATHS = [
  path.join(process.cwd(), "build/icon.ico"),
  path.join(__dirname, "../../build/icon.ico"),
  path.join(app.getAppPath(), "build/icon.ico"),
  path.join(process.resourcesPath, "build/icon.ico"),
  path.join(process.cwd(), "build/icon.png"),
  path.join(__dirname, "../../build/icon.png"),
  path.join(__dirname, "../renderer/icon.png"),
  path.join(__dirname, "../renderer/favicon.ico"),
];

export function getAppIconPath(): string | undefined {
  const allCandidates = [
    ...CANDIDATE_PATHS,
    path.join(app.getAppPath(), "dist/renderer/icon.png"),
    path.join(process.resourcesPath, "build/icon.png")
  ];

  for (const candidate of allCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function getAppIcon(): NativeImage {
  if (cachedNativeImage && !cachedNativeImage.isEmpty()) {
    return cachedNativeImage;
  }

  const iconPath = getAppIconPath();
  if (iconPath) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      cachedNativeImage = img;
      return img;
    }
  }

  return nativeImage.createEmpty();
}

export function getAppIconDataUrl(): string {
  if (cachedDataUrl) {
    return cachedDataUrl;
  }

  const pngCandidatePaths = [
    path.join(__dirname, "../../build/icon.png"),
    path.join(__dirname, "../renderer/icon.png"),
    path.join(process.cwd(), "build/icon.png"),
    path.join(app.getAppPath(), "build/icon.png"),
    path.join(app.getAppPath(), "dist/renderer/icon.png"),
    path.join(process.resourcesPath, "build/icon.png")
  ];

  for (const candidate of pngCandidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        const buf = fs.readFileSync(candidate);
        cachedDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
        return cachedDataUrl;
      } catch {
        // Continue searching
      }
    }
  }

  const icon = getAppIcon();
  if (!icon.isEmpty()) {
    const url = icon.toDataURL();
    if (url) {
      cachedDataUrl = url;
      return cachedDataUrl;
    }
  }

  return "";
}
