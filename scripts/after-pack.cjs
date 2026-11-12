// Version the macOS resource name as well as the persisted Dock icon. Reusing
// icon.icns with the same bundle/version can leave LaunchServices showing the
// previous artwork even though the new icon is correctly embedded.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const bundle = path.join(
      context.appOutDir,
      context.packager.appInfo.productFilename + ".app",
    ),
    resources = path.join(bundle, "Contents", "Resources"),
    name = "nodus-imago-camera-lens-v5.icns";
  await fs.copyFile(
    path.join(resources, "icon.icns"),
    path.join(resources, name),
  );
  await promisify(execFile)("/usr/libexec/PlistBuddy", [
    "-c",
    "Set :CFBundleIconFile " + name,
    path.join(bundle, "Contents", "Info.plist"),
  ]);
};
