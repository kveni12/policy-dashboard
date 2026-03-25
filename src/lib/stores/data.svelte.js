import { base } from '$app/paths';

/**
 * Shared dashboard data loaded once at app startup from ``static/data`` (served under ``{base}/data/`` for GitHub Pages).
 *
 * Notes
 * -----
 * Svelte does not allow reassigning exported ``$state`` bindings; ``loadAllData`` mutates
 * these values in place (arrays via ``length`` / ``push``, objects via key updates).
 */

export const tractData = $state([]);
export const tractGeo = $state({ type: 'FeatureCollection', features: [] });
export const developments = $state([]);
export const mbtaStops = $state([]);
export const mbtaLines = $state({ type: 'FeatureCollection', features: [] });
export const meta = $state({ yVariables: [], xVariables: [], controlAverages: {} });

/**
 * Replace enumerable own properties on ``target`` with those from ``source``.
 */
function replaceObjectProps(target, source) {
	for (const k of Object.keys(target)) {
		delete target[k];
	}
	Object.assign(target, source);
}

/**
 * Fetch all dashboard JSON assets in parallel and assign module state.
 */
export async function loadAllData() {
	const p = (/** @type {string} */ path) => `${base}${path}`;
	const [tractDataRes, tractGeoRes, devsRes, mbtaStopsRes, mbtaLinesRes, metaRes] =
		await Promise.all([
			fetch(p('/data/tract_data.json')),
			fetch(p('/data/tracts.geojson')),
			fetch(p('/data/developments.json')),
			fetch(p('/data/mbta_stops.json')),
			fetch(p('/data/mbta_lines.geojson')),
			fetch(p('/data/meta.json')),
		]);

	const [tractDataJson, tractGeoJson, devsJson, mbtaStopsJson, mbtaLinesJson, metaJson] =
		await Promise.all([
			tractDataRes.json(),
			tractGeoRes.json(),
			devsRes.json(),
			mbtaStopsRes.json(),
			mbtaLinesRes.json(),
			metaRes.json()
		]);

	tractData.length = 0;
	tractData.push(...tractDataJson);
	replaceObjectProps(tractGeo, tractGeoJson);
	developments.length = 0;
	developments.push(...devsJson);
	mbtaStops.length = 0;
	mbtaStops.push(...mbtaStopsJson);
	replaceObjectProps(mbtaLines, mbtaLinesJson);
	replaceObjectProps(meta, metaJson);
}
