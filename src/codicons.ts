import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { CodiconName } from './types.js';

const require = createRequire(import.meta.url);
const codiconsRoot = dirname(require.resolve('@vscode/codicons/package.json'));
const cache = new Map<CodiconName, { viewBox: string; content: string }>();

export function codiconSvg(name: CodiconName, x: number, y: number, size: number, color: string): string {
	let icon = cache.get(name);
	if (!icon) {
		const source = readFileSync(join(codiconsRoot, 'src', 'icons', `${name}.svg`), 'utf8');
		const viewBox = source.match(/\bviewBox="([^"]+)"/)?.[1];
		const content = source.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1];
		if (!viewBox || !content) {
			throw new Error(`Invalid Codicon SVG: ${name}`);
		}
		icon = { viewBox, content };
		cache.set(name, icon);
	}
	return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${icon.viewBox}" fill="${color}">${icon.content.replaceAll('currentColor', color)}</svg>`;
}
