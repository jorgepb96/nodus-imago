// Intercept inside the actual Electron session, including AppImage's launcher.
// CDP context routing is not reliable through that wrapper. No public OSM traffic.
export async function installMapTiles(app, tile) {
  await app.evaluate(
    async ({ session }, bytes) => {
      const state = { requests: [], failing: false };
      global.__imagoTileFixture = state;
      await session.defaultSession.clearCache();
      session.defaultSession.protocol.handle("https", (request) => {
        if (
          !/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(
            request.url,
          )
        )
          throw Error("Unexpected HTTPS request in isolated map test");
        state.requests.push(request.url);
        return new Response(state.failing ? null : Buffer.from(bytes), {
          status: state.failing ? 503 : 200,
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        });
      });
    },
    [...tile],
  );
  return {
    requests: () => app.evaluate(() => global.__imagoTileFixture.requests),
    fail: (value) =>
      app.evaluate((_, failing) => {
        global.__imagoTileFixture.failing = failing;
      }, value),
  };
}
