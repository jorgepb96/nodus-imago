// Adapted from Nodus desktop targets; independent identifiers and resources.
module.exports = {
  appId: "app.nodus.imago",
  buildDependenciesFromSource: process.platform === "linux",
  productName: "Nodus Imago",
  icon: "build/icon.png",
  artifactName: "Nodus-Imago-${version}-${arch}.${ext}",
  directories: { output: "release" },
  files: ["dist/**/*", "dist-electron/**/*", "electron/assets/gazetteer/**/*", "package.json"],
  asarUnpack: ["**/*.node", "**/sharp/**/*", "**/@img/**/*", "**/onnxruntime-node/**/*"],
  afterPack: "scripts/after-pack.cjs",
  extraResources: [
    { from: "build/icon.png", to: "icons/icon.png" },
    { from: "build/icon-dark.png", to: "icons/icon-dark.png" },
    { from: "runtime", to: "runtime", filter: ["*.py", "*.txt"] },
    { from: "LICENSE", to: "legal/LICENSE" },
    { from: "THIRD_PARTY_NOTICES.md", to: "legal/THIRD_PARTY_NOTICES.md" },
    { from: "PRIVACY.md", to: "legal/PRIVACY.md" },
    { from: "SOURCE_CODE.md", to: "legal/SOURCE_CODE.md" },
    { from: "legal", to: "legal/dependencies" },
  ],
  mac: {
    // Development build: signing/notarization are deliberately out of scope.
    // Disable signing entirely: this is a development build, and an accidental
    // partial Developer ID signature would be worse than an unsigned artifact.
    identity: null,
    category: "public.app-category.education",
    target: ["dmg", "zip"],
  },
  win: { target: [{ target: "nsis", arch: ["x64"] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
  linux: {
    syncDesktopName: true,
    category: "Education",
    target: ["AppImage", "deb", "rpm"],
    maintainer: "Jorge Pérez Burgueño",
  },
  publish: {
    provider: "github",
    owner: "jorgepb96",
    repo: "nodus-imago",
    releaseType: "draft",
  },
};
