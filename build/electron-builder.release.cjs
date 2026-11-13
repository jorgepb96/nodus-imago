// Only a future, explicitly requested signed release uses this configuration.
const base = require('./electron-builder.cjs');
const channel = process.env.IMAGO_RELEASE_CHANNEL;
if (!['latest', 'beta'].includes(channel)) throw Error('Set IMAGO_RELEASE_CHANNEL to latest or beta.');
const mac = { ...base.mac };
delete mac.identity;
module.exports = {
  ...base,
  forceCodeSigning: process.platform !== 'linux',
  mac: { ...mac, hardenedRuntime: true, strictVerify: true,
    entitlements: 'build/entitlements.mac.plist', entitlementsInherit: 'build/entitlements.mac.plist', notarize: true },
  publish: { ...base.publish, channel, releaseType: 'draft' },
};
