// Only a future, explicitly requested signed release uses this configuration.
const base = require('./electron-builder.cjs');
const channel = process.env.IMAGO_RELEASE_CHANNEL;
if (!['latest', 'beta'].includes(channel)) throw Error('Set IMAGO_RELEASE_CHANNEL to latest or beta.');
const mac = { ...base.mac };
delete mac.identity;
module.exports = {
  ...base,
  // macOS is always signed and notarized; Windows only when a certificate is
  // configured (WIN_CSC_LINK), as in Nodus Research.
  forceCodeSigning: process.platform === 'darwin' || (process.platform === 'win32' && !!process.env.WIN_CSC_LINK),
  mac: { ...mac, hardenedRuntime: true, strictVerify: true,
    entitlements: 'build/entitlements.mac.plist', entitlementsInherit: 'build/entitlements.mac.plist', notarize: true },
  publish: { ...base.publish, channel, releaseType: 'draft' },
};
