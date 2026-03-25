<script>
	import { onMount } from 'svelte';
	import * as d3 from 'd3';
	import { createPanelState } from '$lib/stores/panelState.svelte.js';
	import { buildFilteredData, getScatterXValue, popWeightKey } from '$lib/utils/derived.js';
	import { tractData, developments } from '$lib/stores/data.svelte.js';
	import AnalysisPanel from '$lib/components/AnalysisPanel.svelte';

	const leftPanel = createPanelState('left');
	const rightPanel = createPanelState('right');

	let synced = $state(false);
	let syncAxes = $state(false);
	let mobileTab = $state('left');
	let wide = $state(true);

	onMount(() => {
		const mq = window.matchMedia('(min-width: 1200px)');
		const update = () => {
			wide = mq.matches;
		};
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	});

	/**
	 * When sync-axes is on and both panels share the same variables,
	 * compute merged axis domains so they're directly comparable.
	 */
	const domainOverride = $derived.by(() => {
		if (!syncAxes) return null;
		if (tractData.length === 0) return null;

		const panels = [leftPanel, rightPanel];
		const allY = [], allX = [], allColor = [];

		for (const ps of panels) {
			const tp = ps.timePeriod;
			const xBase = ps.xVar;
			const yBase = ps.yVar;
			const yKey = `${yBase}_${tp}`;
			const { filteredTracts, devAgg } = buildFilteredData(tractData, developments, ps);

			for (const t of filteredTracts) {
				if (t[yKey] == null) continue;
				const yVal = Number(t[yKey]);
				if (Number.isFinite(yVal)) allColor.push(yVal);
				const xVal = getScatterXValue(t, t.gisjoin, xBase, devAgg, tp);
				if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
					allX.push(xVal);
					allY.push(yVal);
				}
			}
		}

		if (allX.length === 0) return null;

		const xDomain = d3.extent(allX);
		const yDomain = d3.extent(allY);

		// 3-sigma clipped color domain
		const mean = d3.mean(allColor);
		const sd = Math.sqrt(d3.variance(allColor) || 0);
		const clipped = allColor.filter((v) => v >= mean - 3 * sd && v <= mean + 3 * sd);
		const colorDomain = clipped.length > 0 ? d3.extent(clipped) : d3.extent(allColor);

		return { xDomain, yDomain, colorDomain };
	});

	// When sync is on, mirror left filter fields onto the right panel.
	// Mirror all left-panel filter fields onto the right panel when sync is on.
	$effect(() => {
		if (!synced) return;
		rightPanel.timePeriod = leftPanel.timePeriod;
		rightPanel.xVar = leftPanel.xVar;
		rightPanel.yVar = leftPanel.yVar;
		rightPanel.todMinStopsPerSqMi = leftPanel.todMinStopsPerSqMi;
		rightPanel.nonTodMaxStopsPerSqMi = leftPanel.nonTodMaxStopsPerSqMi;
		rightPanel.todTransitModes = { ...leftPanel.todTransitModes };
		rightPanel.nonTodTransitModes = { ...leftPanel.nonTodTransitModes };
		rightPanel.todMinAffordableSharePct = leftPanel.todMinAffordableSharePct;
		rightPanel.nonTodMinAffordableSharePct = leftPanel.nonTodMinAffordableSharePct;
		rightPanel.todMinStockIncreasePct = leftPanel.todMinStockIncreasePct;
		rightPanel.nonTodMinStockIncreasePct = leftPanel.nonTodMinStockIncreasePct;
		rightPanel.minStopsPerSqMi = leftPanel.minStopsPerSqMi;
		rightPanel.minPopulation = leftPanel.minPopulation;
		rightPanel.minPopDensity = leftPanel.minPopDensity;
		rightPanel.minHuChange = leftPanel.minHuChange;
		rightPanel.minUnitsPerProject = leftPanel.minUnitsPerProject;
		rightPanel.minDevMultifamilyRatioPct = leftPanel.minDevMultifamilyRatioPct;
		rightPanel.minDevAffordableRatioPct = leftPanel.minDevAffordableRatioPct;
		rightPanel.includeRedevelopment = leftPanel.includeRedevelopment;
		rightPanel.showDevelopments = leftPanel.showDevelopments;
		rightPanel.showBusLines = leftPanel.showBusLines;
		rightPanel.showRailLines = leftPanel.showRailLines;
		rightPanel.showCommuterRailLines = leftPanel.showCommuterRailLines;
		rightPanel.showBusStops = leftPanel.showBusStops;
		rightPanel.showRailStops = leftPanel.showRailStops;
		rightPanel.showCommuterRailStops = leftPanel.showCommuterRailStops;
		rightPanel.showMapTodCohortShade = leftPanel.showMapTodCohortShade;
		rightPanel.showMapControlCohortShade = leftPanel.showMapControlCohortShade;
		rightPanel.trimOutliers = leftPanel.trimOutliers;
		rightPanel.showNonTodScatter = leftPanel.showNonTodScatter;
		rightPanel.showNonTodBinnedBars = leftPanel.showNonTodBinnedBars;
	});
</script>

<div class="dual-root">
	<div class="toolbar">
		{#if !wide}
			<div class="mobile-tabs" role="tablist" aria-label="Panel">
				<button
					type="button"
					role="tab"
					class="mobile-tab"
					aria-selected={mobileTab === 'left'}
					onclick={() => (mobileTab = 'left')}
				>
					Left panel
				</button>
				<button
					type="button"
					role="tab"
					class="mobile-tab"
					aria-selected={mobileTab === 'right'}
					onclick={() => (mobileTab = 'right')}
				>
					Right panel
				</button>
			</div>
		{/if}
		<button
			type="button"
			class="sync-pill"
			class:on={synced}
			onclick={() => (synced = !synced)}
			aria-pressed={synced}
		>
			<span class="sync-dot" class:on={synced}></span>
			Sync filters
		</button>
		<button
			type="button"
			class="sync-pill"
			class:on={syncAxes}
			onclick={() => (syncAxes = !syncAxes)}
			aria-pressed={syncAxes}
		>
			<span class="sync-dot" class:on={syncAxes}></span>
			Sync axes
		</button>
	</div>

	<div class="panels" class:narrow={!wide}>
		<div class="panel-slot" class:hidden={!wide && mobileTab !== 'left'}>
			<AnalysisPanel panelState={leftPanel} {domainOverride} />
		</div>
		<div class="panel-slot" class:hidden={!wide && mobileTab !== 'right'}>
			<AnalysisPanel panelState={rightPanel} {domainOverride} />
		</div>
	</div>
</div>

<style>
	.dual-root {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		min-height: 100%;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}

	.mobile-tabs {
		display: flex;
		margin-right: auto;
		padding: 2px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: 999px;
	}

	.mobile-tab {
		border: none;
		background: transparent;
		color: var(--text-muted);
		padding: 6px 14px;
		border-radius: 999px;
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.mobile-tab[aria-selected='true'] {
		background: var(--bg-hover);
		color: var(--text);
	}

	.sync-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 14px 6px 10px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--bg-card);
		color: var(--text-muted);
		font-size: 0.8125rem;
		font-weight: 500;
		transition:
			border-color 0.15s ease,
			color 0.15s ease,
			background 0.15s ease;
	}

	.sync-pill.on {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
		color: var(--text);
		background: color-mix(in srgb, var(--accent) 10%, var(--bg-card));
	}

	.sync-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
		transition: background 0.15s ease;
	}

	.sync-dot.on {
		background: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
	}

	.panels {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 8px;
		align-items: start;
		flex: 1;
		min-height: 0;
	}

	/* Prevent wide filter/chart content from overflowing the column and covering the sibling panel. */
	.panel-slot {
		min-width: 0;
		max-width: 100%;
	}

	@media (max-width: 1199px) {
		.panels.narrow {
			grid-template-columns: 1fr;
		}
	}

	.panel-slot.hidden {
		display: none;
	}
</style>
