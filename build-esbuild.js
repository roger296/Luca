#!/usr/bin/env node
'use strict';

/**
 * Production build script using esbuild.
 * Transpiles all TypeScript source files under src/ (excluding src/web/)
 * to CommonJS JavaScript in dist/ — no type checking, very low memory usage.
 * Type safety is verified separately by `npm run typecheck` / the test suite.
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

function findTsFiles(dir, files) {
  if (!files) files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip web frontend (built by Vite) and node_modules
      if (entry.name !== 'web' && entry.name !== 'node_modules') {
        findTsFiles(fullPath, files);
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const entryPoints = findTsFiles(path.join(__dirname, 'src'));

console.log('[build] Transpiling ' + entryPoints.length + ' TypeScript files with esbuild...');

const start = Date.now();
esbuild.buildSync({
  entryPoints: entryPoints,
  outdir: path.join(__dirname, 'dist'),
  outbase: __dirname,        // Preserve directory structure (src/foo.ts -> dist/src/foo.js)
  bundle: false,             // No bundling — keep module structure for require() resolution
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,          // No source maps in production
  minify: false,             // Keep readable for debugging
  logLevel: 'warning',
});

console.log('[build] Done in ' + (Date.now() - start) + 'ms. Output: dist/');
