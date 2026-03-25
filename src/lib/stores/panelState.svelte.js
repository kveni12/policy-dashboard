/**
 * Factory for per-panel reactive state (left/right panes).
 */

/**
 * Build an isolated panel state object with Svelte 5 runes and selection helpers.
 *
 * Parameters
 * ----------
 * id : string
 *     Panel id, e.g. ``'left'`` or ``'right'``.
 *
 * Returns
 * -------
 * PanelState
 */
export function createPanelState(id) {
	class PanelState {
		id = id;

		// ── Time ───────────────────────────────────────────────
		timePeriod = $state('10_20');
		xVar = $state('pct_stock_increase');
		yVar = $state('minority_pct_change');

		// ── TOD vs non-TOD cohorts (see FilterPanel census block) ─
		todMinStopsPerSqMi = $state(4);
		nonTodMaxStopsPerSqMi = $state(4);
		todTransitModes = $state({ rail: true, commuter_rail: true, bus: true });
		nonTodTransitModes = $state({ rail: true, commuter_rail: true, bus: true });
		/** Min. share of MassBuilds new units that are affordable (0–100%); 0 = off. */
		todMinAffordableSharePct = $state(0);
		nonTodMinAffordableSharePct = $state(0);
		/** Min. tract housing stock increase (%): MassBuilds new units / census HU at period start; 0 = off. */
		todMinStockIncreasePct = $state(0);
		nonTodMinStockIncreasePct = $state(0);

		// ── Overall census tract universe ───────────────────────
		minStopsPerSqMi = $state(0);
		minPopulation = $state(0);
		// Tract-universe defaults (same floors as Policy Insights).
		minPopDensity = $state(200);
		minHuChange = $state(20);

		// ── Development filters ────────────────────────────────
		minUnitsPerProject = $state(0);
		/** Min. share of units that are multifamily (small + large MF) / ``hu``; 0 = off. */
		minDevMultifamilyRatioPct = $state(0);
		/** Min. share of units that are affordable / ``hu``; 0 = off. */
		minDevAffordableRatioPct = $state(0);
		includeRedevelopment = $state(true);

		// ── Map overlays ──────────────────────────────────────
		showDevelopments = $state(false);
		showBusLines = $state(false);
		showRailLines = $state(true);
		showCommuterRailLines = $state(true);
		showBusStops = $state(false);
		showRailStops = $state(false);
		showCommuterRailStops = $state(false);
		/** When true, tint choropleth tracts in the TOD analysis cohort (see FilterPanel). */
		showMapTodCohortShade = $state(false);
		/** When true, tint choropleth tracts in the non-TOD control cohort. */
		showMapControlCohortShade = $state(false);

		// ── Chart options ─────────────────────────────────────
		trimOutliers = $state(true);
		/** When true, scatter shows non-TOD control tracts as subdued grey underlay. */
		showNonTodScatter = $state(true);
		/** When true, binned bar chart draws a second bar per bin for the non-TOD cohort. */
		showNonTodBinnedBars = $state(true);

		// ── Selection / interaction ────────────────────────────
		selectedTracts = $state(new Set());
		hoveredTract = $state(null);

		toggleTract(gisjoin) {
			const next = new Set(this.selectedTracts);
			if (next.has(gisjoin)) next.delete(gisjoin);
			else next.add(gisjoin);
			this.selectedTracts = next;
		}

		clearSelection() {
			this.selectedTracts = new Set();
		}

		/**
		 * Replace the entire selection with the given set of gisjoins.
		 *
		 * Parameters
		 * ----------
		 * gisjoins : Iterable<string>
		 */
		selectAll(gisjoins) {
			this.selectedTracts = new Set(gisjoins);
		}

		/**
		 * Parameters
		 * ----------
		 * gisjoin : string | null
		 */
		setHovered(gisjoin) {
			this.hoveredTract = gisjoin;
		}
	}

	return new PanelState();
}
