<script>
	import { onDestroy } from 'svelte';
	import * as d3 from 'd3';
	import { tractData, tractGeo, mbtaLines } from '$lib/stores/data.svelte.js';
	import {
		isNonTodCohortTract,
		isTodCohortTract,
		passesTractUniverse
	} from '$lib/utils/derived.js';

	/**
	 * Panel-style config (same cohort / universe fields as ``PolicyInsights`` ``panelConfig``).
	 *
	 * @typedef {object} PanelConfigLike
	 */

	/** @type {{ panelConfig: PanelConfigLike }} */
	let { panelConfig } = $props();

	let containerEl = $state(null);

	const svgW = 500;
	const svgH = 400;
	const mapW = 500;
	const mapH = 310;
	const mapUid = Math.random().toString(36).slice(2, 11);

	const TOD_FILL = '#6c8cff';
	const CTRL_FILL = '#64748b';
	const OTHER_FILL = '#475569';
	const OUT_FILL = 'var(--bg-card)';

	let svgRef = $state(null);
	let lastStructuralKey = $state('');

	const structuralKey = $derived(
		JSON.stringify({
			n: tractData.length,
			gf: tractGeo?.features?.length ?? 0,
			cfg: panelConfig
		})
	);

	/**
	 * Classify a tract row for fixed-fill choropleth (TOD / control / gap / out of universe).
	 *
	 * Parameters
	 * ----------
	 * tract : object | undefined
	 * pc : PanelConfigLike
	 *
	 * Returns
	 * -------
	 * 'tod' | 'control' | 'other' | 'outside'
	 */
	function cohortFillClass(tract, pc) {
		if (!tract || !passesTractUniverse(tract, pc)) return 'outside';
		if (isTodCohortTract(tract, pc)) return 'tod';
		if (isNonTodCohortTract(tract, pc)) return 'control';
		return 'other';
	}

	function tractLookupMap() {
		const m = new Map();
		for (const t of tractData) {
			if (t?.gisjoin && typeof t.gisjoin === 'string' && t.gisjoin.startsWith('G')) {
				m.set(t.gisjoin, t);
			}
		}
		return m;
	}

	function lineStrokeColor(routeColor) {
		if (routeColor == null || routeColor === '') return '#888';
		const s = String(routeColor).trim();
		return s.startsWith('#') ? s : `#${s}`;
	}

	/** Match GTFS route_type to overlay styling (same as ``MapView``). */
	function lineMode(routeType) {
		if (routeType === 0 || routeType === 1) return 'rail';
		if (routeType === 2) return 'commuter_rail';
		if (routeType === 3) return 'bus';
		return 'other';
	}

	function rebuildSVG() {
		if (!containerEl) return;
		const root = d3.select(containerEl);
		root.selectAll('*').remove();

		const features = tractGeo?.features ?? [];
		if (features.length === 0) {
			root.append('p').attr('class', 'map-empty').text('Loading map data...');
			return;
		}

		const projection = d3.geoMercator().fitSize([mapW, mapH], tractGeo);
		const path = d3.geoPath(projection);

		const svg = root
			.append('svg')
			.attr('viewBox', `0 0 ${svgW} ${svgH}`)
			.attr('width', '100%')
			.attr('height', 'auto')
			.attr('preserveAspectRatio', 'xMidYMid meet')
			.style('display', 'block')
			.style('background', 'var(--bg, #0f1115)');
		svgRef = svg;

		const clipId = `policy-map-clip-${mapUid}`;
		svg.append('defs').append('clipPath').attr('id', clipId)
			.append('rect').attr('width', mapW).attr('height', mapH);

		const mapRoot = svg.append('g').attr('class', 'map-root').attr('clip-path', `url(#${clipId})`);
		const zoomLayer = mapRoot.append('g').attr('class', 'map-zoom-layer');

		zoomLayer.append('g').attr('class', 'mbta-lines-layer')
			.selectAll('path.mbta-line')
			.data(mbtaLines?.features ?? [], (d, i) => d.properties?.route_id ?? i)
			.join('path')
			.attr('class', 'mbta-line')
			.attr('d', path)
			.attr('fill', 'none')
			.attr('stroke', (d) => lineStrokeColor(d.properties?.route_color))
			.attr('stroke-width', 1.2)
			.attr('stroke-opacity', 0.55)
			.attr('vector-effect', 'non-scaling-stroke');

		const tLookup = tractLookupMap();
		zoomLayer.append('g').attr('class', 'tract-layer')
			.selectAll('path.tract-poly')
			.data(features, (d) => d.properties?.gisjoin)
			.join('path')
			.attr('class', 'tract-poly')
			.attr('vector-effect', 'non-scaling-stroke')
			.attr('d', path)
			.attr('fill', (d) => {
				const id = d.properties?.gisjoin;
				const row = tLookup.get(id);
				const cls = cohortFillClass(row, panelConfig);
				if (cls === 'tod') return TOD_FILL;
				if (cls === 'control') return CTRL_FILL;
				if (cls === 'other') return OTHER_FILL;
				return OUT_FILL;
			})
			.attr('fill-opacity', (d) => {
				const id = d.properties?.gisjoin;
				const row = tLookup.get(id);
				const cls = cohortFillClass(row, panelConfig);
				if (cls === 'outside') return 0.22;
				if (cls === 'other') return 0.5;
				return 0.88;
			})
			.attr('stroke', 'var(--border)')
			.attr('stroke-width', 0.35);

		const zoom = d3.zoom()
			.scaleExtent([1, 18])
			.on('zoom', (event) => {
				zoomLayer.attr('transform', event.transform);
			});
		svg.call(zoom).on('dblclick.zoom', null).style('touch-action', 'none');

		const legY = mapH + 12;
		const legG = svg.append('g').attr('class', 'policy-map-legend')
			.attr('transform', `translate(16,${legY})`);

		const items = [
			{ fill: TOD_FILL, label: 'TOD (analysis cohort)' },
			{ fill: CTRL_FILL, label: 'non-TOD (control cohort)' },
			{ fill: OTHER_FILL, label: 'In universe, neither cohort' },
			{ fill: '#94a3b8', label: 'Outside tract filters', note: 'dim' }
		];
		let y = 0;
		for (const it of items) {
			const g = legG.append('g').attr('transform', `translate(0,${y})`);
			g.append('rect')
				.attr('width', 14)
				.attr('height', 14)
				.attr('rx', 2)
				.attr('fill', it.fill)
				.attr('stroke', 'var(--border)')
				.attr('stroke-width', 0.5)
				.attr('opacity', it.note === 'dim' ? 0.35 : 1);
			g.append('text')
				.attr('x', 20)
				.attr('y', 11)
				.attr('fill', 'var(--text-muted)')
				.attr('font-size', '11px')
				.text(it.label);
			y += 20;
		}

		applyLineVisibility();
	}

	function applyLineVisibility() {
		if (!containerEl || !svgRef) return;
		const lineVis = { rail: true, commuter_rail: true, bus: false };
		d3.select(containerEl).selectAll('path.mbta-line')
			.attr('display', (d) => {
				const mode = lineMode(d.properties?.route_type);
				return lineVis[mode] ? null : 'none';
			});
	}

	$effect(() => {
		void structuralKey;
		if (!containerEl) return;
		if (structuralKey !== lastStructuralKey) {
			lastStructuralKey = structuralKey;
			rebuildSVG();
		}
	});

	onDestroy(() => {
		if (containerEl) d3.select(containerEl).selectAll('*').remove();
		svgRef = null;
	});
</script>

<div class="policy-cohort-map-wrap">
	<div class="policy-cohort-map-root" bind:this={containerEl}></div>
</div>

<style>
	.policy-cohort-map-wrap {
		width: 100%;
		max-width: 520px;
		margin: 0 auto;
	}

	.policy-cohort-map-root :global(p.map-empty) {
		margin: 0;
		padding: 24px;
		color: var(--text-muted);
		font-size: 0.9rem;
		text-align: center;
	}
</style>
