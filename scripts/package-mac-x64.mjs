#!/usr/bin/env node
// Builds a macOS x64 DMG/ZIP from an Apple Silicon Mac. A normal
// electron-builder run would copy the host's arm64 sharp binaries into the
// x64 app; this script prepares a temporary x64 dependency tree and the
// matching better-sqlite3 Electron ABI before packaging.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const root = process.cwd(),
  temp = await fsp.mkdtemp(path.join(os.tmpdir(), "imago-mac-x64-"));
const require = createRequire(import.meta.url);
const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} terminó con código ${code}`)),
    );
  });
const copy = (from, to) =>
  fsp.cp(from, to, {
    recursive: true,
    force: true,
    filter: (source) => {
      const relative = path.relative(root, source);
      if (!relative) return true;
      const top = relative.split(path.sep)[0];
      if (
        [
          "node_modules",
          ".git",
          ".venv",
          "release",
          "test-results",
          "dist",
          "dist-electron",
        ].includes(top)
      )
        return false;
      return path.basename(source) !== ".DS_Store";
    },
  });

try {
  if (process.platform !== "darwin")
    throw new Error("Este empaquetado solo se puede ejecutar en macOS.");
  for (const directory of ["dist", "dist-electron"])
    if (!fs.existsSync(path.join(root, directory)))
      throw new Error(`Falta ${directory}/. Ejecuta npm run build antes.`);
  if (!fs.existsSync(path.join(root, "package-lock.json")))
    throw new Error("Falta package-lock.json.");

  await copy(root, temp);
  await fsp.cp(path.join(root, "dist"), path.join(temp, "dist"), {
    recursive: true,
    force: true,
  });
  await fsp.cp(
    path.join(root, "dist-electron"),
    path.join(temp, "dist-electron"),
    { recursive: true, force: true },
  );

  console.log("→ Instalando dependencias macOS x64 en un directorio temporal…");
  await run(
    "npm",
    ["ci", "--ignore-scripts", "--os=darwin", "--cpu=x64"],
    temp,
  );

  const electronVersion = require(
      path.join(root, "node_modules/electron/package.json"),
    ).version,
    sqliteVersion = require(
      path.join(temp, "node_modules/better-sqlite3/package.json"),
    ).version,
    abi = require("node-abi").getAbi(electronVersion, "electron"),
    archive = path.join(temp, "better-sqlite3-x64.tar.gz"),
    url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${sqliteVersion}/better-sqlite3-v${sqliteVersion}-electron-v${abi}-darwin-x64.tar.gz`;
  console.log(
    `→ Descargando better-sqlite3 ${sqliteVersion} para Electron ABI ${abi}…`,
  );
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `No se pudo descargar el binario x64 de better-sqlite3 (${response.status}).`,
    );
  await fsp.writeFile(archive, Buffer.from(await response.arrayBuffer()));
  await fsp.mkdir(
    path.join(temp, "node_modules/better-sqlite3/build/Release"),
    { recursive: true },
  );
  await run(
    "tar",
    ["-xzf", archive, "-C", path.join(temp, "node_modules/better-sqlite3")],
    temp,
  );

  const base = require(path.join(root, "build/electron-builder.cjs")),
    config = {
      ...base,
      mac: {
        ...base.mac,
        target: [
          { target: "dmg", arch: ["x64"] },
          { target: "zip", arch: ["x64"] },
        ],
      },
    },
    configPath = path.join(temp, "electron-builder-x64.cjs");
  await fsp.writeFile(
    configPath,
    `module.exports = ${JSON.stringify(config)};\n`,
  );

  console.log("→ Empaquetando macOS x64…");
  await run(
    "npx",
    ["electron-builder", "--config", configPath, "--config.npmRebuild=false"],
    temp,
  );

  await fsp.mkdir(path.join(root, "release"), { recursive: true });
  await fsp.cp(path.join(temp, "release/mac"), path.join(root, "release/mac"), {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });
  for (const file of [
    "Nodus-Imago-0.1.0-x64.dmg",
    "Nodus-Imago-0.1.0-x64.zip",
  ]) {
    const source = path.join(temp, "release", file);
    if (!fs.existsSync(source))
      throw new Error(`electron-builder no generó ${file}.`);
    await fsp.copyFile(source, path.join(root, "release", file));
    if (fs.existsSync(source + ".blockmap"))
      await fsp.copyFile(
        source + ".blockmap",
        path.join(root, "release", file + ".blockmap"),
      );
    console.log(`✓ release/${file}`);
  }
} finally {
  await fsp.rm(temp, { recursive: true, force: true });
}
