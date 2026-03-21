import path from 'node:path'

/**
 * Resolves the main window preload script path.
 * Preloads are built as CJS .cjs files (format: 'cjs', entryFileNames: '[name].cjs').
 * .cjs is recognised as CommonJS by Node regardless of package.json "type": "module".
 */
export function resolvePreloadPath(dir: string): string {
  return path.join(dir, 'preload.cjs')
}

/**
 * Resolves the capture-window preload script path.
 * Built to the same output directory as main.js (dist-electron/).
 */
export function resolveCapturePreloadPath(): string {
  const dir = import.meta.dirname ?? __dirname
  return path.join(dir, 'capture-preload.cjs')
}
