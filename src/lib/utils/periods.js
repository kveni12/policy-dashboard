/**
 * Census year spans and UI labels for dashboard ``timePeriod`` keys.
 *
 * Notes
 * -----
 * Tags double as JSON suffixes on tract fields (e.g. ``pop_change_pct_90_00``).
 */

/** @type {Record<string, { startY: string, endY: string, tag: string }>} */
export const PERIOD_CENSUS_BOUNDS = {
	'90_00': { startY: '1990', endY: '2000', tag: '90_00' },
	'00_10': { startY: '2000', endY: '2010', tag: '00_10' },
	'10_20': { startY: '2010', endY: '2020', tag: '10_20' },
	'90_20': { startY: '1990', endY: '2020', tag: '90_20' }
};

/**
 * Map a panel time-period key to decennial endpoints used in tract column names.
 *
 * Parameters
 * ----------
 * timePeriod : string
 *
 * Returns
 * -------
 * {{ startY: string, endY: string, tag: string }}
 */
export function periodCensusBounds(timePeriod) {
	return PERIOD_CENSUS_BOUNDS[timePeriod] ?? PERIOD_CENSUS_BOUNDS['10_20'];
}

/**
 * Human-readable range for UI copy (en dash between years).
 *
 * Parameters
 * ----------
 * timePeriod : string
 *
 * Returns
 * -------
 * string
 */
export function periodDisplayLabel(timePeriod) {
	const labels = {
		'90_00': '1990–2000',
		'00_10': '2000–2010',
		'10_20': '2010–2020',
		'90_20': '1990–2020'
	};
	return labels[timePeriod] ?? labels['10_20'];
}
