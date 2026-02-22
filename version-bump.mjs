import { readFileSync, writeFileSync } from "node:fs";

const VERSION_PARTS_REGEX = /^\d+\.\d+\.\d+$/;
const VERSION_ARG_REGEX = /^(major|minor|patch|\d+\.\d+\.\d+)$/;

function parseVersion(version) {
  if (!VERSION_PARTS_REGEX.test(version)) {
    throw new Error(`Invalid version \"${version}\". Expected x.y.z`);
  }

  const [major, minor, patch] = version.split(".").map(Number);
  return { major, minor, patch };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function compareVersions(a, b) {
  const aParts = parseVersion(a);
  const bParts = parseVersion(b);

  if (aParts.major !== bParts.major) {
    return aParts.major - bParts.major;
  }
  if (aParts.minor !== bParts.minor) {
    return aParts.minor - bParts.minor;
  }
  return aParts.patch - bParts.patch;
}

function resolveNextVersion(currentVersion, arg) {
  const current = parseVersion(currentVersion);

  if (arg === "major") {
    return formatVersion({ major: current.major + 1, minor: 0, patch: 0 });
  }
  if (arg === "minor") {
    return formatVersion({
      major: current.major,
      minor: current.minor + 1,
      patch: 0,
    });
  }
  if (arg === "patch") {
    return formatVersion({
      major: current.major,
      minor: current.minor,
      patch: current.patch + 1,
    });
  }

  parseVersion(arg);
  return arg;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value, indent = 2) {
  writeFileSync(filePath, `${JSON.stringify(value, null, indent)}\n`);
}

const arg = process.argv[2];
if (arg === undefined || !VERSION_ARG_REGEX.test(arg)) {
  console.error("Usage: node version-bump.mjs <major|minor|patch|x.y.z>");
  process.exit(1);
}

const packageJson = readJson("package.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");

if (typeof packageJson.version !== "string") {
  throw new Error("package.json is missing a valid string version");
}
if (typeof manifest.minAppVersion !== "string") {
  throw new Error("manifest.json is missing a valid string minAppVersion");
}

const nextVersion = resolveNextVersion(packageJson.version, arg);
const previousVersion = packageJson.version;

packageJson.version = nextVersion;
manifest.version = nextVersion;
versions[nextVersion] = manifest.minAppVersion;

const sortedVersions = Object.fromEntries(
  Object.entries(versions).sort(([a], [b]) => compareVersions(a, b)),
);

writeJson("package.json", packageJson, 2);
writeJson("manifest.json", manifest, "\t");
writeJson("versions.json", sortedVersions, "\t");

console.log(`Bumped version ${previousVersion} -> ${nextVersion}`);
