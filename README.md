<p align="center">
  <img src="build/icon-mark.svg" width="112" alt="Nodus Imago camera lens and N logo">
</p>

<h1 align="center">Nodus Imago</h1>
<p align="center"><strong>Research through images.</strong></p>
<p align="center">
  <a href="https://github.com/jorgepb96/nodus-imago/actions/workflows/ci.yml"><img src="https://github.com/jorgepb96/nodus-imago/actions/workflows/ci.yml/badge.svg" alt="Desktop validation"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-6d28d9" alt="License: AGPL-3.0-only"></a>
  <a href="https://github.com/jorgepb96/nodus"><img src="https://img.shields.io/badge/part_of_the-Nodus_family-4f46e5" alt="Part of the Nodus family"></a>
</p>

Nodus Imago is an open-source desktop application for researchers working with visual sources. It brings images, catalogue records and research notes into one workspace, so you can build a photographic corpus and study its contents while keeping each interpretation connected to the source.

Designed for history, art history, archival research and related fields, Imago supports the work that follows collection: describing what an image shows, assigning categories, comparing interpretations and reviewing the results. It is a standalone sister app to [Nodus Research](https://github.com/jorgepb96/nodus) and shares its familiar interface, settings and themes, although you do not need Nodus installed to use it.

Your collection and search indexes stay on your computer, and you can begin without creating an account or configuring a server. If you want AI assistance, the main local workflow runs without Python. Online providers are also available, but they are only used when you enable them and queue work with a remote model.

![Nodus Imago in English and light mode, showing a gallery of historical photographs from the Biblioteca Nacional de España](docs/screenshots/readme-gallery.png)

## Get started

Imago is currently in development at version **0.1.0**. You can find test installers and their validation reports in [GitHub Actions](https://github.com/jorgepb96/nodus-imago/actions/workflows/ci.yml), using the formats listed below. These builds are intended for testing; a signed public release has not yet been published.

| Platform | Test installer formats |
| --- | --- |
| macOS · Apple silicon | DMG, ZIP |
| macOS · Intel | DMG, ZIP |
| Windows 10/11 · x64 | NSIS installer |
| Linux · x64 or ARM64 | AppImage, DEB, RPM |

You can also [run Imago from source](#development). A project can begin with an empty database or with material you already have in a CSV, TSV, Notion export or compatible Nodus database. Once you have added images and chosen the properties you need, you can start cataloguing and searching straight away, without downloading an AI model.

## Build a visual research corpus

Each database offers **Table, Gallery and Map** views of the same records, allowing you to move between detailed cataloguing, visual comparison and geographical exploration. Its properties can hold dates, controlled vocabularies, multiple tags and locations, while relations, formulas and rollups help connect and summarise your material. Filters and sorting work across the views, and you can save useful criteria to return to a particular part of the corpus as your research develops.

Images can be imported from files or folders, or dragged into an open database. If you already have catalogue records, Imago can match images to them by filename or reference. You decide whether to keep a managed copy or link to an existing original; the app then extracts EXIF metadata, generates previews and checks file hashes for duplicates. Supported formats include JPEG, PNG, WebP, TIFF, BMP, HEIC and HEIF.

![A research table with photographs, photographers, dates, thematic categories, visual notes and source links](docs/screenshots/readme-table.png)

Opening a record brings its images, properties and notes together in a side panel. You can attach several images to the same record, write commentary in the visual rich-text editor and retain links to the source catalogue, so that your observations remain connected to the material they describe.

![A historical photograph and its catalogue properties in the record panel](docs/screenshots/readme-record.png)

When a record has a location, you can choose an offline place suggestion, enter your own name or supply coordinates. The map groups nearby records and lets you open their images from a marker. Place names and coordinates remain available offline, while the OpenStreetMap background requires a connection or previously cached tiles.

Search works across one or several databases using words, phrases and filters. Installing a local embedding model also lets you search by meaning, find images similar to a reference image or combine text and visual queries. The semantic index stays on your computer, and keyword search remains available whether or not you use models.

## Describe, classify and review

AI assistance is organised around your database properties. You can request descriptions or thematic classifications for a selection of records or an entire column, with a model and instructions chosen for each property. This makes it possible, for example, to generate a description in one column and compare how several models classify the same images in others, using the vocabulary defined for your study.

Several queues can run within the resource limits you configure, and their progress is available from the header, where you can pause, resume or cancel work. Generated descriptions and labels become proposals for you to review individually or in batches. Imago records the model and instructions behind each proposal, keeping a trace of how it was produced before you decide whether to accept it.

For recurring work, you can enable automations that assign values, copy properties or queue AI analysis when records change or on a schedule. An execution history lets you check what ran and what happened.

## Compare models and human judgments

The **Agreement** workspace helps you examine how consistently your material has been classified. It compares columns with one another and, if you provide one, with an independent human reference. You can see how often all models agree, compare individual pairs and examine agreement with the researcher, then return to the records where their judgments differ.

The analysis includes Cohen’s kappa, Fleiss’ kappa, nominal Krippendorff’s alpha and multilabel comparisons. You can choose how missing judgments are handled and inspect the number of records behind each result, including category-level differences. Saving an experiment preserves a snapshot of its data and settings, which you can export as CSV or JSON; later edits to the database do not rewrite that saved result.

![The Agreement workspace comparing three demonstration raters with a reference classification](docs/screenshots/readme-agreement.png)

*The screenshot uses illustrative labels entered for the demo. Its figures are not an evaluation of any AI model or a research finding.*

## Choose local AI or your own provider

| Purpose | Local model |
| --- | --- |
| Image descriptions and classification | LFM3-VL-2B through llama.cpp |
| Text and image embeddings | EmbeddingGemma 2 through Transformers.js / ONNX Runtime |
| Embeddings on Intel Macs | Harrier OSS v1 0.6B through llama.cpp; images are searched through local LFM3 descriptions |

Model weights are **downloaded on demand** rather than bundled with the installer. Before a download begins, the model manager shows where the files come from, their license, size and destination, and checks that there is enough disk space. Downloads can be cancelled and resumed, and the files are verified using SHA-256 before use. The main local workflow does not require Python.

If you prefer another model, you can configure OpenRouter, Google Gemini or another supported provider, or connect Ollama, LM Studio or an OpenAI-compatible endpoint. Remote APIs remain disabled until you enable them. Provider keys are kept in the operating system’s encrypted storage, separately from any credentials you use in Nodus Research.

![English provider settings in light mode, with remote APIs disabled](docs/screenshots/readme-settings.png)

## Preserve and move your work

You can export tables as CSV, JSON or XLSX to continue working with them elsewhere. For a fuller copy of your collection, native `.imago` backups preserve the database structure, available originals, relations, annotations, proposals, history and search vectors. Backup settings let you choose a folder and schedule, while encrypted copies and integrity checks help protect the archive. After a restoration, automation rules and remote AI stay disabled until you choose to enable them again.

If you are moving existing work into Imago, Notion imports preserve exported Markdown pages and their nested block structure alongside tables and images. Nodus imports work from a consistent copy and leave the original database unchanged. In both cases, what can be recovered depends on the information present in the source export.

## Development

To work on Imago locally, you will need **Node.js 22.12 or later** and npm. If a prebuilt SQLite module is unavailable for your platform, you may also need its native build tools. Install the dependencies and start the development application with:

```sh
npm ci
npm run dev
```

To build and run the compiled application:

```sh
npm run build
npm start
```

Imago is built with Electron, React, TypeScript and SQLite. Dependency installation prepares the native modules for Electron’s ABI. The following commands cover the main validation workflows:

```sh
npm run verify             # Typecheck, lint, unit tests and build
npm run test:desktop:all   # Desktop flows; requires a graphical session
npm run test:native-ai:e2e # Real local AI; see the test setup below
```

The [CI workflow](.github/workflows/ci.yml) tests both the source and packaged applications, including real CPU inference, on all five platform and architecture targets. Tests with real models require an isolated profile and explicitly downloaded dependencies; the workflow documents how that environment is prepared. To build installers, run the appropriate command on the target system:

```sh
npm run dist:mac       # macOS Apple silicon: DMG and ZIP
npm run dist:mac:x64   # macOS Intel: DMG and ZIP
npm run dist:win       # Windows x64: NSIS
npm run dist:linux     # Linux native architecture: AppImage, DEB and RPM
```

The [verification record](docs/VERIFICATION.md) describes what has been tested and the remaining limits. RPM executables have been extracted and tested on Ubuntu, but native installation on an RPM distribution and installation between signed releases have not yet been verified. Some historical engineering reports are currently in Spanish.

## Contribute and report issues

If you encounter a problem or have a research workflow you would like Imago to support, you can [open an issue](https://github.com/jorgepb96/nodus-imago/issues). For a bug report, please include your app version and platform, the steps that reproduce the problem and what you expected to happen. A small anonymised example is helpful; private research material and API credentials should be kept out of reports.

## Image credits

**Images taken from the holdings of the Biblioteca Nacional de España.** The historical photographs shown here come from the Biblioteca Digital Hispánica and were retrieved through Wikimedia Commons. Their [individual sources, rights and screenshot notes](docs/screenshots/README.md) are documented separately. English display titles and research annotations were prepared for the demonstration. The BNE does not sponsor or endorse Nodus Imago.

## License

Nodus Imago is © Jorge Pérez Burgueño and licensed under [AGPL-3.0-only](LICENSE). Adapted Nodus components retain their attribution; see [reuse notes](docs/REUSE.md) and [third-party notices](THIRD_PARTY_NOTICES.md). Dependencies, photographs and optional models retain their own licenses. LFM3 uses the [LFM Open License 1.0](legal/LFM-Open-License-1.0.txt); model weights are not bundled with the app.
