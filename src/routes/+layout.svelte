<script>
	import '../app.css';
	import NavBar from '$lib/components/NavBar.svelte';
	import { loadAllData } from '$lib/stores/data.svelte.js';
	import { onMount } from 'svelte';

	let { children } = $props();
	let loading = $state(true);
	let error = $state(null);

	onMount(async () => {
		try {
			await loadAllData();
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	});
</script>

<NavBar />

<main>
	{#if loading}
		<div class="loading-screen">
			<div class="spinner"></div>
			<p>Loading dashboard data...</p>
		</div>
	{:else if error}
		<div class="error-screen">
			<h2>Failed to load data</h2>
			<p>{error}</p>
		</div>
	{:else}
		{@render children()}
	{/if}
</main>

<style>
	main {
		min-height: calc(100vh - 56px);
	}
	.loading-screen, .error-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		gap: 16px;
	}
	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.error-screen h2 { color: var(--danger); }
</style>
