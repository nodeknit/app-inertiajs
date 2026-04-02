import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const distDir = resolve(rootDir, 'dist');
const packagePath = resolve(rootDir, 'package.json');
const distPackagePath = resolve(distDir, 'package.json');

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

const distPackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  type: packageJson.type,
  main: 'index.js',
  types: 'index.d.ts',
  typings: 'index.d.ts',
  exports: {
    '.': {
      types: './index.d.ts',
      import: './index.js'
    }
  },
  keywords: packageJson.keywords,
  author: packageJson.author,
  license: packageJson.license,
  repository: packageJson.repository,
  dependencies: packageJson.dependencies,
  peerDependencies: packageJson.peerDependencies,
  peerDependenciesMeta: packageJson.peerDependenciesMeta,
  publishConfig: {
    registry: 'https://npm.pkg.github.com'
  }
};

writeFileSync(
  distPackagePath,
  `${JSON.stringify(removeUndefined(distPackageJson), null, 2)}\n`
);

for (const filename of ['README.md', 'LICENSE', 'LICENSE.md']) {
  const sourcePath = resolve(rootDir, filename);
  if (existsSync(sourcePath)) {
    copyFileSync(sourcePath, resolve(distDir, filename));
  }
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, removeUndefined(entryValue)])
    );
  }

  return value;
}
