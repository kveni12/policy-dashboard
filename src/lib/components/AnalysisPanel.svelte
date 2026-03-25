<script>
	import FilterPanel from '$lib/components/FilterPanel.svelte';
	import MapView from '$lib/components/MapView.svelte';
	import ScatterPlot from '$lib/components/ScatterPlot.svelte';
	import BinnedBarChart from '$lib/components/BinnedBarChart.svelte';
	import TractDetail from '$lib/components/TractDetail.svelte';
	import MethodologyNote from '$lib/components/MethodologyNote.svelte';
	import { tractData, meta } from '$lib/stores/data.svelte.js';
	import {
		cohortYMeansForPanel,
		selectedTractsYWeightedMean,
		yMetricDisplayKind,
		formatYMetricSummary
	} from '$lib/utils/derived.js';

	let { panelState, domainOverride = null } = $props();

	/** @type {'map' | 'scatter' | 'bar'} */
	let activeTab = $state('map');

	const tabs = $derived([
		{ id: 'map', label: 'Map' },
		{ id: 'scatter', label: 'Scatter' },
		{ id: 'bar', label: 'Bar' }
	]);

	/** Tracks all inputs that change TOD / non-TOD cohort membership or the Y field. */
	const cohortSummaryKey = $derived(
		JSON.stringify({
			tp: panelState.timePeriod,
			y: panelState.yVar,
			n: tractData.length,
			stops: panelState.minStopsPerSqMi,
			nonTodMax: panelState.nonTodMaxStopsPerSqMi,
			todModes: panelState.todTransitModes,
			nonTodModes: panelState.nonTodTransitModes,
			todMin: panelState.todMinStopsPerSqMi,
			todAffPct: panelState.todMinAffordableSharePct,
			nonTodAffPct: panelState.nonTodMinAffordableSharePct,
			todStockPct: panelState.todMinStockIncreasePct,
			nonTodStockPct: panelState.nonTodMinStockIncreasePct,
			minPop: panelState.minPopulation,
			minDens: panelState.minPopDensity,
			minHU: panelState.minHuChange,
			sel: [...panelState.selectedTracts].sort().join('\t')
		})
	);

	/**
	 * Population-weighted mean of the selected Y for each cohort (same weighting as the
	 * binned bar chart).
	 */
	const cohortStats = $derived.by(() => {
		void cohortSummaryKey;
		const raw = cohortYMeansForPanel(tractData, panelState);
		if (!raw) return null;
		const yMeta = meta.yVariables?.find((v) => v.key === raw.yBase);
		const kind = yMetricDisplayKind(yMeta);
		const selRaw = selectedTractsYWeightedMean(
			tractData,
			panelState,
			panelState.selectedTracts
		);
		return {
			...raw,
			displayLabel: yMeta?.label ?? raw.yBase,
			kind,
			fmtTod: formatYMetricSummary(raw.meanTod, kind),
			fmtCtrl: formatYMetricSummary(raw.meanNonTod, kind),
			fmtSelected: formatYMetricSummary(selRaw?.mean ?? NaN, kind),
			nSel: selRaw?.nSelected ?? 0,
			nSelWithY: selRaw?.nWithY ?? 0
		};
	});
</script>

<section class="analysis-panel" aria-labelledby="panel-title-{panelState.id}">
	<h2 id="panel-title-{panelState.id}" class="sr-only">
		Analysis ({panelState.id} panel)
	</h2>

	<FilterPanel {panelState} />

	{#if cohortStats}
		<div
			class="cohort-summary"
			role="region"
			aria-label="Population-weighted averages for the Y variable: TOD, non-TOD, and manual selection"
		>
			<p class="cohort-summary-heading">{cohortStats.displayLabel}</p>
			<div class="cohort-summary-grid">
				<div class="cohort-pill cohort-pill--tod">
					<span class="cohort-pill-label">TOD (analysis)</span>
					<span class="cohort-pill-value">{cohortStats.fmtTod}</span>
					<span class="cohort-pill-n">
						{cohortStats.nTodWithY} / {cohortStats.nTod} tracts with data
					</span>
				</div>
				<div class="cohort-pill cohort-pill--ctrl">
					<span class="cohort-pill-label">non-TOD (control)</span>
					<span class="cohort-pill-value">{cohortStats.fmtCtrl}</span>
					<span class="cohort-pill-n">
						{cohortStats.nNonTodWithY} / {cohortStats.nNonTod} tracts with data
					</span>
				</div>
				<div class="cohort-pill cohort-pill--picked">
					<span class="cohort-pill-label">Selected tracts</span>
					<span class="cohort-pill-value">{cohortStats.fmtSelected}</span>
					<span class="cohort-pill-n">
						{#if cohortStats.nSel === 0}
							None selected — click the map to add tracts
						{:else}
							{cohortStats.nSelWithY} / {cohortStats.nSel} selected with data
						{/if}
					</span>
				</div>
			</div>
			<p class="cohort-summary-note">
				Means weighted by tract {cohortStats.weightLabel} (same as the bar chart). Selected tracts
				use your current map/scatter selection only (any cohort).
			</p>
		</div>
	{/if}

	<div class="viz-tabs" role="tablist" aria-label="Visualization">
		{#each tabs as t (t.id)}
			<button
				type="button"
				role="tab"
				class="viz-tab"
				aria-selected={activeTab === t.id}
				onclick={() => (activeTab = t.id)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	<!-- Mount only the active viz so hidden panes never overlap clicks and D3 always gets real layout width. -->
	<div class="viz-surface" role="tabpanel">
		{#if activeTab === 'map'}
			<div class="viz-pane">
				<MapView {panelState} {domainOverride} />
			</div>
		{:else if activeTab === 'scatter'}
			<div class="viz-pane">
				<ScatterPlot {panelState} {domainOverride} />
			</div>
		{:else}
			<div class="viz-pane">
				<BinnedBarChart {panelState} {domainOverride} />
			</div>
		{/if}
	</div>

	<TractDetail {panelState} />
	<MethodologyNote />
</section>

<style>
	.analysis-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
		max-width: 100%;
		min-height: 0;
		padding: 12px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.cohort-summary {
		padding: 8px 10px 9px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.cohort-summary-heading {
		margin: 0 0 6px;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		line-height: 1.25;
	}

	.cohort-summary-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}

	@media (max-width: 720px) {
		.cohort-summary-grid {
			grid-template-columns: 1fr;
		}
	}

	.cohort-pill {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		min-width: 0;
	}

	.cohort-pill--tod {
		background: color-mix(in srgb, var(--accent) 10%, var(--bg-panel));
		border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
	}

	.cohort-pill--ctrl {
		background: color-mix(in srgb, #64748b 8%, var(--bg-panel));
		border-color: color-mix(in srgb, #64748b 28%, var(--border));
	}

	.cohort-pill-label {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.cohort-pill-value {
		font-size: 1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		line-height: 1.2;
	}

	.cohort-pill--tod .cohort-pill-value {
		color: var(--accent);
	}

	.cohort-pill--ctrl .cohort-pill-value {
		color: #64748b;
	}

	.cohort-pill--picked {
		background: color-mix(in srgb, var(--cat-a, #c2410c) 12%, var(--bg-panel));
		border-color: color-mix(in srgb, var(--cat-a, #c2410c) 40%, var(--border));
	}

	.cohort-pill--picked .cohort-pill-value {
		color: var(--cat-a, #c2410c);
	}

	.cohort-pill-n {
		font-size: 0.625rem;
		color: var(--text-muted);
		line-height: 1.2;
	}

	.cohort-summary-note {
		margin: 6px 0 0;
		font-size: 0.5625rem;
		line-height: 1.35;
		color: var(--text-muted);
		opacity: 0.92;
	}

	.viz-tabs {
		position: relative;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 4px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.viz-tab {
		flex: 1;
		min-width: 4.5rem;
		padding: 8px 12px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}

	.viz-tab[aria-selected='true'] {
		background: var(--bg-hover);
		color: var(--accent);
	}

	.viz-surface {
		position: relative;
		isolation: isolate;
		min-height: 280px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-card);
		overflow: hidden;
	}

	.viz-pane {
		min-width: 0;
	}
</style>
