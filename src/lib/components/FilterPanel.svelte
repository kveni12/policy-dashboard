<script>
	import { meta } from '$lib/stores/data.svelte.js';
	import { transitModeUiLabel } from '$lib/utils/derived.js';

	let { panelState } = $props();

	const groupedYVars = $derived.by(() => {
		const groups = [];
		const seen = new Set();
		for (const v of meta.yVariables ?? []) {
			if (!seen.has(v.cat)) {
				seen.add(v.cat);
				groups.push({ cat: v.cat, catLabel: v.catLabel, vars: [] });
			}
			groups.find((g) => g.cat === v.cat)?.vars.push(v);
		}
		return groups;
	});

	/** X-axis vars grouped by data source (census vs MassBuilds). */
	const groupedXVars = $derived.by(() => {
		const bySrc = new Map();
		const order = [];
		for (const v of meta.xVariables ?? []) {
			const src = v.source ?? 'other';
			if (!bySrc.has(src)) {
				bySrc.set(src, {
					source: src,
					sourceLabel: v.sourceLabel ?? src,
					vars: []
				});
				order.push(src);
			}
			bySrc.get(src).vars.push(v);
		}
		order.sort((a, b) => {
			const rank = (s) => (s === 'census' ? 0 : s === 'massbuilds' ? 1 : 2);
			return rank(a) - rank(b);
		});
		return order.map((s) => bySrc.get(s));
	});

	function toggleTodMode(key) {
		panelState.todTransitModes = {
			...panelState.todTransitModes,
			[key]: !panelState.todTransitModes[key]
		};
	}

	function toggleNonTodMode(key) {
		panelState.nonTodTransitModes = {
			...panelState.nonTodTransitModes,
			[key]: !panelState.nonTodTransitModes[key]
		};
	}
</script>

<div class="filter-panel">
	<!-- ── Section 1: Time & Axes ──────────────────────────── -->
	<fieldset class="section section--span-cols">
		<legend class="section-title">Time & Axes</legend>
		<div class="row">
			<label class="field">
				<span class="label">Period</span>
				<select bind:value={panelState.timePeriod}>
					<option value="90_00">1990–2000</option>
					<option value="00_10">2000–2010</option>
					<option value="10_20">2010–2020</option>
					<option value="90_20">1990–2020</option>
				</select>
			</label>
			<label class="field grow">
				<span class="label">X axis</span>
				<select bind:value={panelState.xVar}>
					{#each groupedXVars as group (group.source)}
						<optgroup label={group.sourceLabel}>
							{#each group.vars as v (v.key)}
								<option value={v.key}>{v.label}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>
			<label class="field grow">
				<span class="label">Y axis</span>
				<select bind:value={panelState.yVar}>
					{#each groupedYVars as group (group.cat)}
						<optgroup label={group.catLabel}>
							{#each group.vars as v (v.key)}
								<option value={v.key}>{v.label}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>
		</div>
	</fieldset>

	<!-- ── Census tract filtering: universe + TOD / non-TOD cohorts ── -->
	<fieldset class="section section--census-tracts">
		<legend class="section-title">Census tract filtering</legend>
		<div class="census-grid">
			<div class="census-col census-col--overall">
				<p class="sublegend">Overall tract filters</p>
				<p class="section-hint section-hint--tight">
					Applied first: only tracts passing these appear in any view.
				</p>
				<div class="row">
					<label class="field" title="Minimum population at the start of the selected time period">
						<span class="label">Min. population</span>
						<input type="number" min="0" step="100" bind:value={panelState.minPopulation} />
					</label>
					<label class="field" title="Minimum population per square mile at the start of the selected time period">
						<span class="label">Min. pop. density (per mi²)</span>
						<input type="number" min="0" step="100" bind:value={panelState.minPopDensity} />
					</label>
				</div>
				<div class="row row-follow">
					<label class="field" title="Minimum change in housing units (census) over the selected period">
						<span class="label">Min. HU change</span>
						<input type="number" min="0" step="10" bind:value={panelState.minHuChange} />
					</label>
					<label class="field" title="Minimum transit stops per square mile (stops within tract + 0.1 mi buffer) for inclusion in the analysis universe">
						<span class="label">Min. stops / mi²</span>
						<input type="number" min="0" step="0.5" bind:value={panelState.minStopsPerSqMi} />
					</label>
				</div>
			</div>
			<div class="census-col census-col--cohorts">
				<div class="cohort-block">
					<p class="sublegend">Definition of control group census tracts (&ldquo;non-TOD&rdquo;)</p>
					<div class="row">
						<label
							class="field"
							title="Control cohort: tracts must have stops/mi² ≤ this value (inclusive). Tracts strictly above max are excluded. Use 0 for no ceiling."
						>
							<span class="label">Max. stops / mi² (≤)</span>
							<input type="number" min="0" step="0.5" bind:value={panelState.nonTodMaxStopsPerSqMi} />
						</label>
						<label
							class="field"
							title="Minimum share of MassBuilds new units in this period that are affordable (tract-level totals). 0 = no filter. Tracts with no new units in the period are excluded when this is &gt; 0."
						>
							<span class="label">Min. affordable dev. share (%)</span>
							<input type="number" min="0" max="100" step="1" bind:value={panelState.nonTodMinAffordableSharePct} />
						</label>
						<label
							class="field"
							title="Minimum housing stock increase (%): tract MassBuilds new units in the selected period ÷ census housing units at period start. 0 = off. Tracts with no base stock fail when this is &gt; 0."
						>
							<span class="label">Min. stock increase (%)</span>
							<input type="number" min="0" step="0.1" bind:value={panelState.nonTodMinStockIncreasePct} />
						</label>
					</div>
					<div class="modes modes--tight">
						<span class="label">Transit modes present</span>
						<div class="chips">
							{#each Object.keys(panelState.nonTodTransitModes) as key (key)}
								<button
									type="button"
									class="chip"
									class:active={panelState.nonTodTransitModes[key]}
									onclick={() => toggleNonTodMode(key)}
								>
									{transitModeUiLabel(key)}
								</button>
							{/each}
						</div>
					</div>
				</div>
				<div class="cohort-block cohort-block--tod">
					<p class="sublegend">Currently analyzing census tracts (&ldquo;TOD&rdquo;)</p>
					<div class="row">
						<label
							class="field"
							title="Minimum stops/mi² to classify a tract as TOD. When 0, any tract with at least one MBTA stop in the buffer counts as TOD if modes match."
						>
							<span class="label">Min. stops / mi² (TOD)</span>
							<input type="number" min="0" step="0.5" bind:value={panelState.todMinStopsPerSqMi} />
						</label>
						<label
							class="field"
							title="Minimum share of MassBuilds new units in this period that are affordable (tract-level totals). 0 = no filter. Tracts with no new units in the period are excluded when this is &gt; 0."
						>
							<span class="label">Min. affordable dev. share (%)</span>
							<input type="number" min="0" max="100" step="1" bind:value={panelState.todMinAffordableSharePct} />
						</label>
						<label
							class="field"
							title="Minimum housing stock increase (%): tract MassBuilds new units in the selected period ÷ census housing units at period start. 0 = off."
						>
							<span class="label">Min. stock increase (%)</span>
							<input type="number" min="0" step="0.1" bind:value={panelState.todMinStockIncreasePct} />
						</label>
					</div>
					<div class="modes modes--tight">
						<span class="label">Transit modes present</span>
						<div class="chips">
							{#each Object.keys(panelState.todTransitModes) as key (key)}
								<button
									type="button"
									class="chip"
									class:active={panelState.todTransitModes[key]}
									onclick={() => toggleTodMode(key)}
								>
									{transitModeUiLabel(key)}
								</button>
							{/each}
						</div>
					</div>
				</div>
			</div>
		</div>
	</fieldset>

	<!-- ── Development Filters ──────────────────── -->
	<fieldset class="section">
		<legend class="section-title">Development Filters</legend>
		<p class="section-hint section-hint--tight">
			These options filter which MassBuilds projects count toward development metrics.
		</p>
		<div class="row">
			<label class="field" title="Exclude individual projects below this unit count">
				<span class="label">Min. units / project</span>
				<input type="number" min="0" step="1" bind:value={panelState.minUnitsPerProject} />
			</label>
			<label
				class="field"
				title="Each project must have at least this share of units in small + large multifamily (MassBuilds). 0 = off."
			>
				<span class="label">Min. multifamily ratio (%)</span>
				<input
					type="number"
					min="0"
					max="100"
					step="1"
					bind:value={panelState.minDevMultifamilyRatioPct}
				/>
			</label>
			<label
				class="field"
				title="Each project must have at least this share of units counted as affordable. 0 = off."
			>
				<span class="label">Min. affordable ratio (%)</span>
				<input
					type="number"
					min="0"
					max="100"
					step="1"
					bind:value={panelState.minDevAffordableRatioPct}
				/>
			</label>
		</div>
		<div class="toggles">
			<label class="toggle-item">
				<input type="checkbox" bind:checked={panelState.includeRedevelopment} />
				<span>Include redevelopment</span>
			</label>
		</div>
	</fieldset>

	<!-- ── Section 4: Map Overlays ───────────────────────────── -->
	<fieldset class="section">
		<legend class="section-title">Map Overlays</legend>
		<div class="overlay-grid">
			<div class="overlay-header"></div>
			<div class="overlay-header overlay-col-label">Lines</div>
			<div class="overlay-header overlay-col-label">Stops</div>

			<span class="overlay-row-label">Bus</span>
			<label class="overlay-toggle"><input type="checkbox" bind:checked={panelState.showBusLines} /></label>
			<label class="overlay-toggle"><input type="checkbox" bind:checked={panelState.showBusStops} /></label>

			<span class="overlay-row-label">Rapid transit</span>
			<label class="overlay-toggle"><input type="checkbox" bind:checked={panelState.showRailLines} /></label>
			<label class="overlay-toggle"><input type="checkbox" bind:checked={panelState.showRailStops} /></label>

			<span class="overlay-row-label">Commuter rail</span>
			<label class="overlay-toggle"><input type="checkbox" bind:checked={panelState.showCommuterRailLines} /></label>
			<label class="overlay-toggle"><input type="checkbox" bind:checked={panelState.showCommuterRailStops} /></label>
		</div>
		<div class="toggles toggles-follow">
			<label class="toggle-item show-devs">
				<input type="checkbox" bind:checked={panelState.showDevelopments} />
				<span>Show developments</span>
			</label>
			<label
				class="toggle-item"
				title="Tint TOD analysis cohort tracts on the choropleth (accent color blended with the Y scale)"
			>
				<input type="checkbox" bind:checked={panelState.showMapTodCohortShade} />
				<span>Highlight TOD tracts on map</span>
			</label>
			<label
				class="toggle-item"
				title="Tint non-TOD control cohort tracts on the choropleth (slate tone blended with the Y scale)"
			>
				<input type="checkbox" bind:checked={panelState.showMapControlCohortShade} />
				<span>Highlight control (non-TOD) tracts on map</span>
			</label>
		</div>
	</fieldset>
</div>

<style>
	.filter-panel {
		min-width: 0;
		/* Tile fieldsets in columns where width allows; wraps to fewer columns on narrow panels */
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		align-items: start;
		gap: 6px;
		container-type: inline-size;
		container-name: filter-panel;
		/* Compact controls: smaller type and inputs to save vertical space */
		font-size: 0.6875rem;
	}

	/* Keep Period + X + Y on one row when the panel is wide enough for a multi-column grid */
	@container filter-panel (min-width: 440px) {
		.section--span-cols,
		.section--census-tracts {
			grid-column: 1 / -1;
		}
	}

	.section--census-tracts {
		min-width: 0;
	}

	.census-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
		align-items: start;
		margin-top: 2px;
	}

	@container filter-panel (min-width: 520px) {
		.census-grid {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}

	.census-col--overall {
		min-width: 0;
	}

	.census-col--cohorts {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.cohort-block {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--bg-panel) 88%, var(--bg-card));
		padding: 5px 6px 6px;
	}

	.cohort-block--tod {
		margin-top: 0;
	}

	.sublegend {
		font-size: 0.5625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin: 0 0 2px;
		line-height: 1.25;
	}

	.section-hint--tight {
		margin-top: 0;
		margin-bottom: 4px;
	}

	.modes--tight {
		margin-top: 3px;
	}

	.filter-panel :global(select),
	.filter-panel :global(input[type='number']) {
		font-size: 0.6875rem;
		line-height: 1.25;
		padding: 2px 5px;
		min-height: 22px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-panel);
		color: var(--text);
	}

	.filter-panel :global(select) {
		padding-right: 1.5rem;
	}

	.section {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		padding: 5px 8px 6px;
		margin: 0;
		min-width: 0;
	}

	.section-title {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		padding: 0 2px;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: flex-end;
	}

	.row-follow {
		margin-top: 4px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.field.grow {
		flex: 1 1 140px;
	}

	.label {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		line-height: 1.2;
	}

	.modes {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-top: 4px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.chip {
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--bg-panel);
		color: var(--text-muted);
		font-size: 0.625rem;
		text-transform: capitalize;
		cursor: pointer;
		line-height: 1.3;
	}

	.chip.active {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
	}

	.toggles {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		margin-top: 4px;
	}

	.toggles-follow {
		margin-top: 4px;
	}

	.toggle-item {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.6875rem;
		color: var(--text-muted);
		cursor: pointer;
		line-height: 1.2;
	}

	.toggle-item input[type='checkbox'] {
		accent-color: var(--accent);
		margin: 0;
	}

	.show-devs {
		color: var(--accent);
		font-weight: 600;
	}

	.section-hint {
		font-size: 0.5625rem;
		color: var(--text-muted);
		line-height: 1.35;
		margin-top: 3px;
		opacity: 0.85;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	.overlay-grid {
		display: grid;
		grid-template-columns: auto 1fr 1fr;
		gap: 7px 8px;
		align-items: center;
	}

	.overlay-header {
		font-size: 0.5625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.overlay-col-label {
		text-align: center;
	}

	.overlay-row-label {
		font-size: 0.625rem;
		color: var(--text-muted);
		text-transform: capitalize;
		line-height: 1.2;
	}

	.overlay-toggle {
		display: flex;
		justify-content: center;
		cursor: pointer;
	}

	.overlay-toggle input[type='checkbox'] {
		accent-color: var(--accent);
		margin: 0;
	}
</style>
