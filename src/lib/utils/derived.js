import * as d3 from 'd3';
import { periodCensusBounds } from './periods.js';

const MODE_TO_FLAG = {
	rail: 'has_rail',
	commuter_rail: 'has_commuter_rail',
	bus: 'has_bus'
};

/** Display strings for MBTA mode keys (internal keys stay ``rail`` / ``commuter_rail`` / ``bus``). */
const TRANSIT_MODE_UI_LABEL = {
	rail: 'Rapid transit',
	commuter_rail: 'Commuter rail',
	bus: 'Bus'
};

/**
 * Human-readable label for a transit mode key (map overlays, cohort chips, tooltips).
 *
 * Parameters
 * ----------
 * modeKey : string
 *
 * Returns
 * -------
 * string
 */
export function transitModeUiLabel(modeKey) {
	if (modeKey == null || modeKey === '') return '';
	const k = String(modeKey);
	return TRANSIT_MODE_UI_LABEL[k] ?? k.replace(/_/g, ' ');
}

/**
 * Whether a tract has at least one selected transit mode per ``transitModes`` toggles.
 *
 * Parameters
 * ----------
 * tract : object
 * transitModes : Record<string, boolean>
 *
 * Returns
 * -------
 * boolean
 */
export function tractMatchesTransitModes(tract, transitModes) {
	const tm = transitModes ?? {};
	const activeModes = Object.entries(tm).filter(([, on]) => on);
	const inactiveModes = Object.entries(tm).filter(([, on]) => !on);
	if (inactiveModes.length > 0 && activeModes.length > 0) {
		const hasAnyActiveMode = activeModes.some(([key]) => Boolean(tract[MODE_TO_FLAG[key]]));
		const hasAnyMode = Object.keys(MODE_TO_FLAG).some((key) => Boolean(tract[MODE_TO_FLAG[key]]));
		if (hasAnyMode && !hasAnyActiveMode) return false;
	} else if (activeModes.length === 0) {
		return false;
	}
	return true;
}

/**
 * Census tract passes overall universe filters (population, density, HU change,
 * minimum stops/mi²). Does not apply TOD vs. non-TOD cohort rules.
 *
 * Parameters
 * ----------
 * tract : object
 * panelState : object
 *
 * Returns
 * -------
 * boolean
 */
export function passesTractUniverse(tract, panelState) {
	const tp = panelState.timePeriod;
	const { startY, endY } = periodCensusBounds(tp);
	const gj = tract.gisjoin;
	if (!gj || typeof gj !== 'string' || !gj.startsWith('G')) return false;

	const stopsPerSqMi = Number(tract.stops_per_sq_mi) || 0;
	if (stopsPerSqMi < (panelState.minStopsPerSqMi || 0)) return false;

	const pop = Number(tract[`pop_${startY}`]) || 0;
	if (pop < (panelState.minPopulation || 0)) return false;

	const area = Number(tract.area_sq_mi) || 0;
	if ((panelState.minPopDensity || 0) > 0 && area > 0) {
		if (pop / area < panelState.minPopDensity) return false;
	}

	if ((panelState.minHuChange || 0) > 0) {
		const huStart = Number(tract[`total_hu_${startY}`]) || 0;
		const huEnd = Number(tract[`total_hu_${endY}`]) || 0;
		if (huEnd - huStart < panelState.minHuChange) return false;
	}

	return true;
}

/**
 * MassBuilds affordable share for a tract and period: ``new_affordable / new_units``.
 *
 * Parameters
 * ----------
 * tract : object
 * timePeriod : string
 *     Panel period tag (e.g. ``'10_20'``).
 *
 * Returns
 * -------
 * number | null
 *     Share in ``[0, 1]``, or ``null`` when there is no new-unit activity
 *     (``new_units`` is 0 or missing).
 */
export function tractMassbuildsAffordableShare(tract, timePeriod) {
	const nu = Number(tract[`new_units_${timePeriod}`]) || 0;
	if (nu <= 0) return null;
	const naRaw = Number(tract[`new_affordable_${timePeriod}`]) || 0;
	// Baked tract columns can reflect raw MassBuilds; cap so share stays in [0, 1].
	const na = Math.min(naRaw, nu);
	return na / nu;
}

/**
 * Whether a tract meets the cohort minimum affordable-development ratio (percent
 * of MassBuilds new units that are affordable). When the minimum is 0, passes.
 * Tracts with no new units fail if the minimum is positive.
 *
 * Parameters
 * ----------
 * tract : object
 * panelState : object
 * cohort : 'tod' | 'nonTod'
 *
 * Returns
 * -------
 * boolean
 */
export function passesCohortMinAffordableShare(tract, panelState, cohort) {
	const pctRaw =
		cohort === 'tod'
			? panelState.todMinAffordableSharePct
			: panelState.nonTodMinAffordableSharePct;
	const pct = Math.min(100, Math.max(0, Number(pctRaw) || 0));
	if (pct <= 0) return true;
	const share = tractMassbuildsAffordableShare(tract, panelState.timePeriod);
	if (share == null) return false;
	return share >= pct / 100;
}

/**
 * Housing stock increase (percent) from tract-level MassBuilds totals: new units
 * in ``timePeriod`` divided by decennial census ``total_hu`` at the period start
 * year. Aligns with scatter X ``pct_stock_increase`` when all projects are included
 * (tract JSON aggregates are not filtered by development controls).
 *
 * Parameters
 * ----------
 * tract : object
 * timePeriod : string
 *     Panel period tag (e.g. ``'10_20'``).
 *
 * Returns
 * -------
 * number | null
 *     Percent in ``[0, 100+]``, or ``null`` when base housing stock is missing or zero.
 */
export function tractHousingStockIncreasePct(tract, timePeriod) {
	const { startY } = periodCensusBounds(timePeriod);
	const nu = Number(tract[`new_units_${timePeriod}`]) || 0;
	const baseStock = Number(tract[`total_hu_${startY}`]) || 0;
	if (baseStock <= 0) return null;
	return +((100 * nu) / baseStock).toFixed(4);
}

/**
 * Cohort floor on housing stock increase (%). When the minimum is 0, passes.
 * Tracts with no valid base stock fail if the minimum is positive.
 *
 * Parameters
 * ----------
 * tract : object
 * panelState : object
 * cohort : 'tod' | 'nonTod'
 *
 * Returns
 * -------
 * boolean
 */
export function passesCohortMinHousingStockIncreasePct(tract, panelState, cohort) {
	const pctRaw =
		cohort === 'tod'
			? panelState.todMinStockIncreasePct
			: panelState.nonTodMinStockIncreasePct;
	const minPct = Math.max(0, Number(pctRaw) || 0);
	if (minPct <= 0) return true;
	const v = tractHousingStockIncreasePct(tract, panelState.timePeriod);
	if (v == null) return false;
	return v >= minPct;
}

/**
 * Tract qualifies for the user-defined non-TOD (control) cohort: optional max
 * stops/mi² ceiling plus non-TOD transit mode toggles.
 *
 * When ``nonTodMaxStopsPerSqMi > 0``, a tract must satisfy **stops/mi² ≤ max**
 * (equal counts as control). When max is 0, no upper bound is applied.
 *
 * Parameters
 * ----------
 * tract : object
 * panelState : object
 *
 * Returns
 * -------
 * boolean
 */
export function isNonTodCohortTract(tract, panelState) {
	const stopsPerSqMi = Number(tract.stops_per_sq_mi) || 0;
	const maxStops = panelState.nonTodMaxStopsPerSqMi ?? 0;
	if (maxStops > 0 && stopsPerSqMi > maxStops) return false;
	const modes = panelState.nonTodTransitModes ?? panelState.transitModes;
	if (!tractMatchesTransitModes(tract, modes)) return false;
	if (!passesCohortMinAffordableShare(tract, panelState, 'nonTod')) return false;
	return passesCohortMinHousingStockIncreasePct(tract, panelState, 'nonTod');
}

/**
 * Tract qualifies for the TOD (analysis) cohort: ``isTodTract`` plus TOD mode toggles.
 *
 * Parameters
 * ----------
 * tract : object
 * panelState : object
 *
 * Returns
 * -------
 * boolean
 */
export function isTodCohortTract(tract, panelState) {
	if (!isTodTract(tract, panelState.todMinStopsPerSqMi ?? 0)) return false;
	const modes = panelState.todTransitModes ?? panelState.transitModes;
	if (!tractMatchesTransitModes(tract, modes)) return false;
	if (!passesCohortMinAffordableShare(tract, panelState, 'tod')) return false;
	return passesCohortMinHousingStockIncreasePct(tract, panelState, 'tod');
}

/**
 * Stage 1: census tracts in the analysis universe that match either the TOD or
 * the non-TOD cohort definition (union). Map choropleth and dev aggregation use
 * this set.
 *
 * Parameters
 * ----------
 * tracts : Array<object>
 * panelState : object
 *
 * Returns
 * -------
 * Array<object>
 */
export function filterTractsByTract(tracts, panelState) {
	return tracts.filter(
		(t) =>
			passesTractUniverse(t, panelState) &&
			(isTodCohortTract(t, panelState) || isNonTodCohortTract(t, panelState))
	);
}

/**
 * Test whether a tract qualifies as TOD under a given stops/mi² threshold.
 *
 * When ``todMinStopsPerSqMi > 0``, the tract must satisfy **stops/mi² ≥ min**
 * (equal counts as TOD). When min is 0, any tract with at least one MBTA stop
 * in the buffer qualifies (``transit_stops > 0``).
 *
 * Parameters
 * ----------
 * tract : object
 * todMinStopsPerSqMi : number
 *     When > 0, the tract must meet or exceed this density.
 *     When 0, any tract with at least one transit stop qualifies.
 *
 * Returns
 * -------
 * boolean
 */
export function isTodTract(tract, todMinStopsPerSqMi = 0) {
	const density = Number(tract.stops_per_sq_mi) || 0;
	if (todMinStopsPerSqMi > 0) return density >= todMinStopsPerSqMi;
	return (Number(tract.transit_stops) || 0) > 0;
}

/**
 * Stops per mi² for display: **0** when there are no stops in/near the tract,
 * otherwise the stored density when finite (null if stops exist but density is missing).
 *
 * Parameters
 * ----------
 * tract : object | null | undefined
 *
 * Returns
 * -------
 * number | null
 */
export function tractStopsDensityForDisplay(tract) {
	const n = Number(tract?.transit_stops);
	const stops = Number.isFinite(n) ? n : 0;
	if (stops <= 0) return 0;
	const d = Number(tract?.stops_per_sq_mi);
	return Number.isFinite(d) ? d : null;
}

/**
 * Tracts in the TOD (analysis) cohort: universe filters, TOD stop rule, and TOD
 * transit-mode toggles.
 *
 * Parameters
 * ----------
 * tracts : Array<object>
 * panelState : object
 *
 * Returns
 * -------
 * Array<object>
 */
export function getTodTracts(tracts, panelState) {
	return tracts.filter((t) => passesTractUniverse(t, panelState) && isTodCohortTract(t, panelState));
}

/**
 * Non-TOD control group: universe filters, non-TOD max stops/mi² and mode
 * toggles, and excludes tracts that also qualify as TOD (disjoint control).
 *
 * Parameters
 * ----------
 * tracts : Array<object>
 * panelState : object
 *
 * Returns
 * -------
 * Array<object>
 */
export function getNonTodTracts(tracts, panelState) {
	return tracts.filter(
		(t) =>
			passesTractUniverse(t, panelState) &&
			isNonTodCohortTract(t, panelState) &&
			!isTodCohortTract(t, panelState)
	);
}

/**
 * Compute the (optionally population-weighted) mean of a Y variable.
 *
 * Parameters
 * ----------
 * tracts : Array<object>
 * yKey : string
 * weightKey : string | null
 *     Field on each tract to use as weight (e.g. ``pop_2010``). When null,
 *     falls back to an unweighted arithmetic mean.
 *
 * Returns
 * -------
 * number
 */
export function computeGroupMean(tracts, yKey, weightKey = null) {
	const pairs = tracts
		.filter((t) => t[yKey] != null)
		.map((t) => ({ y: Number(t[yKey]), w: weightKey ? (Number(t[weightKey]) || 0) : 1 }))
		.filter((p) => Number.isFinite(p.y) && p.w > 0);
	if (pairs.length === 0) return NaN;
	if (!weightKey) return d3.mean(pairs, (p) => p.y);
	const sumW = d3.sum(pairs, (p) => p.w);
	return sumW > 0 ? d3.sum(pairs, (p) => p.w * p.y) / sumW : NaN;
}

/**
 * Determine the population weight key for a time period.
 *
 * Parameters
 * ----------
 * timePeriod : string
 *
 * Returns
 * -------
 * string
 */
export function popWeightKey(timePeriod) {
	const { startY } = periodCensusBounds(timePeriod);
	return `pop_${startY}`;
}

/**
 * Infer how to format numeric summaries from a Y-variable metadata label.
 *
 * Parameters
 * ----------
 * yVariableMeta : {{ label?: string } | null | undefined}
 *
 * Returns
 * -------
 * 'pp' | 'pct' | 'min'
 */
export function yMetricDisplayKind(yVariableMeta) {
	const label = yVariableMeta?.label ?? '';
	if (/\(pp\)/i.test(label)) return 'pp';
	if (/\(min\)/i.test(label)) return 'min';
	return 'pct';
}

/**
 * Format a single summary value for the cohort-average callout (matches Y-axis semantics).
 *
 * Parameters
 * ----------
 * value : number
 * kind : 'pp' | 'pct' | 'min'
 *
 * Returns
 * -------
 * string
 */
export function formatYMetricSummary(value, kind) {
	if (!Number.isFinite(value)) return '\u2014';
	const fmt = d3.format('.2f');
	if (kind === 'pp') return `${fmt(value)} pp`;
	if (kind === 'min') return `${fmt(value)} min`;
	return `${fmt(value)}%`;
}

/**
 * Population-weighted means of the active Y variable for TOD vs non-TOD cohorts.
 *
 * Parameters
 * ----------
 * tracts : Array<object>
 * panelState : {{ timePeriod: string, yVar: string }}
 *
 * Returns
 * -------
 * {{ yKey: string, yLabel: string, weightKey: string, weightLabel: string,
 *     kind: 'pp'|'pct'|'min', meanTod: number, meanNonTod: number,
 *     nTod: number, nNonTod: number, nTodWithY: number, nNonTodWithY: number } | null}
 */
export function cohortYMeansForPanel(tracts, panelState) {
	if (!tracts?.length || !panelState?.timePeriod || !panelState?.yVar) return null;
	const tp = panelState.timePeriod;
	const yBase = panelState.yVar;
	const yKey = `${yBase}_${tp}`;
	const weightKey = popWeightKey(tp);
	const tod = getTodTracts(tracts, panelState);
	const nonTod = getNonTodTracts(tracts, panelState);
	const meanTod = computeGroupMean(tod, yKey, weightKey);
	const meanNonTod = computeGroupMean(nonTod, yKey, weightKey);
	const nTodWithY = tod.filter((t) => t[yKey] != null && Number.isFinite(Number(t[yKey]))).length;
	const nNonTodWithY = nonTod.filter((t) => t[yKey] != null && Number.isFinite(Number(t[yKey]))).length;
	const { startY } = periodCensusBounds(tp);
	return {
		yKey,
		yBase,
		weightKey,
		weightLabel: `population in ${startY} (start of selected period)`,
		meanTod,
		meanNonTod,
		nTod: tod.length,
		nNonTod: nonTod.length,
		nTodWithY,
		nNonTodWithY
	};
}

/**
 * Population-weighted mean of the active Y for a user-chosen tract subset (same weights as
 * ``cohortYMeansForPanel`` / binned bar chart).
 *
 * Parameters
 * ----------
 * tracts : Array<object>
 * panelState : {{ timePeriod: string, yVar: string }}
 * selectedGisjoins : Set<string> | Iterable<string>
 *
 * Returns
 * -------
 * {{ mean: number, nSelected: number, nWithY: number, yKey: string, weightKey: string } | null}
 *     ``mean`` is NaN when no tracts are selected or none have finite Y; ``nSelected`` counts
 *     tracts in the subset (regardless of Y missingness).
 */
export function selectedTractsYWeightedMean(tracts, panelState, selectedGisjoins) {
	if (!tracts?.length || !panelState?.timePeriod || !panelState?.yVar) return null;
	const tp = panelState.timePeriod;
	const yBase = panelState.yVar;
	const yKey = `${yBase}_${tp}`;
	const weightKey = popWeightKey(tp);
	const set =
		selectedGisjoins instanceof Set ? selectedGisjoins : new Set(selectedGisjoins ?? []);
	if (set.size === 0) {
		return { mean: NaN, nSelected: 0, nWithY: 0, yKey, weightKey };
	}
	const selected = tracts.filter((t) => t.gisjoin && set.has(t.gisjoin));
	const mean = computeGroupMean(selected, yKey, weightKey);
	const nWithY = selected.filter(
		(t) => t[yKey] != null && Number.isFinite(Number(t[yKey]))
	).length;
	return { mean, nSelected: selected.length, nWithY, yKey, weightKey };
}

/**
 * Multifamily share of a MassBuilds project: (small + large multifamily units) / total units.
 *
 * Parameters
 * ----------
 * d : {{ hu?: number, smmultifam?: number, lgmultifam?: number }}
 *
 * Returns
 * -------
 * number | null
 *     Share in ``[0, 1]``, or ``null`` when ``hu`` is not positive.
 */
export function developmentMultifamilyShare(d) {
	const hu = Number(d.hu) || 0;
	if (hu <= 0) return null;
	const mf = (Number(d.smmultifam) || 0) + (Number(d.lgmultifam) || 0);
	return mf / hu;
}

/**
 * Affordable unit count for aggregation: cap ``affrd_unit`` at project ``hu``.
 *
 * MassBuilds sometimes lists more affordable units than total ``hu`` (field
 * mismatch in the source). Summing uncapped values can make tract-level
 * affordable units exceed new-unit totals; we cap per project so shares stay
 * in ``[0, 1]``.
 *
 * Parameters
 * ----------
 * d : {{ hu?: number, affrd_unit?: number }}
 *
 * Returns
 * -------
 * number
 *     Non-negative; at most ``hu`` when ``hu`` is positive.
 */
export function developmentAffordableUnitsCapped(d) {
	const hu = Number(d.hu) || 0;
	const aff = Number(d.affrd_unit) || 0;
	if (hu <= 0) return 0;
	return Math.min(aff, hu);
}

/**
 * Affordable share of a MassBuilds project: affordable units / total units.
 *
 * Parameters
 * ----------
 * d : {{ hu?: number, affrd_unit?: number }}
 *
 * Returns
 * -------
 * number | null
 *     Share in ``[0, 1]``, or ``null`` when ``hu`` is not positive.
 */
export function developmentAffordableShare(d) {
	const hu = Number(d.hu) || 0;
	if (hu <= 0) return null;
	return developmentAffordableUnitsCapped(d) / hu;
}

/**
 * Stage 2: filter individual developments by development-level criteria.
 *
 * Parameters
 * ----------
 * developments : Array<object>
 * panelState : object
 *
 * Returns
 * -------
 * Array<object>
 */
export function filterDevelopments(developments, panelState) {
	const tp = panelState.timePeriod;
	const minMfPct = Math.min(100, Math.max(0, Number(panelState.minDevMultifamilyRatioPct) || 0));
	const minAffPct = Math.min(100, Math.max(0, Number(panelState.minDevAffordableRatioPct) || 0));

	return developments.filter((d) => {
		if (!developmentMatchesPeriod(d, tp)) return false;
		if (d.hu < panelState.minUnitsPerProject) return false;

		if (minMfPct > 0) {
			const mfShare = developmentMultifamilyShare(d);
			if (mfShare == null || mfShare < minMfPct / 100) return false;
		}
		if (minAffPct > 0) {
			const affShare = developmentAffordableShare(d);
			if (affShare == null || affShare < minAffPct / 100) return false;
		}

		if (!panelState.includeRedevelopment && d.rdv) return false;

		return true;
	});
}

/**
 * Match a MassBuilds record to a dashboard period.
 *
 * The long window ``90_20`` uses ``completion_year`` (1990–2020 inclusive) so it
 * is not limited to decade bucket overlap with ``10_20`` (which includes 2021+).
 *
 * Parameters
 * ----------
 * d : {{ decade: string, completion_year?: number | null }}
 * tp : string
 *
 * Returns
 * -------
 * boolean
 */
export function developmentMatchesPeriod(d, tp) {
	if (d.decade === tp) return true;
	if (tp === '90_20') {
		const y = d.completion_year;
		return y != null && y >= 1990 && y <= 2020;
	}
	return false;
}

/**
 * Aggregate **filtered** developments by tract, producing X-axis values. The
 * caller passes only projects that passed ``filterDevelopments`` (min units,
 * multifamily/affordable ratio floors, redevelopment), so MassBuilds-derived
 * scatter/map X metrics reflect those choices. Census-based X fields on the tract
 * row are unaffected.
 *
 * Parameters
 * ----------
 * filteredDevs : Array<object>
 * tractMap : Map<string, object>
 *     gisjoin -> tract record (needed for ``total_hu_<year>`` base stock).
 * timePeriod : string
 *
 * Returns
 * -------
 * Map<string, object>
 *     gisjoin -> { new_units, new_singfam, new_sm_multifam, new_lg_multifam,
 *                  new_affordable, pct_stock_increase, multifam_share, affordable_share }.
 *     ``new_affordable`` sums ``min(affrd_unit, hu)`` per project (see
 *     ``developmentAffordableUnitsCapped``).
 */
export function aggregateDevsByTract(filteredDevs, tractMap, timePeriod) {
	const { startY: baseYear } = periodCensusBounds(timePeriod);
	const result = new Map();

	for (const d of filteredDevs) {
		const gj = d.gisjoin;
		if (!result.has(gj)) {
			result.set(gj, {
				new_units: 0,
				new_singfam: 0,
				new_sm_multifam: 0,
				new_lg_multifam: 0,
				new_affordable: 0
			});
		}
		const agg = result.get(gj);
		agg.new_units += d.hu;
		agg.new_singfam += d.singfamhu;
		agg.new_sm_multifam += d.smmultifam;
		agg.new_lg_multifam += d.lgmultifam;
		agg.new_affordable += developmentAffordableUnitsCapped(d);
	}

	for (const [gj, agg] of result) {
		const tract = tractMap.get(gj);
		const baseStock = Number(tract?.[`total_hu_${baseYear}`]) || 0;
		agg.pct_stock_increase =
			baseStock > 0 ? +((agg.new_units / baseStock) * 100).toFixed(2) : null;
		agg.multifam_share =
			agg.new_units > 0
				? +((agg.new_sm_multifam + agg.new_lg_multifam) / agg.new_units).toFixed(3)
				: null;
		agg.affordable_share =
			agg.new_units > 0 ? +(agg.new_affordable / agg.new_units).toFixed(3) : null;
		const multifamUnits = agg.new_sm_multifam + agg.new_lg_multifam;
		agg.affordable_stock_pct =
			baseStock > 0 ? +((agg.new_affordable / baseStock) * 100).toFixed(2) : null;
		agg.multifam_stock_pct =
			baseStock > 0 ? +((multifamUnits / baseStock) * 100).toFixed(2) : null;
	}

	return result;
}

/**
 * Tract filters plus per-tract MassBuilds aggregates for the current period.
 *
 * ``devAgg`` uses only developments passing ``filterDevelopments`` (and lying
 * in filtered tracts), so **MassBuilds X-axis metrics** respond to those filters.
 * Census X metrics are read from tract rows and ignore development filters.
 *
 * Parameters
 * ----------
 * tracts : Array<object>
 * developments : Array<object>
 * panelState : object
 *
 * Returns
 * -------
 * { filteredTracts: Array<object>, devAgg: Map<string, object>, filteredDevs: Array<object> }
 */
export function buildFilteredData(tracts, developments, panelState) {
	const tractFiltered = filterTractsByTract(tracts, panelState);
	const tractSet = new Set(tractFiltered.map((t) => t.gisjoin));

	const tractMap = new Map();
	for (const t of tracts) {
		if (t.gisjoin) tractMap.set(t.gisjoin, t);
	}

	const devFiltered = filterDevelopments(developments, panelState).filter((d) =>
		tractSet.has(d.gisjoin)
	);

	const devAgg = aggregateDevsByTract(devFiltered, tractMap, panelState.timePeriod);

	return { filteredTracts: tractFiltered, devAgg, filteredDevs: devFiltered };
}

/**
 * Resolve the X-axis value for a tract from the dev aggregation map.
 *
 * Parameters
 * ----------
 * gisjoin : string
 * xBase : string
 * devAgg : Map
 *
 * Returns
 * -------
 * number | null
 */
export function getXValue(gisjoin, xBase, devAgg) {
	const agg = devAgg.get(gisjoin);
	if (!agg) return null;
	return agg[xBase] ?? null;
}

/**
 * Scatter / bar X value: census fields on the tract row or MassBuilds aggregates in ``devAgg``.
 *
 * Parameters
 * ----------
 * tract : object | null | undefined
 * gisjoin : string
 * xBase : string
 *     Key from ``meta.xVariables``.
 * devAgg : Map<string, object>
 * timePeriod : string
 *     Panel period tag (e.g. ``'10_20'``).
 *
 * Returns
 * -------
 * number | null
 */
export function getScatterXValue(tract, gisjoin, xBase, devAgg, timePeriod) {
	if (xBase === 'census_hu_change') {
		if (!tract) return null;
		const v = Number(tract[`census_hu_change_${timePeriod}`]);
		return Number.isFinite(v) ? v : null;
	}
	return getXValue(gisjoin, xBase, devAgg);
}

/**
 * Drop points outside ``±k`` marginal standard deviations on X and on Y (means
 * and SDs from the full set). Intended to limit OLS leverage from extreme coordinates.
 *
 * If the filter would leave fewer than two points, returns the original array.
 *
 * Parameters
 * ----------
 * points : Array<{ x: number, y: number }>
 * k : number, optional
 *     Half-width in SD units; default ``10`` matches scatter axis trimming.
 *
 * Returns
 * -------
 * Array<{ x: number, y: number }>
 */
export function filterPointsTenSigmaMarginals(points, k = 10) {
	if (!points?.length || points.length <= 2) return points;
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const xMu = d3.mean(xs);
	const yMu = d3.mean(ys);
	const xVar = d3.variance(xs);
	const yVar = d3.variance(ys);
	const xSd = xVar != null && xVar > 0 ? Math.sqrt(xVar) : 0;
	const ySd = yVar != null && yVar > 0 ? Math.sqrt(yVar) : 0;
	const xOk = (v) => xSd <= 0 || (v >= xMu - k * xSd && v <= xMu + k * xSd);
	const yOk = (v) => ySd <= 0 || (v >= yMu - k * ySd && v <= yMu + k * ySd);
	const out = points.filter((p) => xOk(p.x) && yOk(p.y));
	if (out.length < 2) return points;
	return out;
}

/**
 * Ordinary least-squares line and coefficient of determination.
 *
 * Parameters
 * ----------
 * points : Array<{ x: number, y: number }>
 *
 * Returns
 * -------
 * { slope: number, intercept: number, r2: number }
 */
export function computeRegression(points) {
	const n = points.length;
	if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const xMean = d3.mean(xs);
	const yMean = d3.mean(ys);

	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) {
		const dx = xs[i] - xMean;
		num += dx * (ys[i] - yMean);
		den += dx * dx;
	}
	const slope = den === 0 ? 0 : num / den;
	const intercept = yMean - slope * xMean;

	const ssTot = d3.sum(ys, (y) => (y - yMean) ** 2);
	const ssRes = d3.sum(points, (p) => {
		const pred = slope * p.x + intercept;
		return (p.y - pred) ** 2;
	});
	const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

	return { slope, intercept, r2 };
}

/**
 * Weighted least-squares line ``y ≈ slope * x + intercept`` and weighted R².
 * Matches tract-level weights used in cohort means and binned bars (e.g. population
 * at period start).
 *
 * Parameters
 * ----------
 * points : Array<{ x: number, y: number, w?: number }>
 *     Non-finite or non-positive ``w`` defaults to ``1``.
 *
 * Returns
 * -------
 * { slope: number, intercept: number, r2: number }
 */
export function computeWeightedRegression(points) {
	const n = points.length;
	if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

	const ws = points.map((p) => {
		const w = Number(p.w);
		return Number.isFinite(w) && w > 0 ? w : 1;
	});
	const sumW = d3.sum(ws);
	if (!(sumW > 0)) return { slope: 0, intercept: 0, r2: 0 };

	const xwMean = d3.sum(points, (p, i) => ws[i] * p.x) / sumW;
	const ywMean = d3.sum(points, (p, i) => ws[i] * p.y) / sumW;

	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) {
		const dx = points[i].x - xwMean;
		num += ws[i] * dx * (points[i].y - ywMean);
		den += ws[i] * dx * dx;
	}
	const slope = den === 0 ? 0 : num / den;
	const intercept = ywMean - slope * xwMean;

	let ssTot = 0;
	let ssRes = 0;
	for (let i = 0; i < n; i++) {
		const pred = slope * points[i].x + intercept;
		ssTot += ws[i] * (points[i].y - ywMean) ** 2;
		ssRes += ws[i] * (points[i].y - pred) ** 2;
	}
	const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

	return { slope, intercept, r2 };
}

/**
 * Quantile bins on X with population-weighted Y moments per bin.
 *
 * Each row may carry a ``w`` weight (e.g. population). When weights are present,
 * bin means and standard errors are population-weighted so that larger tracts
 * contribute proportionally more to the bar height.
 *
 * Parameters
 * ----------
 * rows : Array<{ x: number, y: number, w?: number, tract: object }>
 * nBins : number
 *
 * Returns
 * -------
 * Array<{ binLabel: string, xMid: number, xMin: number, xMax: number, yMean: number,
 *          ySE: number, count: number, totalPop: number }>
 */
export function computeBins(rows, nBins = 5) {
	const valid = rows.filter(
		(r) => Number.isFinite(r.x) && Number.isFinite(r.y) && (r.w == null || r.w > 0)
	);
	const n = valid.length;
	if (n === 0) return [];

	const sorted = [...valid].sort((a, b) => a.x - b.x);
	const binCount = Math.min(Math.max(1, nBins), n);
	const size = Math.ceil(n / binCount);
	const useWeights = valid.some((r) => r.w != null && r.w > 0);
	const out = [];

	for (let b = 0; b < binCount; b++) {
		const slice = sorted.slice(b * size, (b + 1) * size);
		if (slice.length === 0) continue;

		const xs = slice.map((r) => r.x);
		const ys = slice.map((r) => r.y);

		let yMean, ySE, totalPop;

		if (useWeights) {
			const ws = slice.map((r) => r.w || 1);
			const sumW = d3.sum(ws);
			totalPop = sumW;
			yMean = d3.sum(slice, (r, i) => ws[i] * ys[i]) / sumW;

			// Weighted variance: sum(w*(y-wm)^2) / sum(w)
			const wVar = d3.sum(slice, (r, i) => ws[i] * (ys[i] - yMean) ** 2) / sumW;
			// Effective sample size for unequal weights
			const nEff = (sumW * sumW) / d3.sum(ws, (w) => w * w);
			ySE = nEff > 1 ? Math.sqrt(wVar / nEff) : 0;
		} else {
			totalPop = 0;
			yMean = d3.mean(ys);
			const variance = d3.variance(ys);
			ySE = slice.length < 2 || variance === undefined ? 0 : Math.sqrt(variance / slice.length);
		}

		const xMid = d3.mean(xs);
		const lo = d3.min(xs);
		const hi = d3.max(xs);
		const fmt = d3.format('.1f');
		const binLabel = lo === hi ? fmt(lo) : `${fmt(lo)}\u2013${fmt(hi)}`;

		out.push({ binLabel, xMid, xMin: lo, xMax: hi, yMean, ySE, count: slice.length, totalPop });
	}

	return out;
}

/**
 * Assign each row's X to a bin index using inclusive ``[xMin, xMax]`` ranges from
 * ``computeBins`` output. When X falls in overlapping ranges (duplicate boundaries),
 * the lowest bin index wins.
 *
 * Parameters
 * ----------
 * x : number
 * bins : Array<{ xMin: number, xMax: number }>
 *
 * Returns
 * -------
 * number
 *     Bin index, or ``-1`` if outside all ranges.
 */
export function binIndexForX(x, bins) {
	if (!Number.isFinite(x) || !bins?.length) return -1;
	for (let i = 0; i < bins.length; i++) {
		const lo = bins[i].xMin;
		const hi = bins[i].xMax;
		if (x >= lo && x <= hi) return i;
	}
	return -1;
}

/**
 * Population-weighted Y mean and SE for rows assigned to each bin by X (same
 * ``xMin``/``xMax`` edges as reference bins).
 *
 * Parameters
 * ----------
 * rows : Array<{ x: number, y: number, w?: number }>
 * bins : Array<{ xMin: number, xMax: number }>
 *
 * Returns
 * -------
 * Array<{ yMean: number, ySE: number, count: number, totalPop: number }>
 *     One entry per reference bin (same length as ``bins``).
 */
export function computeBinnedMomentsForRows(rows, bins) {
	const perBin = bins.map(() => ({ slice: [] }));
	for (const r of rows) {
		if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
		const w = r.w == null || r.w > 0 ? r.w ?? 1 : 0;
		if (w <= 0) continue;
		const idx = binIndexForX(r.x, bins);
		if (idx < 0) continue;
		perBin[idx].slice.push({ y: r.y, w });
	}

	return perBin.map(({ slice }) => {
		const n = slice.length;
		if (n === 0) {
			return { yMean: NaN, ySE: NaN, count: 0, totalPop: 0 };
		}
		const ws = slice.map((r) => r.w || 1);
		const ys = slice.map((r) => r.y);
		const sumW = d3.sum(ws);
		const totalPop = sumW;
		const yMean = d3.sum(slice, (r, i) => ws[i] * ys[i]) / sumW;
		const wVar = d3.sum(slice, (r, i) => ws[i] * (ys[i] - yMean) ** 2) / sumW;
		const nEff = (sumW * sumW) / d3.sum(ws, (w) => w * w);
		const ySE = nEff > 1 ? Math.sqrt(wVar / nEff) : 0;
		return { yMean, ySE, count: n, totalPop };
	});
}
