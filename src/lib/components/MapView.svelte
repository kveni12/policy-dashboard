<script>
	import { onDestroy } from 'svelte';
	import * as d3 from 'd3';
	import {
		tractData,
		tractGeo,
		developments,
		mbtaStops,
		mbtaLines,
		meta
	} from '$lib/stores/data.svelte.js';
	import {
		buildFilteredData,
		developmentAffordableUnitsCapped,
		getNonTodTracts,
		getTodTracts,
		tractStopsDensityForDisplay,
		transitModeUiLabel
	} from '$lib/utils/derived.js';
	import { periodCensusBounds } from '$lib/utils/periods.js';

	let { panelState, domainOverride = null } = $props();

	let containerEl = $state(null);
	let tooltip = $state({ visible: false, x: 0, y: 0, lines: [] });

	const svgW = 500;
	const svgH = 420;
	const mapW = 500;
	const mapH = 330;
	const mapUid = Math.random().toString(36).slice(2, 11);

	/** Choropleth cohort tints: align with policy page / ``--accent`` (TOD) and control slate. */
	const MAP_TOD_COHORT_HEX = '#6c8cff';
	const MAP_CTRL_COHORT_HEX = '#64748b';

	/**
	 * Linear RGB blend for overlaying cohort highlights on Viridis fills.
	 *
	 * Parameters
	 * ----------
	 * bottom : d3.RgbColor | string
	 *     Existing fill (hex from color scale).
	 * topHex : string
	 *     Overlay color as ``#rrggbb``.
	 * t : number
	 *     Weight on ``topHex`` in ``[0, 1]``.
	 *
	 * Returns
	 * -------
	 * string
	 *     Blended color as hex.
	 */
	function blendHex(bottom, topHex, t) {
		const a = d3.rgb(bottom);
		const b = d3.rgb(topHex);
		return d3.rgb(
			a.r * (1 - t) + b.r * t,
			a.g * (1 - t) + b.g * t,
			a.b * (1 - t) + b.b * t
		).formatHex();
	}

	const structuralKey = $derived(
		JSON.stringify({
			n: tractData.length,
			gf: tractGeo?.features?.length ?? 0,
			ms: mbtaStops.length
		})
	);

	const dataKey = $derived(
		JSON.stringify({
			tp: panelState.timePeriod,
			y: panelState.yVar,
			stops: panelState.minStopsPerSqMi,
			nonTodMax: panelState.nonTodMaxStopsPerSqMi,
			todModes: panelState.todTransitModes,
			nonTodModes: panelState.nonTodTransitModes,
			todMin: panelState.todMinStopsPerSqMi,
			todAffPct: panelState.todMinAffordableSharePct,
			nonTodAffPct: panelState.nonTodMinAffordableSharePct,
			todStockPct: panelState.todMinStockIncreasePct,
			nonTodStockPct: panelState.nonTodMinStockIncreasePct,
			devMin: panelState.minUnitsPerProject,
			devMfPct: panelState.minDevMultifamilyRatioPct,
			devAffPct: panelState.minDevAffordableRatioPct,
			redev: panelState.includeRedevelopment,
			minPop: panelState.minPopulation,
			minDens: panelState.minPopDensity,
			minHU: panelState.minHuChange,
			domSync: domainOverride ? 'on' : 'off',
			domColor: domainOverride?.colorDomain,
			mapTod: panelState.showMapTodCohortShade,
			mapCtrl: panelState.showMapControlCohortShade
		})
	);

	let lastStructuralKey = $state('');
	let svgRef = $state(null);
	let projectionRef = $state(null);

	function isChangeVariable(yBase) {
		return String(yBase).includes('change');
	}

	function stopColor(stop) {
		if (stop.color) return stop.color;
		const m = stop.modes ?? [];
		// Match commuter_rail before rail — ``'commuter_rail'.includes('rail')`` would misclassify.
		if (m.includes('commuter_rail')) return '#a855f7';
		if (m.includes('rail')) return '#3b82f6';
		if (m.includes('bus')) return '#f97316';
		return '#888';
	}

	function stopRadius(stop) {
		const m = stop.modes ?? [];
		if (m.includes('rail') || m.includes('commuter_rail')) return 3;
		return 1.2;
	}

	function lineStrokeColor(routeColor) {
		if (routeColor == null || routeColor === '') return '#888';
		const s = String(routeColor).trim();
		return s.startsWith('#') ? s : `#${s}`;
	}

	/** Map GTFS route_type to the same mode tokens used in stops. */
	function lineMode(routeType) {
		if (routeType === 0 || routeType === 1) return 'rail';
		if (routeType === 2) return 'commuter_rail';
		if (routeType === 3) return 'bus';
		return 'other';
	}

	function buildTractLookup() {
		const m = new Map();
		for (const t of tractData) {
			if (t.gisjoin && typeof t.gisjoin === 'string' && t.gisjoin.startsWith('G'))
				m.set(t.gisjoin, t);
		}
		return m;
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
		projectionRef = projection;
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

		const clipId = `map-clip-${mapUid}`;
		svg.append('defs').append('clipPath').attr('id', clipId)
			.append('rect').attr('width', mapW).attr('height', mapH);

		const mapRoot = svg.append('g').attr('class', 'map-root').attr('clip-path', `url(#${clipId})`);
		const zoomLayer = mapRoot.append('g').attr('class', 'map-zoom-layer');

		// Tract polygons
		zoomLayer.append('g').attr('class', 'tract-layer')
			.selectAll('path.tract-poly')
			.data(features, (d) => d.properties?.gisjoin)
			.join('path')
			.attr('class', 'tract-poly')
			.attr('vector-effect', 'non-scaling-stroke')
			.attr('d', path)
			.attr('fill', 'var(--bg-card)')
			.attr('stroke', 'var(--border)')
			.attr('stroke-width', 0.5)
			.style('cursor', 'pointer')
			.on('mouseenter', handleTractEnter)
			.on('mousemove', handleMouseMove)
			.on('mouseleave', handleTractLeave)
			.on('click', handleTractClick);

		// MBTA lines
		zoomLayer.append('g').attr('class', 'mbta-lines-layer')
			.selectAll('path.mbta-line')
			.data(mbtaLines?.features ?? [], (d, i) => d.properties?.route_id ?? i)
			.join('path')
			.attr('class', 'mbta-line')
			.attr('d', path)
			.attr('fill', 'none')
			.attr('stroke', (d) => lineStrokeColor(d.properties?.route_color))
			.attr('stroke-width', 1.5)
			.attr('stroke-opacity', 0.7)
			.attr('vector-effect', 'non-scaling-stroke')
			.style('cursor', 'pointer')
			.on('mouseenter', handleLineEnter)
			.on('mousemove', handleMouseMove)
			.on('mouseleave', handleOverlayLeave);

		// MBTA stops
		const stopG = zoomLayer.append('g').attr('class', 'mbta-stops-layer');
		stopG.selectAll('circle.mbta-stop')
			.data(mbtaStops, (d) => d.id)
			.join('circle')
			.attr('class', 'mbta-stop')
			.attr('r', (d) => stopRadius(d))
			.attr('cx', (d) => projection([d.lon, d.lat])?.[0] ?? -9999)
			.attr('cy', (d) => projection([d.lon, d.lat])?.[1] ?? -9999)
			.attr('fill', (d) => stopColor(d))
			.attr('stroke', '#555')
			.attr('stroke-width', 0.3)
			.style('cursor', 'pointer')
			.on('mouseenter', handleStopEnter)
			.on('mousemove', handleMouseMove)
			.on('mouseleave', handleOverlayLeave);

		// Development dots layer (initially empty, populated by updateDevelopments)
		zoomLayer.append('g').attr('class', 'dev-dots-layer');

		// Zoom — scale all dot overlays inversely so they stay readable
		const zoom = d3.zoom()
			.scaleExtent([1, 20])
			.on('zoom', (event) => {
				zoomLayer.attr('transform', event.transform);
				const k = event.transform.k;
				const invK = 1 / k;
				stopG.selectAll('circle.mbta-stop')
					.attr('r', (d) => stopRadius(d) * invK)
					.attr('stroke-width', 0.3 * invK);
				zoomLayer.select('.dev-dots-layer').selectAll('circle.dev-dot')
					.attr('r', 2.5 * invK)
					.attr('stroke-width', 0.3 * invK);
			});

		svg.call(zoom).on('dblclick.zoom', null).style('touch-action', 'none');

		// Legend placeholder
		svg.append('g').attr('class', 'map-legend-group');
	}

	function updateChoropleth() {
		if (!containerEl || !svgRef) return;

		const tp = panelState.timePeriod;
		const yBase = panelState.yVar;
		const yKey = `${yBase}_${tp}`;
		const yLabel = meta.yVariables?.find((v) => v.key === yBase)?.label ?? yBase;

		const { filteredTracts } = buildFilteredData(tractData, developments, panelState);
		const filteredSet = new Set(filteredTracts.map((t) => t.gisjoin));

		const lookup = new Map();
		for (const t of tractData) {
			const id = t.gisjoin;
			if (id == null || typeof id !== 'string' || !id.startsWith('G')) continue;
			const raw = t[yKey];
			if (raw == null) { lookup.set(id, NaN); continue; }
			const v = Number(raw);
			lookup.set(id, Number.isFinite(v) ? v : NaN);
		}

		const values = filteredTracts.map((t) => Number(t[yKey])).filter((v) => Number.isFinite(v));

		const todSet = new Set(getTodTracts(tractData, panelState).map((t) => t.gisjoin));
		const controlSet = new Set(getNonTodTracts(tractData, panelState).map((t) => t.gisjoin));
		const showTodShade = panelState.showMapTodCohortShade;
		const showCtrlShade = panelState.showMapControlCohortShade;

		let colorScale;
		if (values.length === 0) {
			colorScale = () => 'var(--bg-card)';
		} else if (domainOverride?.colorDomain) {
			const [lo, hi] = domainOverride.colorDomain;
			colorScale = d3.scaleSequential(d3.interpolateViridis).domain([lo, hi]).clamp(true);
		} else {
			// Clip colorbar range to exclude >3-sigma outliers
			const mean = d3.mean(values);
			const sd = Math.sqrt(d3.variance(values) ?? 0);
			const clipLo = mean - 3 * sd;
			const clipHi = mean + 3 * sd;
			const clipped = values.filter((v) => v >= clipLo && v <= clipHi);
			const lo = clipped.length > 0 ? d3.min(clipped) : d3.min(values);
			const hi = clipped.length > 0 ? d3.max(clipped) : d3.max(values);
			colorScale = d3.scaleSequential(d3.interpolateViridis).domain([lo, hi]).clamp(true);
		}

		d3.select(containerEl).selectAll('path.tract-poly')
			.attr('fill', (d) => {
				const id = d.properties?.gisjoin;
				const inFiltered = filteredSet.has(id);
				const v = lookup.get(id);
				const hasData = inFiltered && Number.isFinite(v);
				let fill = hasData ? colorScale(v) : 'var(--bg-card)';
				const inTod = todSet.has(id);
				const inCtrl = controlSet.has(id);
				// Cohort map tints: blend with Viridis when possible; solid tint when no Y value.
				if (showTodShade && inTod) {
					fill =
						typeof fill === 'string' && fill.startsWith('#')
							? blendHex(fill, MAP_TOD_COHORT_HEX, 0.4)
							: MAP_TOD_COHORT_HEX;
				} else if (showCtrlShade && inCtrl) {
					fill =
						typeof fill === 'string' && fill.startsWith('#')
							? blendHex(fill, MAP_CTRL_COHORT_HEX, 0.4)
							: MAP_CTRL_COHORT_HEX;
				}
				return fill;
			})
			.attr('fill-opacity', (d) => {
				const id = d.properties?.gisjoin;
				const inFiltered = filteredSet.has(id);
				const hasData = inFiltered && Number.isFinite(lookup.get(id));
				const inTod = todSet.has(id);
				const inCtrl = controlSet.has(id);
				const cohortLit =
					(showTodShade && inTod) || (showCtrlShade && inCtrl);
				if (cohortLit && !hasData) return 0.88;
				return hasData ? 0.9 : 0.25;
			});

		// Legend
		const svg = svgRef;
		const legGroup = svg.select('.map-legend-group');
		legGroup.selectAll('*').remove();

		const legY = mapH + 14;
		const legW = 280;
		const legH = 10;
		const legX = (svgW - legW) / 2;
		const legendG = legGroup.append('g').attr('transform', `translate(${legX},${legY})`);
		const gradId = `map-grad-${mapUid}`;
		svg.select('defs').selectAll(`#${gradId}`).remove();
		const grad = svg.select('defs').append('linearGradient').attr('id', gradId)
			.attr('x1', '0%').attr('x2', '100%');

		if (values.length > 0 && typeof colorScale.domain === 'function') {
			const domain = colorScale.domain();
			const nStops = 48;
			const legendScale = domain.length === 3
				? d3.scaleLinear().domain([domain[0], domain[2]]).range([0, legW])
				: d3.scaleLinear().domain(domain).range([0, legW]);
			for (let i = 0; i <= nStops; i++) {
				const t = i / nStops;
				const v = legendScale.invert(t * legW);
				grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', colorScale(v));
			}
			legendG.append('rect').attr('width', legW).attr('height', legH).attr('rx', 2)
				.attr('fill', `url(#${gradId})`).attr('stroke', 'var(--border)').attr('stroke-width', 0.5);

			const axisScale = domain.length === 3
				? d3.scaleLinear().domain([domain[0], domain[2]]).range([0, legW])
				: d3.scaleLinear().domain(domain).range([0, legW]);
			const axis = d3.axisBottom(axisScale).ticks(5).tickFormat(d3.format('.1f'));
			legendG.append('g').attr('transform', `translate(0,${legH + 4})`)
				.call(axis)
				.call((g) => g.selectAll('path,line').attr('stroke', 'var(--border)'))
				.call((g) => g.selectAll('text').attr('fill', 'var(--text-muted)').attr('font-size', '10px'));
		} else {
			legendG.append('rect').attr('width', legW).attr('height', legH).attr('rx', 2)
				.attr('fill', 'var(--bg-card)').attr('stroke', 'var(--border)').attr('stroke-width', 0.5);
		}

		legendG.append('text').attr('x', legW / 2).attr('y', -4)
			.attr('text-anchor', 'middle').attr('fill', 'var(--text-muted)').attr('font-size', '11px')
			.text(yLabel);

		// Cohort tint legend (below colorbar title)
		if (showTodShade || showCtrlShade) {
			let lx = 0;
			const ly = -22;
			const cohortG = legendG.append('g').attr('class', 'map-cohort-legend');
			if (showTodShade) {
				cohortG
					.append('rect')
					.attr('x', lx)
					.attr('y', ly)
					.attr('width', 12)
					.attr('height', 12)
					.attr('rx', 2)
					.attr('fill', MAP_TOD_COHORT_HEX)
					.attr('stroke', 'var(--border)')
					.attr('stroke-width', 0.5);
				cohortG
					.append('text')
					.attr('x', lx + 16)
					.attr('y', ly + 10)
					.attr('fill', 'var(--text-muted)')
					.attr('font-size', '10px')
					.text('TOD tint');
				lx += 78;
			}
			if (showCtrlShade) {
				cohortG
					.append('rect')
					.attr('x', lx)
					.attr('y', ly)
					.attr('width', 12)
					.attr('height', 12)
					.attr('rx', 2)
					.attr('fill', MAP_CTRL_COHORT_HEX)
					.attr('stroke', 'var(--border)')
					.attr('stroke-width', 0.5);
				cohortG
					.append('text')
					.attr('x', lx + 16)
					.attr('y', ly + 10)
					.attr('fill', 'var(--text-muted)')
					.attr('font-size', '10px')
					.text('Control tint');
			}
		}

		containerEl.__mapLookup = lookup;
		containerEl.__mapFilteredSet = filteredSet;
		containerEl.__mapYLabel = yLabel;
		containerEl.__mapYKey = yKey;
	}

	/** Update development dots on the map based on showDevelopments toggle + dev filters. */
	function updateDevelopments() {
		if (!containerEl || !svgRef || !projectionRef) return;

		const devLayer = d3.select(containerEl).select('.dev-dots-layer');
		devLayer.selectAll('*').remove();

		if (!panelState.showDevelopments) return;

		const { filteredDevs } = buildFilteredData(tractData, developments, panelState);
		const projection = projectionRef;

		const currentK = d3.zoomTransform(svgRef.node()).k;
		const invK = 1 / currentK;

		devLayer.selectAll('circle.dev-dot')
			.data(filteredDevs, (d, i) => `${d.gisjoin}-${d.lat}-${d.lon}-${i}`)
			.join('circle')
			.attr('class', 'dev-dot')
			.attr('cx', (d) => projection([d.lon, d.lat])?.[0] ?? -9999)
			.attr('cy', (d) => projection([d.lon, d.lat])?.[1] ?? -9999)
			.attr('r', 2.5 * invK)
			.attr('fill', (d) => d.mixed_use ? '#f472b6' : '#22d3ee')
			.attr('fill-opacity', 0.85)
			.attr('stroke', '#333')
			.attr('stroke-width', 0.3 * invK)
			.style('cursor', 'pointer')
			.on('mouseenter', handleDevEnter)
			.on('mousemove', handleMouseMove)
			.on('mouseleave', handleOverlayLeave);
	}

	/** Toggle visibility of MBTA lines and stops based on overlay state. */
	function updateOverlays() {
		if (!containerEl || !svgRef) return;

		const lineVis = { rail: panelState.showRailLines, commuter_rail: panelState.showCommuterRailLines, bus: panelState.showBusLines };
		const stopVis = { rail: panelState.showRailStops, commuter_rail: panelState.showCommuterRailStops, bus: panelState.showBusStops };

		d3.select(containerEl).selectAll('path.mbta-line')
			.attr('display', (d) => {
				const mode = lineMode(d.properties?.route_type);
				return lineVis[mode] ? null : 'none';
			});

		d3.select(containerEl).selectAll('circle.mbta-stop')
			.attr('display', (d) => {
				const modes = d.modes ?? [];
				const visible = modes.some((m) => stopVis[m]);
				return visible ? null : 'none';
			});
	}

	function updateSelection() {
		if (!containerEl) return;
		const hoveredId = panelState.hoveredTract;
		const selectedSet = panelState.selectedTracts;
		d3.select(containerEl).selectAll('path.tract-poly')
			.attr('stroke', (d) => {
				const id = d.properties?.gisjoin;
				if (id === hoveredId) return '#ffffff';
				if (selectedSet.has(id)) return 'var(--cat-a)';
				return 'var(--border)';
			})
			.attr('stroke-width', (d) => {
				const id = d.properties?.gisjoin;
				if (id === hoveredId) return 1.5;
				if (selectedSet.has(id)) return 1.5;
				return 0.5;
			});
	}

	// ── Event handlers ──

	function handleTractEnter(event, d) {
		const id = d.properties?.gisjoin;
		panelState.setHovered(id);
		const el = containerEl;
		if (!el) return;
		const lookup = el.__mapLookup;
		const yLabel = el.__mapYLabel;
		const v = lookup?.get(id);
		const fmt = d3.format('.2f');
		const fmtInt = d3.format(',.0f');
		const tractLookup = buildTractLookup();
		const t = tractLookup.get(id);
		const county = t?.county;
		const title = county && String(county) !== 'County Name' ? String(county) : String(id);

		const lines = [{ bold: true, text: title }];

		if (t) {
			const tp = panelState.timePeriod;
			const { startY, endY } = periodCensusBounds(tp);

			if (yLabel && lookup) {
				lines.push({ bold: false, text: `${yLabel}: ${Number.isFinite(v) ? fmt(v) : '\u2014'}` });
			}

			const pop = t[`pop_${startY}`];
			if (pop != null) lines.push({ bold: false, text: `Pop (${startY}): ${fmtInt(pop)}` });
			const hu = t[`total_hu_${startY}`];
			if (hu != null) lines.push({ bold: false, text: `Housing units (${startY}): ${fmtInt(hu)}` });
			const huEnd = t[`total_hu_${endY}`];
			if (hu != null && huEnd != null) {
				const diff = huEnd - hu;
				const sign = diff >= 0 ? '+' : '';
				lines.push({ bold: false, text: `HU change (census): ${sign}${fmtInt(diff)}` });
			}
			const densityDisp = tractStopsDensityForDisplay(t);
			if (densityDisp !== null) {
				lines.push({ bold: false, text: `Transit stops/mi\u00b2: ${fmt(densityDisp)}` });
			}
			const stopsRaw = Number(t.transit_stops) || 0;
			lines.push({ bold: false, text: `Stops in buffer: ${stopsRaw}` });
			const minPct = t[`minority_pct_${startY}`];
			if (minPct != null) lines.push({ bold: false, text: `Minority %: ${fmt(minPct)}%` });
		} else {
			lines.push({ bold: false, text: 'No census data for this tract' });
		}

		tooltip = { visible: true, x: event.clientX, y: event.clientY, lines };
	}

	function handleMouseMove(event) {
		tooltip = { ...tooltip, x: event.clientX, y: event.clientY };
	}

	function handleTractLeave() {
		panelState.setHovered(null);
		tooltip = { ...tooltip, visible: false };
	}

	function handleTractClick(event, d) {
		event.stopPropagation();
		const id = d.properties?.gisjoin;
		if (id) panelState.toggleTract(id);
	}

	function handleStopEnter(event, d) {
		const routes = d.routes?.join(', ') || 'Unknown';
		const modes = (d.modes ?? []).map((m) => transitModeUiLabel(m)).join(', ') || 'Unknown';
		tooltip = {
			visible: true, x: event.clientX, y: event.clientY,
			lines: [
				{ bold: true, text: d.name || 'MBTA Stop' },
				{ bold: false, text: `Routes: ${routes}` },
				{ bold: false, text: `Mode: ${modes}` }
			]
		};
	}

	function handleLineEnter(event, d) {
		const props = d.properties ?? {};
		const name = props.route_long_name || props.route_short_name || props.route_id || 'MBTA Route';
		tooltip = {
			visible: true, x: event.clientX, y: event.clientY,
			lines: [
				{ bold: true, text: name },
				{ bold: false, text: `Route: ${props.route_short_name || props.route_id || ''}` }
			]
		};
	}

	function handleDevEnter(event, d) {
		const lines = [{ bold: true, text: d.name || 'Development' }];
		lines.push({ bold: false, text: `${d.municipal}` });
		lines.push({ bold: false, text: `Units: ${d.hu}` });
		const affCap = developmentAffordableUnitsCapped(d);
		if (affCap > 0) {
			const src = d.affrd_source === 'lihtc' ? ' (HUD LIHTC)' : '';
			lines.push({ bold: false, text: `Affordable: ${affCap}${src}` });
		}
		lines.push({ bold: false, text: d.mixed_use ? 'Mixed-use' : 'Residential' });
		if (d.rdv) lines.push({ bold: false, text: 'Redevelopment' });
		tooltip = { visible: true, x: event.clientX, y: event.clientY, lines };
	}

	function handleOverlayLeave() {
		tooltip = { ...tooltip, visible: false };
	}

	// ── Effects ──

	const overlayKey = $derived(
		JSON.stringify({
			busL: panelState.showBusLines,
			railL: panelState.showRailLines,
			crL: panelState.showCommuterRailLines,
			busS: panelState.showBusStops,
			railS: panelState.showRailStops,
			crS: panelState.showCommuterRailStops
		})
	);

	$effect(() => {
		void structuralKey;
		if (!containerEl) return;
		if (structuralKey !== lastStructuralKey) {
			lastStructuralKey = structuralKey;
			rebuildSVG();
			updateChoropleth();
			updateDevelopments();
			updateOverlays();
			updateSelection();
		}
	});

	$effect(() => {
		void dataKey;
		if (!containerEl || !svgRef) return;
		updateChoropleth();
		updateDevelopments();
		updateSelection();
	});

	$effect(() => {
		void panelState.showDevelopments;
		if (!containerEl || !svgRef) return;
		updateDevelopments();
	});

	$effect(() => {
		void overlayKey;
		if (!containerEl || !svgRef) return;
		updateOverlays();
	});

	$effect(() => {
		void panelState.hoveredTract;
		void panelState.selectedTracts;
		void panelState.selectedTracts.size;
		if (!containerEl || !svgRef) return;
		updateSelection();
	});

	onDestroy(() => {
		if (containerEl) d3.select(containerEl).selectAll('*').remove();
		lastStructuralKey = '';
		svgRef = null;
		projectionRef = null;
	});
</script>

<div class="map-wrap">
	<div class="map-root" bind:this={containerEl}></div>
	{#if tooltip.visible}
		<div
			class="map-tooltip"
			style:left="{tooltip.x + 12}px"
			style:top="{tooltip.y + 12}px"
		>
			{#each tooltip.lines as line, i (i)}
				<p class:tooltip-bold={line.bold}>{line.text}</p>
			{/each}
		</div>
	{/if}
</div>

<style>
	.map-wrap {
		position: relative;
		width: 100%;
		background: transparent;
	}
	.map-root {
		width: 100%;
		min-height: 200px;
	}
	:global(.map-empty) {
		margin: 0;
		padding: 16px;
		font-size: 0.875rem;
		color: var(--text-muted);
	}
	.map-tooltip {
		position: fixed;
		z-index: 20;
		max-width: 320px;
		padding: 8px 10px;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--text);
		pointer-events: none;
		background: color-mix(in srgb, var(--bg, #111) 92%, transparent);
		border: 1px solid var(--border);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgb(0 0 0 / 35%);
	}
	.map-tooltip p {
		margin: 0;
	}
	.map-tooltip p + p {
		margin-top: 3px;
	}
	.tooltip-bold {
		font-weight: 600;
		color: var(--text);
	}
</style>
