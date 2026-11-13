// Package-native architecture suffixes, checked against the actual five-target CI artifacts.
export function updateArtifactArchitecture(platform, arch, extension) {
  if (platform === "linux") {
    if (arch === "x64" && extension === "deb") return "amd64";
    if (arch === "x64" && ["AppImage", "rpm"].includes(extension))
      return "x86_64";
    if (arch === "arm64" && extension === "rpm") return "aarch64";
  }
  return arch;
}
