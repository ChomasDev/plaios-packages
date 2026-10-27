let application = null;

async function boot() {
  if (import.meta.env.AGENT_OS_EMBEDDED) {
    const { installMapboxAgentApp } = await import('./mapboxAgentApp.js');
    installMapboxAgentApp({
      accessToken: import.meta.env.MAPBOX_ACCESS_TOKEN,
      mapboxStyle: import.meta.env.MAPBOX_STYLE,
    });
    return;
  }
  const [{ createStandaloneApplication }, { describeError }] =
    await Promise.all([
      import('./standalone/application.js'),
      import('./standalone/errors.js'),
    ]);
  application = createStandaloneApplication({
    googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
    mapboxAccessToken: import.meta.env.MAPBOX_ACCESS_TOKEN,
    mapboxStyle: import.meta.env.MAPBOX_STYLE,
    allowQaRegistration: import.meta.env.DEV,
  });
  application.start().catch((error) => {
    console.error("God's Eye View initialization failed:", error);
    const loaderStatus = document.querySelector(
      '#loading-screen .loader-status',
    );
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  });
}

void boot();

export { application };
