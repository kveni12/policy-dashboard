import * as d3 from 'd3';

/**
 * Sequential quantile color scale from numeric ``values``.
 *
 * Parameters
 * ----------
 * values : Array<number>
 *     Sample used to infer the domain extent.
 * colorScheme : Iterable<string>
 *     D3 color range; default ``d3.schemeBlues[7]``.
 *
 * Returns
 * -------
 * d3.ScaleQuantize<string, number>
 */
export function getColorScale(values, colorScheme = d3.schemeBlues[7]) {
	const valid = values.filter((v) => Number.isFinite(v));
	let min;
	let max;
	if (valid.length === 0) {
		min = 0;
		max = 1;
	} else {
		[min, max] = d3.extent(valid);
	}
	if (min === max) {
		const pad = min === 0 ? 1e-6 : Math.abs(min) * 0.01;
		min -= pad;
		max += pad;
	}
	return d3.scaleQuantize().domain([min, max]).range(colorScheme);
}

/**
 * Diverging ``RdBu`` scale centered at zero.
 *
 * Parameters
 * ----------
 * values : Array<number>
 *     Used to set a symmetric domain ``[-M, 0, M]`` around zero.
 *
 * Returns
 * -------
 * d3.ScaleDiverging<string, number>
 */
export function getDivergingColorScale(values) {
	const valid = values.filter((v) => Number.isFinite(v));
	const maxAbs =
		valid.length === 0 ? 1 : Math.max(d3.max(valid, (v) => Math.abs(v)) ?? 0, 1e-9);
	return d3.scaleDiverging(d3.interpolateRdBu).domain([-maxAbs, 0, maxAbs]);
}

const compact = d3.format('~s');

/**
 * Compact numeric formatting (SI-style where appropriate).
 *
 * Parameters
 * ----------
 * n : number
 *
 * Returns
 * -------
 * string
 */
export function formatNumber(n) {
	if (!Number.isFinite(n)) return '—';
	return compact(n);
}

/**
 * Format a numeric percentage value for display.
 *
 * Parameters
 * ----------
 * n : number
 * kind : 'pp' | 'percent'
 *     ``'pp'`` → percentage points (e.g. ``1.2 pp``); ``'percent'`` → ``1.2%``.
 *
 * Returns
 * -------
 * string
 */
export function formatPct(n, kind = 'percent') {
	if (!Number.isFinite(n)) return '—';
	const t = d3.format('.1f')(n);
	return kind === 'pp' ? `${t} pp` : `${t}%`;
}
