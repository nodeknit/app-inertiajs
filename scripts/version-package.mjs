import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const packagePath = resolve(rootDir, 'dist', 'package.json');
const channel = process.env.PACKAGE_CHANNEL;
const registry = process.env.PACKAGE_REGISTRY ?? 'https://npm.pkg.github.com';
const shortSha = process.env.GITHUB_SHA?.slice(0, 7);

if (!channel) {
  throw new Error('PACKAGE_CHANNEL is required');
}

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const baseVersion = getBaseVersion(packageJson.version);
const distTags = getDistTags(packageJson.name);

packageJson.version = resolveVersion({ baseVersion, channel, distTags, shortSha });

writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`Resolved publish version: ${packageJson.version}`);

function getDistTags(packageName) {
  try {
    const output = execFileSync(
      'npm',
      ['view', packageName, 'dist-tags', '--json', '--registry', registry],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    ).trim();

    if (!output) {
      return {};
    }

    const parsed = JSON.parse(output);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    const details = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    if (/E404|404 Not Found/.test(details)) {
      return {};
    }

    throw new Error(
      `Failed to read dist-tags for ${packageName} from ${registry}.\n${details}`
    );
  }
}

function resolveVersion({ baseVersion, channel, distTags, shortSha }) {
  if (channel === 'commit') {
    if (!shortSha) {
      throw new Error('GITHUB_SHA is required for commit publishes');
    }

    return `${baseVersion}-commit.${shortSha}`;
  }

  if (channel === 'latest') {
    const currentLatest = distTags.latest;
    if (!currentLatest) {
      return baseVersion;
    }

    const nextPublishedVersion = semver.inc(getBaseVersion(currentLatest), 'patch');
    return semver.gte(baseVersion, nextPublishedVersion)
      ? baseVersion
      : nextPublishedVersion;
  }

  const currentChannelVersion = distTags[channel];
  if (!currentChannelVersion) {
    return `${baseVersion}-build.0`;
  }

  const currentBaseVersion = getBaseVersion(currentChannelVersion);
  const effectiveBaseVersion = semver.gte(baseVersion, currentBaseVersion)
    ? baseVersion
    : currentBaseVersion;
  const nextBuildNumber =
    effectiveBaseVersion === currentBaseVersion
      ? getBuildNumber(currentChannelVersion) + 1
      : 0;

  return `${effectiveBaseVersion}-build.${nextBuildNumber}`;
}

function getBaseVersion(version) {
  const parsed = semver.parse(version);
  if (!parsed) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function getBuildNumber(version) {
  const match = version.match(/-build\.(\d+)$/);
  return match ? Number(match[1]) : 0;
}
