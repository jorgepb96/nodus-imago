// Adapted from Nodus desktop targets; independent identifiers and resources.
module.exports = {
  appId: "app.nodus.imago",
  productName: "Nodus Imago",
  icon: "build/icon.png",
  artifactName: "Nodus-Imago-${version}-${arch}.${ext}",
  directories: { output: "release" },
  files: ["dist/**/*", "dist-electron/**/*", "package.json"],
  asarUnpack: ["**/*.node", "**/sharp/**/*", "**/@img/**/*"],
  extraResources: [
    { from: "runtime", to: "runtime", filter: ["*.py", "*.txt"] },
    { from: "LICENSE", to: "legal/LICENSE" },
    { from: "THIRD_PARTY_NOTICES.md", to: "legal/THIRD_PARTY_NOTICES.md" },
    { from: "PRIVACY.md", to: "legal/PRIVACY.md" },
    { from: "SOURCE_CODE.md", to: "legal/SOURCE_CODE.md" },
    { from: "legal", to: "legal/dependencies" },
  ],
  mac: {
    category: "public.app-category.education",
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
  },
  win: { target: [{ target: "nsis", arch: ["x64"] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  linux: {
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
