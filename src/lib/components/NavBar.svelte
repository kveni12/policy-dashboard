<script>
	import { base } from '$app/paths';
	import { page } from '$app/state';

	// Use route id so active states work when kit.paths.base is set (e.g. GitHub Pages).
	const onDashboard = $derived(page.route.id === '/');
	const onPolicy = $derived(page.route.id === '/policy');
</script>

<nav class="navbar" aria-label="Primary">
	<a class="brand" href="{base}/">TOD Demographics Dashboard</a>
	<ul class="links">
		<li><a href="{base}/" class:active={onDashboard}>Dashboard</a></li>
		<li><a href="{base}/policy" class:active={onPolicy}>Policy Insights</a></li>
	</ul>
</nav>

<style>
	.navbar {
		position: sticky;
		top: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 56px;
		padding: 0 20px;
		background: var(--bg-panel);
		border-bottom: 1px solid var(--border);
		box-shadow: var(--shadow);
	}

	.brand {
		font-weight: 600;
		font-size: 1rem;
		color: var(--text);
		letter-spacing: -0.02em;
	}

	.brand:hover {
		color: var(--accent-hover);
	}

	.links {
		display: flex;
		align-items: center;
		gap: 8px;
		list-style: none;
	}

	.links a {
		display: inline-block;
		padding: 8px 14px;
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-size: 0.9375rem;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.links a:hover {
		color: var(--text);
		background: var(--bg-hover);
	}

	.links a.active {
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}
</style>
