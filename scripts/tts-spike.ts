/**
 * TTS segment-caching spike (issue #22). Not part of the app; run by hand.
 *
 * Answers two questions:
 *
 *  1. How much TTS would caching save? Replays recent alerts oldest-first
 *     through a simulated clip cache and counts the characters that would still
 *     be synthesized under three strategies:
 *       - whole:     one clip per alert, reused only on an identical alert
 *       - sentences: one clip per template sentence (nature, address, city, ...),
 *                    so the repeated address and common natures/cities are reused
 *       - split:     sentences, with the house / block number cut into its own
 *                    clip so the street name is reusable too
 *     This part makes no OpenAI calls (characters stand in for audio length).
 *
 *  2. Does stitched audio sound acceptable? Synthesizes a small sample of
 *     alerts all three ways and writes an index.html with the players side
 *     by side.
 *
 * Usage (from the repo root, after `npm ci`):
 *
 *   # stats only: free, needs Cloudflare credentials for wrangler
 *   npx vite-node scripts/tts-spike.ts -- --dry-run
 *
 *   # stats + listening test (needs OPENAI_API_KEY)
 *   OPENAI_API_KEY=sk-... npx vite-node scripts/tts-spike.ts -- --org boone --limit 12
 *
 * Options:
 *   --org <key>          only this organization's alerts (default: all orgs)
 *   --limit <n>          alerts to synthesize for the listening test (default 12)
 *   --stats-limit <n>    alerts to replay for the savings estimate (default 2000)
 *   --format mp3|wav     mp3 (default) joins the MP3 bytes as production would;
 *                        wav requests raw PCM and inserts --gap-ms of silence
 *   --gap-ms <n>         silence between clips in wav mode (default 150)
 *   --local              read the local D1 (wrangler --local) instead of remote
 *   --input <file.json>  read alerts from a JSON array of
 *                        { nature, address, city, org_key?, tts_template? }
 *                        instead of D1
 *   --out <dir>          output directory (default tts-spike-out, gitignored)
 *   --dry-run            stats only; no OpenAI calls
 *
 * Environment:
 *   OPENAI_API_KEY       required unless --dry-run
 *   OPENAI_BASE_URL      optional, e.g. the AI Gateway's OpenAI URL
 *   AI_GATEWAY_TOKEN     optional, sent as cf-aig-authorization when set
 *
 * Synthesized clips are cached under <out>/cache by a hash of
 * (model, voice, instructions, format, text), so re-runs don't pay again. The
 * output contains real dispatch addresses: keep it local.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';

import type { PreAlert } from '../server/parse';
import { DEFAULT_ADDRESS_TEMPLATE, renderAlertSentences } from '../server/template';
import { tokenizeAddress } from '../server/address';
import { spellNumber } from '../server/numbers';
import { TTS_MODEL, TTS_VOICE } from '../server/generator';
import { TTS_INSTRUCTIONS } from '../server/prompts';
import { DEFAULT_TTS_TEMPLATE } from '../shared/ttsTemplate';

// --- options ---------------------------------------------------------------

const { values: opts } = parseArgs({
	args: process.argv.slice(2).filter((arg) => arg !== '--'),
	options: {
		org: { type: 'string' },
		limit: { type: 'string', default: '12' },
		'stats-limit': { type: 'string', default: '2000' },
		format: { type: 'string', default: 'mp3' },
		'gap-ms': { type: 'string', default: '150' },
		local: { type: 'boolean', default: false },
		input: { type: 'string' },
		out: { type: 'string', default: 'tts-spike-out' },
		'dry-run': { type: 'boolean', default: false },
	},
});

const format = opts.format === 'wav' ? 'wav' : opts.format === 'mp3' ? 'mp3' : fail(`--format must be mp3 or wav`);
const listenLimit = positiveInt(opts.limit, '--limit');
const statsLimit = positiveInt(opts['stats-limit'], '--stats-limit');
const gapMs = positiveInt(opts['gap-ms'], '--gap-ms', true);
const outDir = opts.out;
const dryRun = opts['dry-run'];

function fail(message: string): never {
	console.error(`tts-spike: ${message}`);
	process.exit(1);
}

function positiveInt(value: string | undefined, name: string, allowZero = false): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < (allowZero ? 0 : 1)) fail(`${name} must be a whole number`);
	return n;
}

// --- loading alerts ----------------------------------------------------------

interface AlertRow {
	alert_id: string;
	timestamp: number;
	nature: string;
	address: string;
	city: string;
	org_key: string;
	tts_template: string | null;
}

/** Most recent first. */
function loadAlerts(limit: number): AlertRow[] {
	if (opts.input) {
		const rows = JSON.parse(readFileSync(opts.input, 'utf8')) as Partial<AlertRow>[];
		return rows
			.map((row, i) => ({
				alert_id: row.alert_id ?? `input-${i}`,
				timestamp: row.timestamp ?? rows.length - i,
				nature: row.nature ?? '',
				address: row.address ?? '',
				city: row.city ?? '',
				org_key: row.org_key ?? 'input',
				tts_template: row.tts_template ?? null,
			}))
			.filter((row) => !opts.org || row.org_key === opts.org)
			.slice(0, limit);
	}

	if (opts.org && !/^[\w-]+$/.test(opts.org)) fail('--org must be a plain org key');
	const where = opts.org ? `WHERE o.org_key = '${opts.org}'` : '';
	const sql =
		'SELECT a.alert_id, a.timestamp, a.nature, a.address, a.city, o.org_key, o.tts_template ' +
		'FROM alerts a JOIN organizations o ON o.org_id = a.organization ' +
		`${where} ORDER BY a.timestamp DESC LIMIT ${limit}`;
	const stdout = execFileSync(
		'npx',
		['wrangler', 'd1', 'execute', 'cad-alerts', opts.local ? '--local' : '--remote', '--json', '--command', sql],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 },
	);
	const parsed = JSON.parse(stdout) as { results: AlertRow[] }[];
	return parsed[0]?.results ?? [];
}

// --- segmenting ----------------------------------------------------------------

type Strategy = 'whole' | 'sentences' | 'split';
const STRATEGIES: Strategy[] = ['whole', 'sentences', 'split'];
const STRATEGY_LABELS: Record<Strategy, string> = {
	whole: 'Whole alert (today)',
	sentences: 'Stitched sentences',
	split: 'Sentences + split number',
};

function capitalizeFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The spoken number that leads the address clause, if it can be cut off on its own. */
function leadingNumber(preAlert: PreAlert): string | null {
	const tokens = tokenizeAddress(preAlert.address);
	if (tokens.kind === 'street' && tokens.houseNumber) {
		return spellNumber(tokens.houseNumber, DEFAULT_ADDRESS_TEMPLATE.streetNumberStyle);
	}
	if (tokens.kind === 'hundredBlock') {
		return `${spellNumber(tokens.block, DEFAULT_ADDRESS_TEMPLATE.streetNumberStyle)} block of`;
	}
	return null;
}

/**
 * The clip texts each strategy would synthesize for one alert, in play order.
 * Clips that end a sentence keep its period so the voice closes the phrase.
 */
function clipsFor(row: AlertRow): Record<Strategy, string[]> {
	const preAlert: PreAlert = {
		nature: row.nature,
		address: row.address,
		city: row.city,
		latitude: 0,
		longitude: 0,
	};
	const template = row.tts_template || DEFAULT_TTS_TEMPLATE;
	const sentences = renderAlertSentences(preAlert, template);
	const whole = sentences.length > 0 ? `${sentences.join('. ')}.` : '';

	// The address clause as the template renders it alone, to find its sentences.
	const address = renderAlertSentences(preAlert, '{address}.')[0]?.toLowerCase();
	const number = leadingNumber(preAlert)?.toLowerCase();
	const split = sentences.flatMap((sentence) => {
		const lower = sentence.toLowerCase();
		if (!number || lower !== address || !lower.startsWith(`${number} `)) return [`${sentence}.`];
		return [capitalizeFirst(number), `${capitalizeFirst(sentence.slice(number.length + 1))}.`];
	});

	return {
		whole: whole ? [whole] : [],
		sentences: sentences.map((s) => `${s}.`),
		split,
	};
}

// --- savings estimate ----------------------------------------------------------

interface StrategyStats {
	synthesizedChars: number;
	clips: number;
	cacheMisses: number;
}

interface Stats {
	alerts: number;
	baselineChars: number;
	byStrategy: Record<Strategy, StrategyStats>;
}

/** Replay alerts oldest-first through an unbounded clip cache per strategy (and per org). */
function simulate(rows: AlertRow[]): Stats {
	const stats: Stats = {
		alerts: rows.length,
		baselineChars: 0,
		byStrategy: {
			whole: { synthesizedChars: 0, clips: 0, cacheMisses: 0 },
			sentences: { synthesizedChars: 0, clips: 0, cacheMisses: 0 },
			split: { synthesizedChars: 0, clips: 0, cacheMisses: 0 },
		},
	};
	const seen = new Set<string>();
	for (const row of [...rows].sort((a, b) => a.timestamp - b.timestamp)) {
		const clips = clipsFor(row);
		stats.baselineChars += clips.whole[0]?.length ?? 0;
		for (const strategy of STRATEGIES) {
			const s = stats.byStrategy[strategy];
			for (const clip of clips[strategy]) {
				s.clips++;
				// Production would key by content only; the org is irrelevant to
				// the audio, so the cache is shared across orgs here too.
				const key = `${strategy}\u0000${clip}`;
				if (seen.has(key)) continue;
				seen.add(key);
				s.cacheMisses++;
				s.synthesizedChars += clip.length;
			}
		}
	}
	return stats;
}

function pct(part: number, whole: number): string {
	return whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(1)}%`;
}

function printStats(stats: Stats): void {
	console.log(`\nSavings estimate over ${stats.alerts} alerts (oldest first, shared cache):`);
	console.log(`  baseline (no cache): ${stats.baselineChars} chars synthesized\n`);
	console.log('  strategy                   chars synth.   saved    distinct clips   clips/alert');
	for (const strategy of STRATEGIES) {
		const s = stats.byStrategy[strategy];
		console.log(
			`  ${STRATEGY_LABELS[strategy].padEnd(26)} ${String(s.synthesizedChars).padStart(12)}   ${pct(
				stats.baselineChars - s.synthesizedChars,
				stats.baselineChars,
			).padStart(6)}   ${String(s.cacheMisses).padStart(14)}   ${(s.clips / Math.max(stats.alerts, 1)).toFixed(1).padStart(11)}`,
		);
	}
	console.log(
		'\n  Characters stand in for audio length. Savings rise as the cache warms, so a\n' +
			'  longer history (--stats-limit) estimates the steady state better.',
	);
}

// --- synthesis -----------------------------------------------------------------

const SAMPLE_RATE = 24_000; // OpenAI `pcm` output: 24 kHz, 16-bit signed LE, mono.

function clipKey(text: string): string {
	return createHash('sha256')
		.update(JSON.stringify([TTS_MODEL, TTS_VOICE, TTS_INSTRUCTIONS, format, text]))
		.digest('hex');
}

function createSynthesizer(cacheDir: string) {
	const openai = new OpenAI({
		apiKey: process.env.OPENAI_API_KEY,
		baseURL: process.env.OPENAI_BASE_URL || undefined,
		defaultHeaders: process.env.AI_GATEWAY_TOKEN
			? { 'cf-aig-authorization': `Bearer ${process.env.AI_GATEWAY_TOKEN}` }
			: undefined,
	});
	const inFlight = new Map<string, Promise<Uint8Array>>();
	let active = 0;
	const waiting: (() => void)[] = [];
	const MAX_CONCURRENT = 4;
	let paidCalls = 0;
	let paidChars = 0;

	async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
		if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
		active++;
		try {
			return await fn();
		} finally {
			active--;
			waiting.shift()?.();
		}
	}

	function synthesize(text: string): Promise<Uint8Array> {
		const key = clipKey(text);
		const existing = inFlight.get(key);
		if (existing) return existing;
		const path = join(cacheDir, `${key}.${format === 'wav' ? 'pcm' : 'mp3'}`);
		const promise = (async () => {
			if (existsSync(path)) return new Uint8Array(readFileSync(path));
			const response = await withSlot(() =>
				openai.audio.speech.create({
					model: TTS_MODEL,
					voice: TTS_VOICE,
					instructions: TTS_INSTRUCTIONS,
					input: text,
					response_format: format === 'wav' ? 'pcm' : 'mp3',
				}),
			);
			const bytes = new Uint8Array(await response.arrayBuffer());
			paidCalls++;
			paidChars += text.length;
			writeFileSync(path, bytes);
			return bytes;
		})();
		inFlight.set(key, promise);
		return promise;
	}

	return { synthesize, usage: () => ({ paidCalls, paidChars }) };
}

/** Drop a leading ID3v2 tag and a trailing ID3v1 tag so MP3 frames can be appended. */
function stripId3(mp3: Uint8Array): Uint8Array {
	let start = 0;
	let end = mp3.length;
	if (mp3.length >= 10 && mp3[0] === 0x49 && mp3[1] === 0x44 && mp3[2] === 0x33) {
		const size = ((mp3[6] & 0x7f) << 21) | ((mp3[7] & 0x7f) << 14) | ((mp3[8] & 0x7f) << 7) | (mp3[9] & 0x7f);
		const footer = mp3[5] & 0x10 ? 10 : 0;
		start = 10 + size + footer;
	}
	if (end - start >= 128 && mp3[end - 128] === 0x54 && mp3[end - 127] === 0x41 && mp3[end - 126] === 0x47) {
		end -= 128;
	}
	return mp3.subarray(start, end);
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** Short linear fades at both ends of a PCM clip so joins don't click. */
function fadeEdges(pcm: Uint8Array, fadeMs = 5): Uint8Array {
	const samples = new Int16Array(pcm.slice().buffer, 0, Math.floor(pcm.length / 2));
	const n = Math.min(Math.floor((SAMPLE_RATE * fadeMs) / 1000), Math.floor(samples.length / 2));
	for (let i = 0; i < n; i++) {
		const gain = i / n;
		samples[i] = Math.round(samples[i] * gain);
		samples[samples.length - 1 - i] = Math.round(samples[samples.length - 1 - i] * gain);
	}
	return new Uint8Array(samples.buffer);
}

function wav(pcm: Uint8Array): Uint8Array {
	const header = new DataView(new ArrayBuffer(44));
	const writeAscii = (offset: number, text: string) =>
		[...text].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
	writeAscii(0, 'RIFF');
	header.setUint32(4, 36 + pcm.length, true);
	writeAscii(8, 'WAVE');
	writeAscii(12, 'fmt ');
	header.setUint32(16, 16, true);
	header.setUint16(20, 1, true); // PCM
	header.setUint16(22, 1, true); // mono
	header.setUint32(24, SAMPLE_RATE, true);
	header.setUint32(28, SAMPLE_RATE * 2, true);
	header.setUint16(32, 2, true);
	header.setUint16(34, 16, true);
	writeAscii(36, 'data');
	header.setUint32(40, pcm.length, true);
	return concat([new Uint8Array(header.buffer), pcm]);
}

function stitch(clips: Uint8Array[]): Uint8Array {
	if (format === 'mp3') return concat(clips.map(stripId3));
	const gap = new Uint8Array(Math.round((SAMPLE_RATE * gapMs) / 1000) * 2);
	const parts: Uint8Array[] = [];
	clips.forEach((clip, i) => {
		if (i > 0) parts.push(gap);
		parts.push(clips.length > 1 ? fadeEdges(clip) : clip);
	});
	return wav(concat(parts));
}

// --- report --------------------------------------------------------------------

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface Sample {
	row: AlertRow;
	clips: Record<Strategy, string[]>;
	files: Record<Strategy, string>;
}

function renderReport(stats: Stats, samples: Sample[]): string {
	const statRows = STRATEGIES.map((strategy) => {
		const s = stats.byStrategy[strategy];
		return `<tr><td>${STRATEGY_LABELS[strategy]}</td><td>${s.synthesizedChars}</td><td>${pct(
			stats.baselineChars - s.synthesizedChars,
			stats.baselineChars,
		)}</td><td>${s.cacheMisses}</td></tr>`;
	}).join('');
	const cards = samples
		.map(({ row, clips, files }) => {
			const variants = STRATEGIES.map(
				(strategy) => `
				<div class="variant">
					<div class="label">${STRATEGY_LABELS[strategy]}</div>
					<audio controls preload="none" src="${escapeHtml(files[strategy])}"></audio>
					<div class="clips">${clips[strategy].map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div>
				</div>`,
			).join('');
			return `
			<section>
				<h2>${escapeHtml(row.nature)} · ${escapeHtml(row.address)} · ${escapeHtml(row.city)}</h2>
				<div class="meta">${escapeHtml(row.org_key)} · ${new Date(row.timestamp).toLocaleString()}</div>
				${variants}
			</section>`;
		})
		.join('');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TTS stitching spike</title>
<style>
	:root { --bg: #fff; --fg: #1a1a1a; --muted: #666; --line: #ddd; --chip: #f0f0f0; }
	@media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #eee; --muted: #999; --line: #333; --chip: #262626; } }
	body { background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; margin: 0 auto; max-width: 960px; padding: 16px; }
	table { border-collapse: collapse; margin-bottom: 8px; }
	td, th { border-bottom: 1px solid var(--line); padding: 4px 12px 4px 0; text-align: left; }
	section { border-top: 1px solid var(--line); padding: 12px 0; }
	h2 { font-size: 16px; margin: 0; }
	.meta, .note { color: var(--muted); font-size: 13px; }
	.variant { display: grid; grid-template-columns: 200px 1fr; gap: 4px 12px; align-items: center; margin-top: 8px; }
	.variant audio { width: 100%; }
	.clips { grid-column: 2; display: flex; flex-wrap: wrap; gap: 4px; }
	.clips span { background: var(--chip); border-radius: 4px; font-size: 12px; padding: 1px 6px; }
	@media (max-width: 600px) { .variant { grid-template-columns: 1fr; } .clips { grid-column: 1; } }
</style>
</head>
<body>
<h1>TTS stitching spike</h1>
<p class="note">Format: ${format}${format === 'wav' ? `, ${gapMs} ms gaps` : ' (frames appended as-is)'}. Each clip is synthesized once and reused, as a cache would.</p>
<h3>Savings estimate (${stats.alerts} alerts)</h3>
<table><tr><th>Strategy</th><th>Chars synthesized</th><th>Saved</th><th>Distinct clips</th></tr>
<tr><td>No cache</td><td>${stats.baselineChars}</td><td>—</td><td>—</td></tr>${statRows}</table>
<p class="note">Characters stand in for audio length.</p>
<h3>Listening test (${samples.length} alerts)</h3>
${cards}
</body>
</html>
`;
}

// --- main ----------------------------------------------------------------------

async function main(): Promise<void> {
	if (!dryRun && !process.env.OPENAI_API_KEY) {
		fail('OPENAI_API_KEY is not set (use --dry-run for stats only)');
	}

	const rows = loadAlerts(Math.max(statsLimit, listenLimit));
	if (rows.length === 0) fail('no alerts found');

	const stats = simulate(rows.slice(0, statsLimit));
	printStats(stats);

	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, 'stats.json'), JSON.stringify(stats, null, 2));
	if (dryRun) return;

	const cacheDir = join(outDir, 'cache');
	const audioDir = join(outDir, 'audio');
	mkdirSync(cacheDir, { recursive: true });
	mkdirSync(audioDir, { recursive: true });
	const synth = createSynthesizer(cacheDir);

	const sampleRows = rows.slice(0, listenLimit);
	console.log(`\nSynthesizing ${sampleRows.length} alerts three ways...`);
	const samples: Sample[] = await Promise.all(
		sampleRows.map(async (row, index) => {
			const clips = clipsFor(row);
			const files = {} as Record<Strategy, string>;
			for (const strategy of STRATEGIES) {
				const audio = await Promise.all(clips[strategy].map((clip) => synth.synthesize(clip)));
				const name = `${String(index + 1).padStart(2, '0')}-${strategy}.${format}`;
				writeFileSync(join(audioDir, name), stitch(audio));
				files[strategy] = `audio/${name}`;
			}
			return { row, clips, files };
		}),
	);

	writeFileSync(join(outDir, 'index.html'), renderReport(stats, samples));
	const usage = synth.usage();
	console.log(`\nPaid TTS calls this run: ${usage.paidCalls} (${usage.paidChars} chars); the rest came from ${cacheDir}.`);
	console.log(`Open ${join(outDir, 'index.html')} to listen.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
