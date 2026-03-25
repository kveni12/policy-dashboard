<script>
	/**
	 * Collapsible methodology callout under the analysis panel (displacement framing + chart legend).
	 */
	let expanded = $state(false);

	function toggle() {
		expanded = !expanded;
	}
</script>

<aside class="method-note">
	<button
		type="button"
		class="toggle"
		aria-expanded={expanded}
		aria-controls="methodology-body"
		onclick={toggle}
	>
		<span class="chevron" class:open={expanded} aria-hidden="true">▸</span>
		<span class="toggle-title">Understanding the Data</span>
	</button>

	<div id="methodology-body" class="body" hidden={!expanded}>
			<section class="block cat-a">
				<h3 class="block-title">Direct Displacement Proxies</h3>
				<p>
					Tenure and homeownership shifts are <strong>proxies</strong> for displacement pressure, not
					direct proof. We do not have B25038 (tenure by year moved in) at this geography, so we rely
					on owner-to-renter dynamics and changes in minority homeownership as indirect signals.
				</p>
			</section>

			<section class="block cat-b">
				<h3 class="block-title">Demographic Succession Indicators</h3>
				<p>
					Changes in racial composition, income, and education can reflect many forces besides
					transit-oriented development. <strong>Control-group reference lines</strong> in the charts
					help separate tract-level TOD patterns from wider regional drift.
				</p>
			</section>

			<section class="block cat-c">
				<h3 class="block-title">TOD Outcome Metrics</h3>
				<p>
					Transit mode share and commute travel time describe whether growth near stations is
					associated with the mobility outcomes expected of TOD—ridership and reliance on transit
					rather than only land-use intensity.
				</p>
			</section>

			<p class="footnote">
				Scatter and bar charts focus on TOD (analysis) tracts; optional grey points or paired
				non-TOD bars compare against the control cohort from your census-tract filters.
			</p>
	</div>
</aside>

<style>
	.method-note {
		margin-top: 8px;
		padding: 8px 10px;
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--text-muted);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--text);
		text-align: left;
		font: inherit;
		cursor: pointer;
	}

	.toggle:hover .toggle-title {
		color: var(--accent-hover);
	}

	.chevron {
		display: inline-block;
		font-size: 0.65rem;
		color: var(--text-muted);
		transition: transform 0.15s ease;
		transform: rotate(0deg);
		width: 0.75rem;
		flex-shrink: 0;
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.toggle-title {
		font-weight: 600;
		font-size: 0.78rem;
		color: var(--text);
	}

	.body {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
	}

	.block {
		padding: 6px 0 6px 8px;
		margin-bottom: 6px;
		border-left: 3px solid var(--border);
	}

	.block.cat-a {
		border-left-color: var(--cat-a);
	}

	.block.cat-b {
		border-left-color: var(--cat-b);
	}

	.block.cat-c {
		border-left-color: var(--cat-c);
	}

	.block-title {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 4px;
	}

	.block p {
		margin: 0;
	}

	.block strong {
		color: var(--text);
		font-weight: 600;
	}

	.footnote {
		margin: 8px 0 0;
		padding-top: 6px;
		border-top: 1px dashed color-mix(in srgb, var(--border) 85%, transparent);
		font-size: 0.68rem;
		color: var(--text-muted);
	}
</style>
