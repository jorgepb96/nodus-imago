// Full-screen image viewer with zoom and annotations. With «Anotar» on,
// dragging over the image marks a region; each region keeps a note and tags,
// is listed beside the image with its crop, and is part of the record's text,
// so the literal and semantic searches find it.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Crosshair,
  Landmark,
  Layers,
  ChevronRight,
  Crop as CropIcon,
  ImageOff,
  Maximize,
  MessageSquare,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  ScanSearch,
  StickyNote,
  Square,
  SquareDashedMousePointer,
  Tag,
  Tags,
  Undo2,
  Redo2,
  SlidersHorizontal,
  Microscope,
  Eye,
  EyeOff,
  CheckCheck,
  Trash2,
  X,
} from "lucide-react";
import { OptionPicker } from "./Cell";
import { CriteriaPopover } from "./CriteriaSelect";
import { OptionIcon } from "./DatabaseIcon";
import type { ModelChoice } from "../../shared/aiConfig";
import { DEFAULT_OPTION_COLOR } from "./OptionEditMenu";
import { optionIconValue } from "../../shared/databaseIcons";
import { importedOptionColor } from "../../shared/databaseCsv";
import type { VisualTagChoice, VisualTagRegion } from "../../shared/visualTags";
import { useBrowse, ViewerStrip, type BrowseItem, type BrowseList } from "./ViewerStrip";
import type { Commands, ImageAnnotation, ImageAsset, RecordRow } from "../../shared/imago";
import type { WorkshopOp } from "../../shared/workshop";
import { useT } from "../i18n";
import { DetailSearchPanel, type DetailQuery } from "./DetailSearchPanel";
import { Button, Spinner } from "./ui";
import { MIN_CROP, validCrop, type Region } from "../../shared/imageRotation";
import { decodeMultiSelect, type DatabaseColumn } from "../../shared/databases";
import { heritageDictionaryOptions, heritageScheme, isHeritageColumn, isHeritageDictionarySource, typology } from "../../shared/heritage";
import { useHeritage } from "../heritageStore";
import { HeritageIcon } from "./HeritageIcon";
import { HeritageMarksPanel, type MarkDraft } from "./HeritageMarksPanel";
import { HeritageSuggestPanel } from "./HeritageSuggestPanel";
import { HeritagePropagatePanel } from "./HeritagePropagatePanel";
import { VisualTagSuggestions } from "./VisualTagSuggestions";
import { useVisionModels } from "./VisionModelPicker";

type View = { scale: number; x: number; y: number };
type Draft = { id?: string; x: number; y: number; w: number; h: number; note: string; tags: string[] };
type TagDraft = Region & { id?: string; choices: VisualTagChoice[] };
type TagAppearance = { key: string; label: string; color: string; icon: string | null };
type TagPreview = { draft: TagDraft; tags: TagAppearance[] };
const VIEWER_SIDE_TABS = [
  { id: "annotations", label: "Anotaciones", icon: StickyNote },
  { id: "tags", label: "Etiquetas", icon: Tags },
  { id: "heritage", label: "Patrimonio", icon: Landmark },
] as const;
type ViewerSideTab = (typeof VIEWER_SIDE_TABS)[number]["id"];
const VIEWER_TOOL_KEYS = {
  annotations: "A",
  search: "B",
  heritage: "P",
  tags: "E",
} as const;
type ViewerTool = keyof typeof VIEWER_TOOL_KEYS;
const VIEWER_SHORTCUTS = Object.keys(VIEWER_TOOL_KEYS) as ViewerTool[];

const tagChoiceKey = (choice: VisualTagChoice) => "optionId" in choice
  ? `option:${choice.optionId}`
  : `label:${choice.label.normalize("NFKC").toLowerCase()}`;

function tagBoxColors(tags: TagAppearance[]): React.CSSProperties {
  const color = tags[0]?.color ?? DEFAULT_OPTION_COLOR;
  if (tags.length < 2) return { "--tag": color } as React.CSSProperties;
  const width = 100 / tags.length;
  const stops = tags.map(({ color }, i) => `${color} ${i * width}% ${(i + 1) * width}%`);
  return { "--tag": color, "--tag-gradient": `linear-gradient(90deg, ${stops.join(", ")})` } as React.CSSProperties;
}

function TagLabels({ tags }: { tags: TagAppearance[] }) {
  return (
    <span className="viewer-tag-label">
      {tags.map(({ key, label, color, icon }) => (
        <span className="viewer-tag-label-part" key={key} style={{ background: color }}>
          <Tag size={11} aria-hidden="true" />
          <span className="viewer-tag-label-name">{label}</span>
          <OptionIcon value={icon} size={11} />
        </span>
      ))}
    </span>
  );
}
const COLORS = ["#f59e0b", "#22c55e", "#3b82f6", "#ec4899", "#8b5cf6", "#ef4444"];
const src = (id: string, revision?: string, variant: "thumb" | "preview" | "full" = "preview") =>
  `imago://asset/${id}/${variant}${revision ? "?v=" + encodeURIComponent(revision) : ""}`;
/** Which part of the crop frame a drag moves. */
type Grip = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "new";
const GRIPS: Grip[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
/** The crop after dragging a grip from where the drag started. */
function dragCrop(start: Region, grip: Grip, dx: number, dy: number, origin: { x: number; y: number }, minSize = MIN_CROP): Region {
  if (grip === "new") {
    const x1 = clamp01(origin.x + dx),
      y1 = clamp01(origin.y + dy);
    return {
      x: Math.min(origin.x, x1),
      y: Math.min(origin.y, y1),
      w: Math.max(minSize, Math.abs(x1 - origin.x)),
      h: Math.max(minSize, Math.abs(y1 - origin.y)),
    };
  }
  if (grip === "move")
    return {
      ...start,
      x: Math.min(1 - start.w, Math.max(0, start.x + dx)),
      y: Math.min(1 - start.h, Math.max(0, start.y + dy)),
    };
  let x0 = start.x,
    y0 = start.y,
    x1 = start.x + start.w,
    y1 = start.y + start.h;
  if (grip.includes("w")) x0 = Math.max(0, Math.min(x1 - minSize, clamp01(x0 + dx)));
  if (grip.includes("e")) x1 = Math.min(1, Math.max(x0 + minSize, clamp01(x1 + dx)));
  if (grip.includes("n")) y0 = Math.max(0, Math.min(y1 - minSize, clamp01(y0 + dy)));
  if (grip.includes("s")) y1 = Math.min(1, Math.max(y0 + minSize, clamp01(y1 + dy)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

type InspectMode = "none" | "contrast" | "clahe" | "invert" | "gray" | "edges" | "falsecolor";
const INSPECT_MODES: [InspectMode, string, string][] = [
  ["none", "Imagen normal", "La imagen tal como es."],
  ["contrast", "Más contraste", "Separa más los claros de los oscuros."],
  ["clahe", "Contraste local", "Realza el detalle en sombras y luces a la vez: ayuda a leer inscripciones y rótulos."],
  ["invert", "Negativo", "Invierte los tonos: positiva un negativo escaneado o deja ver lo que se pierde en las sombras."],
  ["gray", "Blanco y negro", "Quita el color o el tono sepia."],
  ["edges", "Bordes", "Dibuja los contornos: deja ver retoques, letras borradas o perfiles."],
  ["falsecolor", "Falso color", "Pinta cada nivel de gris de un color: distingue tonos casi iguales."],
];
const INSPECT_FILTERS: Partial<Record<InspectMode, string>> = { contrast: "contrast(1.7) brightness(1.05)", invert: "invert(1)", gray: "grayscale(1)" };
const INSPECT_OPS: Partial<Record<InspectMode, WorkshopOp[]>> = {
  clahe: [{ tool: "clahe", strength: 70 }],
  edges: [{ tool: "edges", strength: 60 }],
  falsecolor: [{ tool: "falsecolor", palette: "thermal" }],
};

export function ImageViewer({
  row,
  initialIndex = 0,
  initialCrop = false,
  onClose,
  onChanged,
  onOpenRecord,
  onCompare,
  onWorkshop,
  columns,
  browse,
  onBrowse,
}: {
  row: RecordRow;
  /** The list the record was opened from: its photographs fill the strip under the image. */
  browse?: BrowseList | null;
  /** Opens another record of that list in the viewer. */
  onBrowse?: (item: BrowseItem) => void;
  /** The database's properties: heritage ones can be marked on the image. */
  columns?: DatabaseColumn[];
  initialIndex?: number;
  /** Open straight into the crop editor. */
  initialCrop?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenRecord?: (rowId: string) => void;
  onCompare?: (assetIds: string[]) => void;
  /** Opens the image workshop with the image shown. */
  onWorkshop?: (assetId: string) => void;
}) {
  const t = useT();
  const viewerUsesCommand = /^Mac/i.test(navigator.platform);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    stage.current = element;
    setStageElement(element);
  }, []);
  const sidebar = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, row.images.length - 1)));
  // Another record of the list: its first image, or its last when coming back.
  const [rowShown, setRowShown] = useState(row.id);
  const [enterAt, setEnterAt] = useState<"start" | "end" | number>("start");
  if (rowShown !== row.id) {
    setRowShown(row.id);
    setIndex(enterAt === "end" ? Math.max(0, row.images.length - 1) : enterAt === "start" ? 0 : enterAt);
    setEnterAt("start");
  }
  const image = row.images[Math.min(index, Math.max(0, row.images.length - 1))];
  /** The strip of the list's photographs under the image, shown or hidden (remembered). */
  const [stripShown, setStripShown] = useState(() => {
    try {
      return localStorage.getItem("imago.viewerStrip") !== "0";
    } catch {
      return true;
    }
  });
  const [pendingOnly, setPendingOnly] = useState(false);
  const [pendingRevision, setPendingRevision] = useState(0);
  const toggleStrip = () => {
    setStripShown((on) => {
      try {
        localStorage.setItem("imago.viewerStrip", on ? "0" : "1");
      } catch {
        /* A preference of this window only. */
      }
      return !on;
    });
  };
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [annotating, setAnnotating] = useState(false);
  const [sideTab, setSideTab] = useState<ViewerSideTab>("annotations");
  const sideId = useId();
  const [annotations, setAnnotations] = useState<ImageAnnotation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drawing, setDrawing] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  /** The detail searched for: an annotation, or a box drawn with «Buscar» (`drawn`). */
  const [searching, setSearching] = useState<(DetailQuery & { drawn?: boolean }) | null>(null);
  /** «Buscar»: the next box drawn on the image is searched for in the other images. */
  const [searchMode, setSearchMode] = useState(false);
  /**
   * Whether images can be compared by what they show: an embedding model is
   * ready and some images have vectors for it. Null while unknown.
   */
  const [visual, setVisual] = useState<null | { ready: boolean; indexed: number }>(null);
  const [error, setError] = useState<string | null>(null);
  /** Marking heritage elements: with a point or a rectangle. */
  const [marking, setMarking] = useState<"point" | "rect" | null>(null);
  const [markDraft, setMarkDraft] = useState<MarkDraft | null>(null);
  /** An element of the record chosen in the panel to be marked next: the mark is saved as soon as it is drawn. */
  const [markTarget, setMarkTarget] = useState<string | null>(null);
  const [heritagePanel, setHeritagePanel] = useState<{ optionId: string; markId?: string } | null>(null);
  const [aiZones, setAiZones] = useState<{ x: number; y: number; w: number; h: number }[]>([]);
  const [drawingZone, setDrawingZone] = useState(false);
  const heritageColumns = (columns ?? []).filter((c) => isHeritageColumn(c));
  /** Select properties that can serve as the tags' dictionary. */
  const dictionaryChoices = (columns ?? []).filter(isHeritageDictionarySource);
  const [selectedHeritage, setSelectedHeritage] = useState<DatabaseColumn | null>(null);
  const [heritageDictionaryBusy, setHeritageDictionaryBusy] = useState(false);
  const heritageRequest = useRef(false);
  const autoCreatedHeritage = useRef<string | null>(null);
  // The vision model of «Sugerir con IA», the same for tags and heritage and
  // kept for the next time: the last one the user chose.
  const [visionModel, setVisionModelState] = useState(() => localStorage.getItem("imago.visionModel") ?? "");
  const tagCatalogue = useVisionModels(!!image && sideTab === "tags" && !searching, visionModel);
  const setVisionModel = (model: string) => {
    setVisionModelState(model);
    if (model) localStorage.setItem("imago.visionModel", model);
    else localStorage.removeItem("imago.visionModel");
  };
  const [allowNewHeritage, setAllowNewHeritage] = useState(false);
  const heritageKey = `imago.viewerHeritage.${row.databaseId}`;
  const currentHeritage = selectedHeritage?.databaseId === row.databaseId ? selectedHeritage : null;
  const heritageId = currentHeritage?.id ?? localStorage.getItem(heritageKey);
  const heritageColumn = heritageColumns.find((c) => c.id === heritageId) ?? currentHeritage ?? heritageColumns[0] ?? null;
  const heritageDictionary = heritageColumn ? heritageDictionaryOptions(heritageColumn, columns ?? []) : [];
  const heritageElements = useHeritage(heritageColumn?.id);
  const inCell = heritageColumn ? decodeMultiSelect(row.cells[heritageColumn.id] ?? null) : [];
  const heritageOptions = new Set(heritageColumn?.options.map((o) => o.id) ?? []);
  /** «Etiquetado»: regions drawn on the image and their tags. */
  const [tagging, setTagging] = useState(false);
  const [tagRegions, setTagRegions] = useState<VisualTagRegion[]>([]);
  const [loadedTagColumn, setTagColumn] = useState<DatabaseColumn | null>(null);
  const [tagOptionIds, setTagOptionIds] = useState<string[]>([]);
  const tagColumn = loadedTagColumn?.databaseId === row.databaseId ? loadedTagColumn : null;
  /** A select property linked as the tags' dictionary: its terms are offered while tagging. */
  const [loadedTagDictionary, setTagDictionary] = useState<DatabaseColumn | null>(null);
  const tagDictionary = loadedTagDictionary?.databaseId === row.databaseId ? loadedTagDictionary : null;
  const dictionaryId = tagDictionary?.id ?? null;
  const strip = useBrowse(browse, pendingOnly ? { databaseId: row.databaseId, dictionaryId, revision: pendingRevision } : null);
  const stripItems = strip.items;
  const browseRequest = useRef(0);
  useLayoutEffect(() => () => { ++browseRequest.current; }, [browse?.input, row.databaseId, dictionaryId, pendingOnly, pendingRevision, index]);
  const openBrowseItem = (item: BrowseItem, direction: 1 | -1 = 1) => {
    ++browseRequest.current;
    if (item.row.id === row.id) setIndex(item.imageIndex ?? 0);
    else {
      setEnterAt(item.imageIndex ?? (direction === -1 ? "end" : "start"));
      onBrowse?.(item);
    }
  };
  /** The next (1) or previous (-1) photograph of the list; false at its end. */
  const stepRecord = async (direction: 1 | -1) => {
    if (!browse || !onBrowse) return false;
    const request = ++browseRequest.current;
    const next = await strip.step(browse.index, direction, pendingOnly ? index : undefined);
    if (!next || request !== browseRequest.current) return false;
    openBrowseItem(next, direction);
    return true;
  };
  const [tagViewImage, setTagViewImage] = useState<ImageAsset>();
  const [nextDictionaryId, setNextDictionaryId] = useState<string | null>();
  const switchingDictionary = nextDictionaryId !== undefined;
  const tagScopeVersion = useRef(0);
  const tagsReady = !!image && tagViewImage?.id === image.id && !switchingDictionary;
  const setTagContentInert = useCallback((element: HTMLElement | null) => {
    if (element) element.inert = !tagsReady;
  }, [tagsReady]);
  const [reviewed, setReviewed] = useState(false);
  const [canUndoTag, setCanUndoTag] = useState(false);
  const [canRedoTag, setCanRedoTag] = useState(false);
  const [undoingTag, setUndoingTag] = useState(false);
  const [suggestionsUndo, setSuggestionsUndo] = useState(0);
  /** The selection and its editable tag choices, before saving. */
  const [tagDraft, setTagDraft] = useState<TagDraft | null>(null);
  const [tagPreviews, setTagPreviews] = useState<Record<string, TagPreview & { dictionaryId: string | null }>>({});
  const savingTags = useRef(new Set<string>());
  const pendingTag = image && tagPreviews[image.id];
  const tagPreview = tagsReady && pendingTag?.dictionaryId === dictionaryId ? pendingTag : null;
  const [tagSelected, setTagSelected] = useState<string | null>(null);
  const tagDrag = useRef<{ id: string; grip: Grip; start: Region; from: { x: number; y: number }; moved: boolean } | null>(null);
  const cancelTagDrag = () => {
    const drag = tagDrag.current;
    tagDrag.current = null;
    if (drag?.moved) setTagRegions((regions) => regions.map((r) => r.id === drag.id ? { ...r, ...drag.start } : r));
  };
  const appliedTags = new Map(tagColumn?.options.map((o) => [o.id, o]));
  const dictionaryTerms = new Map(tagDictionary?.options.map((o) => [o.id, o]));
  const describeTags = (choices: VisualTagChoice[]) => {
    let nextColor = tagColumn?.options.length ?? 0;
    return choices.flatMap((choice): TagAppearance[] => {
      const key = tagChoiceKey(choice);
      if ("label" in choice) return [{ key, label: choice.label, color: importedOptionColor(nextColor++), icon: null }];
      const own = appliedTags.get(choice.optionId);
      const option = own ?? dictionaryTerms.get(choice.optionId);
      if (!option) return [];
      const fallback = own ? DEFAULT_OPTION_COLOR : importedOptionColor(nextColor++);
      const column = own ? tagColumn : tagDictionary;
      return [{ key, label: option.label, color: option.color ?? fallback, icon: column ? optionIconValue(column.config, option.id) : null }];
    });
  };
  const draftTags = tagDraft ? describeTags(tagDraft.choices) : [];
  const editRegionTags = ({ id, x, y, w, h, optionIds }: VisualTagRegion) => {
    if (tagDraft || !image || savingTags.current.has(image.id)) return;
    setError(null);
    setTagSelected(id);
    setTagDraft({ id, x, y, w, h, choices: optionIds.map((optionId) => ({ optionId })) });
  };
  /** The layers drawn over the image: visual tags and annotations, each shown or hidden. */
  const [showTags, setShowTags] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  /** A way of looking at the image, only while it is shown: nothing is saved. */
  const [inspect, setInspect] = useState<InspectMode>("none");
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectView, setInspectView] = useState<{ key: string; url: string } | null>(null);
  const [inspectBusy, setInspectBusy] = useState(false);
  const inspectTrigger = useRef<HTMLButtonElement>(null);
  const layerTrigger = useRef<HTMLButtonElement>(null);
  const firstLayer = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (layersOpen) firstLayer.current?.focus();
  }, [layersOpen]);
  /** The crop being edited, as fractions of the whole turned image. */
  const [cropping, setCropping] = useState<Region | null>(null);
  const cropDrag = useRef<{ grip: Grip; start: Region; from: { x: number; y: number } } | null>(null);
  const savedCrop = image ? validCrop(image.metadata?.imagoCrop) : null;
  /** The shown image could not be loaded (its original moved, say). */
  const [loadFailed, setLoadFailed] = useState(false);
  /** A crop being saved: the bar waits instead of taking more clicks. */
  const [applying, setApplying] = useState(false);
  const activateSideTab = (tab: ViewerSideTab) => {
    if (sideTab === tab && !searching && !searchMode) return;
    if (sidebar.current) sidebar.current.scrollTop = 0;
    setSideTab(tab);
    setSearching(null);
    setSearchMode(false);
    setDrawing(null);
    setError(null);
    if (tab !== "annotations") setAnnotating(false);
    if (tab !== "tags") {
      cancelTagDrag();
      setTagging(false);
      setTagSelected(null);
    }
    if (tab !== "heritage") {
      setMarking(null);
      setDrawingZone(false);
    }
  };
  const chooseHeritageDictionary = useCallback(async (sourceId: string | null) => {
    if (heritageRequest.current) return;
    heritageRequest.current = true;
    setHeritageDictionaryBusy(true);
    setError(null);
    try {
      const column = await window.imago.call("heritageSelectDictionary", { databaseId: row.databaseId, sourceId });
      localStorage.setItem(heritageKey, column.id);
      setSelectedHeritage(column);
      setMarkDraft(null);
      setAiZones([]);
      setDrawingZone(false);
      setHeritagePanel(null);
      window.dispatchEvent(new CustomEvent("imago:reload-detail"));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      heritageRequest.current = false;
      setHeritageDictionaryBusy(false);
    }
  }, [row.databaseId, heritageKey, onChanged]);
  useEffect(() => {
    if (sideTab !== "heritage" || !columns || heritageColumn || autoCreatedHeritage.current === row.databaseId) return;
    autoCreatedHeritage.current = row.databaseId;
    void chooseHeritageDictionary(null);
  }, [sideTab, columns, heritageColumn, row.databaseId, chooseHeritageDictionary]);
  const startCrop = () => {
    setAnnotating(false);
    setTagging(false);
    setTagDraft(null);
    setSearchMode(false);
    setMarking(null);
    setDrawingZone(false);
    setMarkDraft(null);
    setDraft(null);
    setSelected(null);
    setNatural(null);
    setLoadFailed(false);
    setCropping(savedCrop ?? { x: 0, y: 0, w: 1, h: 1 });
  };
  const [cropOnOpen, setCropOnOpen] = useState(initialCrop);
  if (cropOnOpen && image) {
    setCropOnOpen(false);
    startCrop();
  }
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const closeRef = useRef(onClose);
  // Escape leaves the crop editor first, then closes the viewer.
  const isCropping = !!cropping;
  const tagFocus = !searching && sideTab === "tags" && (!!tagDraft || !!tagSelected);
  useEffect(() => {
    closeRef.current = isCropping
      ? () => {
          setCropping(null);
          setNatural(null);
          setLoadFailed(false);
        }
      : tagFocus
        ? () => {
            setTagDraft(null);
            setTagSelected(null);
          }
        : onClose;
  }, [onClose, isCropping, tagFocus]);

  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    d.addEventListener("cancel", cancel);
    return () => {
      d.removeEventListener("cancel", cancel);
      d.close();
    };
  }, []);
  // Keyed by the image id: the record is refreshed after each saved
  // annotation, and that must not reset the view of the same image.
  const imageId = image?.id;
  const activeImage = useRef<string | undefined>(imageId);
  const activeImageAsset = useRef<ImageAsset | undefined>(image);
  useLayoutEffect(() => { activeImageAsset.current = image; }, [image]);
  useLayoutEffect(() => {
    activeImage.current = imageId;
    tagDrag.current = null;
    return () => { activeImage.current = undefined; };
  }, [imageId]);
  const load = useCallback(async () => {
    if (!imageId) return;
    const annotations = await window.imago.call("annotationsList", { assetId: imageId });
    if (activeImage.current === imageId) setAnnotations(annotations);
  }, [imageId]);
  const tagLoad = useRef(0);
  const loadTagsFor = useCallback(async (assetId: string | undefined) => {
    if (!assetId || activeImage.current !== assetId) return;
    const request = ++tagLoad.current;
    const found = await window.imago.call("visualTagsList", { assetId });
    if (activeImage.current !== assetId || request !== tagLoad.current) return;
    setTagRegions(found.regions);
    setTagColumn(found.column);
    setTagDictionary(found.dictionary);
    setTagOptionIds(found.optionIds);
    setReviewed(found.reviewed);
    setCanUndoTag(found.canUndo);
    setCanRedoTag(found.canRedo);
    setTagViewImage(activeImageAsset.current);
    setTagDraft((draft) => draft?.id && !found.regions.some((r) => r.id === draft.id) ? null : draft);
  }, []);
  const loadTags = useCallback(() => loadTagsFor(imageId), [imageId, loadTagsFor]);
  useEffect(() => {
    void loadTags().catch(() => {});
  }, [loadTags]);
  const changeDictionary = async (columnId: string | null) => {
    setNextDictionaryId(columnId);
    ++tagScopeVersion.current;
    ++tagLoad.current;
    setTagDraft(null);
    setTagSelected(null);
    setDrawing(null);
    tagDrag.current = null;
    setError(null);
    try {
      await window.imago.call("visualTagDictionary", { databaseId: row.databaseId, columnId });
      await loadTagsFor(activeImage.current);
      window.dispatchEvent(new CustomEvent("imago:reload-detail"));
    } catch (err) {
      await loadTagsFor(activeImage.current).catch(() => {});
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setNextDictionaryId(undefined);
    }
  };
  const [shown, setShown] = useState(imageId);
  if (shown !== imageId) {
    setShown(imageId);
    setNatural(null);
    setDraft(null);
    setDrawing(null);
    setAnnotations([]);
    setAiZones([]);
    setDrawingZone(false);
    setMarkDraft(null);
    setHeritagePanel(null);
    setSelected(null);
    setTagDraft(null);
    setTagSelected(null);
    setSuggestionsUndo(0);
    setCropping(null);
    setLoadFailed(false);
    if (searching?.drawn) setSearching(null);
  }
  useEffect(() => {
    void load();
  }, [load]);
  // The crop editor shows the whole image, a file of its own prepared on
  // demand: ask for it in the background so «Recortar» opens at once
  // instead of waiting behind imports or indexing.
  const imageRevision = image?.revision;
  const imageSrc = imageId ? src(imageId, imageRevision, cropping ? "full" : "preview") : undefined;
  // The modes that need the workshop's engine are drawn over the image, the same size.
  const inspectKey = imageId && INSPECT_OPS[inspect] ? `${imageId}|${imageRevision}|${inspect}` : null;
  useEffect(() => {
    if (!inspectKey || !imageId) return;
    let live = true;
    setInspectBusy(true);
    void window.imago
      .call("workshopPreview", { session: "inspect", assetId: imageId, versionId: null, ops: INSPECT_OPS[inspect]!, maxSide: 2400 })
      .then((r) => live && setInspectView({ key: inspectKey, url: `imago://workshop/${r.name}` }))
      .catch(() => live && setInspect("none"))
      .finally(() => live && setInspectBusy(false));
    return () => {
      live = false;
    };
  }, [inspectKey, imageId, inspect]);
  const inspectFilter = cropping ? undefined : INSPECT_FILTERS[inspect];
  const thumbSrc = imageId && !cropping ? src(imageId, imageRevision, "thumb") : undefined;
  const [loadedThumb, setLoadedThumb] = useState<string>();
  const imageElement = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const element = imageElement.current;
    if (element?.complete && element.naturalWidth) {
      setLoadFailed(false);
      setNatural({ w: element.naturalWidth, h: element.naturalHeight });
    }
  }, [imageSrc]);
  const stripIndex = browse?.index ?? -1;
  const previousImages = stripItems.filter((item) => item.index < stripIndex).at(-1)?.row.images;
  const previousImage = row.images[index - 1] ?? previousImages?.at(-1);
  const nextImage = row.images[index + 1] ?? stripItems.find((item) => item.index > stripIndex)?.row.images[0];
  const previousSrc = previousImage && src(previousImage.id, previousImage.revision);
  const nextSrc = nextImage && src(nextImage.id, nextImage.revision);
  const warmPreviews = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    const urls = [previousSrc, imageSrc, nextSrc];
    const cache = warmPreviews.current;
    for (const url of cache.keys()) if (!urls.includes(url)) cache.delete(url);
    for (const url of [previousSrc, nextSrc]) {
      if (!url || cache.has(url)) continue;
      const preload = new Image();
      preload.fetchPriority = "low";
      preload.src = url;
      cache.set(url, preload);
      void preload.decode().catch(() => {});
    }
  }, [previousSrc, imageSrc, nextSrc]);
  useEffect(() => {
    if (!imageId) return;
    const timer = window.setTimeout(() => {
      const preload = new Image();
      preload.src = src(imageId, imageRevision, "full");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [imageId, imageRevision]);
  useEffect(() => {
    void window.imago.call("annotationTags", { databaseId: row.databaseId }).then(setKnown).catch(() => {});
  }, [row.databaseId]);
  useEffect(() => {
    void window.imago
      .call("status")
      .then((status) => setVisual({ ready: status.semanticReady, indexed: status.indexed }))
      .catch(() => setVisual({ ready: false, indexed: 0 }));
  }, []);
  const visualSearch = !!visual?.ready && visual.indexed > 0;

  /** The stage's size, for what floats over it (the tag picker). */
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  /** The whole image in view. */
  const fit = useCallback(() => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || !natural) return;
    const scale = Math.min((box.width - 48) / natural.w, (box.height - 48) / natural.h, 4);
    setView({ scale, x: (box.width - natural.w * scale) / 2, y: (box.height - natural.h * scale) / 2 });
  }, [natural]);
  useLayoutEffect(() => fit(), [fit]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  const zoom = (factor: number, cx?: number, cy?: number) => {
    const box = stage.current!.getBoundingClientRect();
    const px = cx ?? box.width / 2,
      py = cy ?? box.height / 2;
    setView((v) => {
      const scale = Math.min(12, Math.max(0.05, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };
  // The wheel scrolls the image like a page, without leaving it out of view;
  // a pinch on the trackpad (or Ctrl + wheel) zooms where the pointer is.
  // A listener of its own, because React's wheel handler cannot stop the page
  // from zooming.
  useEffect(() => {
    if (!stageElement) return;
    const wheel = (event: WheelEvent) => {
      // The tag picker floating over the image scrolls its own list.
      if (event.target instanceof Element && event.target.closest(".viewer-tag-picker") && !event.ctrlKey) return;
      event.preventDefault();
      if (!natural) return;
      const box = stageElement.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1;
      if (event.ctrlKey) {
        const factor = Math.exp(-event.deltaY * unit * 0.01),
          px = event.clientX - box.left,
          py = event.clientY - box.top;
        setView((v) => {
          const scale = Math.min(12, Math.max(0.05, v.scale * factor));
          const k = scale / v.scale;
          return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
        });
        return;
      }
      // Shift turns a mouse's vertical wheel into a sideways scroll.
      const [dx, dy] = event.shiftKey && !event.deltaX ? [event.deltaY, 0] : [event.deltaX, event.deltaY];
      const scroll = (at: number, delta: number, size: number, room: number) => {
        if (size + 48 <= room || !delta) return at;
        const next = at - delta * unit;
        return delta > 0 ? Math.max(next, Math.min(at, room - size - 24)) : Math.min(next, Math.max(at, 24));
      };
      setView((v) => {
        const x = scroll(v.x, dx, natural.w * v.scale, box.width),
          y = scroll(v.y, dy, natural.h * v.scale, box.height);
        return x === v.x && y === v.y ? v : { ...v, x, y };
      });
    };
    stageElement.addEventListener("wheel", wheel, { passive: false });
    return () => stageElement.removeEventListener("wheel", wheel);
  }, [stageElement, natural]);
  /**
   * Queues the tag analysis of the next images of the list (from the rest of
   * this record on) that are not reviewed yet in the active dictionary.
   */
  const queueTagAnalysis = async (count: number, choice: ModelChoice) => {
    if (!dictionaryId || !image) return 0;
    const ids: string[] = [];
    const collect = async (rows: { id: string; images: { id: string }[] }[]) => {
      if (!rows.length) return;
      const pending = new Set(await window.imago.call("visualTagPending", {
        databaseId: row.databaseId, dictionaryId, rowIds: rows.map((r) => r.id),
      }));
      for (const r of rows)
        for (const asset of r.images)
          if (pending.has(asset.id) && asset.id !== image.id && !ids.includes(asset.id)) ids.push(asset.id);
    };
    await collect([{ id: row.id, images: row.images.slice(index + 1) }]);
    // Through the list in pages, up to a couple of thousand records ahead.
    for (let offset = (browse?.index ?? 0) + 1; browse && ids.length < count && offset < browse.total && offset - browse.index <= 2000; offset += 100) {
      const page = await window.imago.call("search", { ...browse.input, offset, limit: 100 });
      if (!page.rows.length) break;
      await collect(page.rows);
    }
    const assetIds = ids.slice(0, count);
    if (assetIds.length) await window.imago.call("visualTagQueue", { dictionaryId, choice, assetIds });
    return assetIds.length;
  };
  /** A pointer position as fractions of the image. */
  const point = (event: { clientX: number; clientY: number }) => {
    if (!natural) return { x: 0, y: 0 };
    const box = stage.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left - view.x) / view.scale / natural.w)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top - view.y) / view.scale / natural.h)),
    };
  };
  const onPointerDown = (event: ReactPointerEvent) => {
    if (!natural || event.button !== 0) return;
    if (cropping) {
      const grip = ((event.target as HTMLElement).closest("[data-grip]") as HTMLElement | null)?.dataset.grip as Grip | undefined;
      const from = point(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      cropDrag.current = { grip: grip ?? "new", start: cropping, from };
      return;
    }
    // Zones for the AI and boxes to search for may be drawn over existing marks.
    if (drawingZone || searchMode) {
      const p = point(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrawing({ x0: p.x, y0: p.y, x: p.x, y: p.y });
      return;
    }
    // Tagging: a selected region moves or resizes by its body or grips; elsewhere a new one is drawn.
    if (tagging) {
      if (!tagsReady || tagDraft) return;
      const target = event.target as HTMLElement;
      const regionEl = target.closest("[data-tag-region]") as HTMLElement | null;
      if (target.closest(".viewer-tag-tools, .tag-picker") || (image && savingTags.current.has(image.id))) return;
      if (regionEl) {
        const id = regionEl.dataset.tagRegion!;
        const region = tagRegions.find((r) => r.id === id);
        if (!region) return;
        setTagSelected(id);
        const grip = ((target.closest("[data-grip]") as HTMLElement | null)?.dataset.grip as Grip | undefined) ?? "move";
        event.currentTarget.setPointerCapture(event.pointerId);
        tagDrag.current = { id, grip, start: { x: region.x, y: region.y, w: region.w, h: region.h }, from: point(event), moved: false };
        return;
      }
      const p = point(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      setTagSelected(null);
      setError(null);
      setDrawing({ x0: p.x, y0: p.y, x: p.x, y: p.y });
      return;
    }
    if ((event.target as HTMLElement).closest(".viewer-region, .viewer-mark")) return;
    if (marking === "point") {
      const p = point(event);
      const draft = { kind: "point" as const, x: p.x, y: p.y, w: 0, h: 0 };
      if (markTarget) void saveMark(markTarget, draft);
      else setMarkDraft(draft);
      setSelected(null);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (annotating || marking === "rect") {
      const p = point(event);
      setDrawing({ x0: p.x, y0: p.y, x: p.x, y: p.y });
      setSelected(null);
    } else drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (tagDrag.current && natural) {
      const d = tagDrag.current,
        p = point(event);
      const next = dragCrop(d.start, d.grip, p.x - d.from.x, p.y - d.from.y, d.from);
      if (Math.abs(p.x - d.from.x) + Math.abs(p.y - d.from.y) > 0.002) d.moved = true;
      setTagRegions((all) => all.map((r) => (r.id === d.id ? { ...r, ...next } : r)));
      return;
    }
    if (cropDrag.current && natural) {
      const { grip, start, from } = cropDrag.current,
        p = point(event);
      setCropping(dragCrop(start, grip, p.x - from.x, p.y - from.y, from));
      return;
    }
    if (drawing && natural) {
      const p = point(event);
      setDrawing({ ...drawing, x: p.x, y: p.y });
    } else if (drag.current) {
      const d = drag.current;
      setView((v) => ({ ...v, x: d.vx + event.clientX - d.x, y: d.vy + event.clientY - d.y }));
    }
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    drag.current = null;
    cropDrag.current = null;
    if (tagDrag.current) {
      const d = tagDrag.current;
      tagDrag.current = null;
      const region = tagRegions.find((r) => r.id === d.id);
      if (d.moved && region && image)
        void saveTag({ id: region.id, x: region.x, y: region.y, w: region.w, h: region.h });
      return;
    }
    if (!drawing || !natural) return;
    // Pointer moves can still be waiting for a render when the drag ends.
    const end = point(event);
    const x = Math.min(drawing.x0, end.x),
      y = Math.min(drawing.y0, end.y),
      w = Math.abs(end.x - drawing.x0),
      h = Math.abs(end.y - drawing.y0);
    setDrawing(null);
    if (w < 0.01 || h < 0.01) return;
    if (tagging) setTagDraft({ x, y, w, h, choices: [] });
    else if (searchMode) {
      if (image) setSearching({ assetId: image.id, x, y, w, h, drawn: true });
    } else if (drawingZone) setAiZones((all) => [...all, { x, y, w, h }].slice(0, 6));
    else if (marking === "rect") {
      if (markTarget) void saveMark(markTarget, { kind: "rect", x, y, w, h });
      else setMarkDraft({ kind: "rect", x, y, w, h });
    }
    else setDraft({ x, y, w, h, note: "", tags: [] });
  };
  /** Saves a region's geometry and any edited tags, then refreshes the record. */
  const saveTag = async (input: Omit<Commands["visualTagSave"]["input"], "assetId" | "dictionaryId">, preview?: TagPreview) => {
    if (!image || !tagsReady || savingTags.current.has(image.id)) return;
    const assetId = image.id;
    const scopeVersion = tagScopeVersion.current;
    savingTags.current.add(assetId);
    setError(null);
    if (preview) {
      setTagPreviews((all) => ({ ...all, [assetId]: { ...preview, dictionaryId } }));
      setTagDraft(null);
      setTagSelected(null);
    }
    try {
      const { column, ...saved } = await window.imago.call("visualTagSave", { ...input, assetId, dictionaryId });
      setPendingRevision((revision) => revision + 1);
      if (activeImage.current === assetId && scopeVersion === tagScopeVersion.current) {
        setTagRegions((all) => all.some((r) => r.id === saved.id) ? all.map((r) => r.id === saved.id ? saved : r) : [...all, saved]);
        if (column) setTagColumn(column);
        setTagOptionIds((ids) => [...new Set([...ids, ...saved.optionIds])]);
        setTagSelected(saved.id);
        setReviewed(true);
        setCanUndoTag(true);
      } else {
        void loadTagsFor(activeImage.current).catch(() => {});
      }
      // The table and record also need to know about a new property or option.
      if (column) window.dispatchEvent(new CustomEvent("imago:reload-detail"));
      onChanged();
    } catch (e) {
      if (activeImage.current === assetId && scopeVersion === tagScopeVersion.current) {
        setError(e instanceof Error ? e.message : String(e));
        if (preview) {
          setTagDraft(preview.draft);
          setTagSelected(preview.draft.id ?? null);
        } else {
          await loadTags().catch(() => {});
        }
      }
    } finally {
      savingTags.current.delete(assetId);
      if (preview) setTagPreviews(({ [assetId]: _, ...rest }) => rest);
    }
  };
  const pickTag = (choice: VisualTagChoice) => {
    const key = tagChoiceKey(choice);
    setTagDraft((draft) => {
      if (!draft) return null;
      const included = draft.choices.some((tag) => tagChoiceKey(tag) === key);
      const choices = included
        ? draft.choices.filter((tag) => tagChoiceKey(tag) !== key)
        : [...draft.choices, choice];
      return { ...draft, choices };
    });
  };
  const removeDraftTag = (key: string) => {
    setTagDraft((draft) => draft && { ...draft, choices: draft.choices.filter((tag) => tagChoiceKey(tag) !== key) });
  };
  const saveTagDraft = () => {
    if (!tagDraft || !draftTags.length) return;
    const { choices, ...region } = tagDraft;
    const keys = new Set(draftTags.map((tag) => tag.key));
    const tags = choices.filter((choice) => keys.has(tagChoiceKey(choice)));
    void saveTag({ ...region, tags }, { draft: tagDraft, tags: draftTags });
  };
  const removeTag = async (id: string) => {
    setError(null);
    try {
      await window.imago.call("visualTagDelete", { id });
      if (tagSelected === id) setTagSelected(null);
      setPendingRevision((revision) => revision + 1);
      await loadTags();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const toggleReviewed = async () => {
    if (!image || !tagsReady) return;
    try {
      await window.imago.call("visualTagReview", { assetId: image.id, reviewed: !reviewed, dictionaryId });
      setPendingRevision((revision) => revision + 1);
      await loadTags();
      onChanged();
    } catch (err) {
      if (activeImage.current === image.id) setError(err instanceof Error ? err.message : String(err));
    }
  };
  const undoTag = async (direction: "undo" | "redo" = "undo") => {
    if (!image || !tagsReady || !(direction === "undo" ? canUndoTag : canRedoTag) || undoingTag || tagDraft || tagPreview || savingTags.current.has(image.id)) return;
    const assetId = image.id;
    const scopeVersion = tagScopeVersion.current;
    setUndoingTag(true);
    setError(null);
    try {
      const action = await window.imago.call(direction === "undo" ? "visualTagUndo" : "visualTagRedo", { assetId, dictionaryId });
      if (action) {
        setPendingRevision((revision) => revision + 1);
        if (activeImage.current === assetId && scopeVersion === tagScopeVersion.current) {
          setTagSelected(null);
          if (action.kind === "suggestions") setSuggestionsUndo((version) => version + 1);
        }
        onChanged();
      }
      await loadTags();
    } catch (err) {
      if (activeImage.current === assetId && scopeVersion === tagScopeVersion.current) {
        setError(err instanceof Error ? err.message : String(err));
        await loadTags().catch(() => {});
      }
    } finally {
      setUndoingTag(false);
    }
  };
  const save = async () => {
    if (!draft || !image) return;
    setError(null);
    try {
      const saved = await window.imago.call("annotationSave", {
        id: draft.id,
        assetId: image.id,
        x: draft.x,
        y: draft.y,
        w: draft.w,
        h: draft.h,
        note: draft.note,
        tags: draft.tags,
        color: draft.id ? annotations.find((a) => a.id === draft.id)?.color ?? null : COLORS[annotations.length % COLORS.length],
      });
      setDraft(null);
      setSelected(saved.id);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = async (annotation: ImageAnnotation) => {
    if (!window.confirm(t("¿Eliminar esta anotación? No se puede deshacer."))) return;
    await window.imago.call("annotationDelete", { id: annotation.id });
    if (selected === annotation.id) setSelected(null);
    await load();
    onChanged();
  };
  /** Saves the drawn mark as showing this element (added to the record if missing). */
  const saveMark = async (optionId: string, mark: MarkDraft | null = markDraft) => {
    if (!mark || !image || !heritageColumn) return;
    setMarkTarget(null);
    setError(null);
    try {
      const source = heritageDictionary.find((entry) => entry.id === optionId);
      if (source && !heritageOptions.has(optionId)) {
        optionId = await window.imago.call("heritageAddElement", { columnId: heritageColumn.id, label: source.label, link: null });
        window.dispatchEvent(new CustomEvent("imago:reload-detail"));
      }
      const saved = await window.imago.call("annotationSave", {
        assetId: image.id,
        ...mark,
        note: "",
        tags: [],
        optionId,
      });
      setMarkDraft(null);
      setSelected(saved.id);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  /** A new element of the heritage property, then the mark. */
  const createElement = async (label: string) => {
    if (!heritageColumn) return;
    setError(null);
    try {
      const created = await window.imago.call("heritageAddElement", { columnId: heritageColumn.id, label, link: null });
      window.dispatchEvent(new CustomEvent("imago:reload-detail"));
      await saveMark(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const removeMark = async (mark: ImageAnnotation) => {
    await window.imago.call("annotationDelete", { id: mark.id });
    if (selected === mark.id) setSelected(null);
    await load();
    onChanged();
  };
  /** Crop as edited, or the whole image again with `null`. */
  const applyCrop = async (crop: Region | null) => {
    if (!image || applying) return;
    setError(null);
    setApplying(true);
    try {
      await window.imago.call("cropImage", { id: image.id, crop: crop && validCrop(crop) });
      setCropping(null);
      setNatural(null);
      setLoadFailed(false);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };
  const cancelCrop = () => {
    setCropping(null);
    setNatural(null);
    setLoadFailed(false);
  };
  /** A quarter turn kept with the image; its annotations turn with it. */
  const rotate = async (direction: "left" | "right") => {
    if (!image) return;
    setError(null);
    try {
      await window.imago.call("rotateImage", { id: image.id, direction });
      setDraft(null);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  /** Centre a region and zoom to it. */
  const focus = (a: { x: number; y: number; w: number; h: number }) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box || !natural) return;
    const scale = Math.min(12, Math.min((box.width * 0.7) / (a.w * natural.w), (box.height * 0.7) / (a.h * natural.h)));
    setView({
      scale,
      x: box.width / 2 - (a.x + a.w / 2) * natural.w * scale,
      y: box.height / 2 - (a.y + a.h / 2) * natural.h * scale,
    });
  };

  const toggleViewerTool = (tool: ViewerTool) => {
    if (!image || cropping || (tool === "search" && !visualSearch)) return;
    if (tool === "heritage" && !heritageColumn) {
      activateSideTab("heritage");
      return;
    }
    const active = { annotations: annotating, search: searchMode, heritage: !!marking, tags: tagging };
    const enabling = !active[tool];

    if (tool === "search") setSearching(null);
    else activateSideTab(tool);
    setAnnotating(tool === "annotations" && enabling);
    setSearchMode(tool === "search" && enabling);
    setMarking(tool === "heritage" && enabling ? "point" : null);
    setMarkTarget(null);
    setTagging(tool === "tags" && enabling);
    cancelTagDrag();
    setDrawing(null);
    setDrawingZone(false);
    setMarkDraft(null);
    setTagDraft(null);
    if (tool !== "annotations") setDraft(null);
    if (tool === "tags") {
      setTagSelected(null);
      if (enabling) setShowTags(true);
    }
    if (tool === "heritage" && enabling) setHeritagePanel(null);
  };
  const toolShortcut = (tool: ViewerTool) => `${viewerUsesCommand ? "Meta" : "Control"}+${VIEWER_TOOL_KEYS[tool]}`;
  const toolTooltip = (tool: ViewerTool, description: string) => {
    const keys = `${viewerUsesCommand ? t("Comando") : "Ctrl"} + ${VIEWER_TOOL_KEYS[tool]}`;
    return `${t(description).replace(/\.$/, "")} (${t("Atajo {teclas}").replace("{teclas}", keys)})`;
  };
  const keyTooltip = (description: string, key: string) =>
    `${t(description)} (${t("Atajo {teclas}").replace("{teclas}", `${viewerUsesCommand ? t("Comando") : "Ctrl"} + ${key}`)})`;

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      const undoShortcut = event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
      const redoShortcut = (event.metaKey || event.ctrlKey) && !event.altKey &&
        ((event.key.toLowerCase() === "z" && event.shiftKey) || (event.key.toLowerCase() === "y" && !event.shiftKey));
      const stripArrow = (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        target?.matches('.viewer-strip-pending input[type="checkbox"]');
      const checkboxUndo = (undoShortcut || redoShortcut) && target?.matches('input[type="checkbox"]');
      if (!stripArrow && !checkboxUndo && target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      // Keys typed in a window opened over the viewer (a result of «Buscar») are its own.
      const within = target?.closest('dialog,[role="dialog"]');
      if (within && within !== dialog.current) return;
      if (cropping) {
        if (event.key === "Enter" && natural) void applyCrop(cropping);
        return;
      }
      if (sideTab === "tags" && tagsReady && !searching && !tagDraft && !tagPreview && undoShortcut && canUndoTag) {
        event.preventDefault();
        if (!event.repeat) void undoTag();
        return;
      }
      if (sideTab === "tags" && tagsReady && !searching && !tagDraft && !tagPreview && redoShortcut && canRedoTag) {
        event.preventDefault();
        if (!event.repeat) void undoTag("redo");
        return;
      }
      const viewerModifier = viewerUsesCommand ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (viewerModifier && !event.altKey && !event.shiftKey) {
        const shortcut = event.key.toUpperCase();
        const tool = VIEWER_SHORTCUTS.find((name) => VIEWER_TOOL_KEYS[name] === shortcut);
        if (tool && image && (tool !== "search" || visualSearch)) {
          event.preventDefault();
          if (!event.repeat) toggleViewerTool(tool);
          return;
        }
      }
      if ((event.key === "Delete" || event.key === "Backspace") && tagging && tagSelected && !tagDraft) {
        event.preventDefault();
        void removeTag(tagSelected);
      }
      if (event.key === "Escape" && tagging && (tagDraft || tagSelected)) {
        setTagDraft(null);
        setTagSelected(null);
      }
      // Up and down go through the list of the side panel's open tab (tags,
      // notes or heritage marks), focusing each one as a click on it does.
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.altKey && !event.metaKey && !event.ctrlKey && !searching) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = <T extends { id: string }>(items: T[], current: string | null) => {
          if (!items.length) return null;
          const at = items.findIndex((item) => item.id === current);
          return items[at < 0 ? (step > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, at + step))];
        };
        const reveal = () => window.setTimeout(() =>
          document.querySelector(`[id$="-panel-${sideTab}"] .viewer-list li.is-selected`)?.scrollIntoView({ block: "nearest" }), 30);
        if (sideTab === "tags" && tagsReady && !tagDraft && !tagPreview) {
          const region = next(tagRegions, tagSelected);
          if (region) {
            event.preventDefault();
            setTagSelected(region.id);
            focus(region);
            reveal();
          }
        } else if (sideTab === "annotations" && !draft) {
          const note = next(annotations.filter((a) => !a.optionId), selected);
          if (note) {
            event.preventDefault();
            setSelected(note.id);
            focus(note);
            reveal();
          }
        } else if (sideTab === "heritage" && !markDraft && !heritagePanel) {
          // In the order of the list: element by element, each of its marks.
          const mark = next(inCell.flatMap((id) => annotations.filter((m) => m.optionId === id)), selected);
          if (mark) {
            event.preventDefault();
            setSelected(mark.id);
            focus(mark.kind === "point" ? { x: mark.x - 0.05, y: mark.y - 0.05, w: 0.1, h: 0.1 } : mark);
            reveal();
          }
        }
        return;
      }
      // Zoom: Command (Ctrl) with + − 0 as in every app, or those keys alone.
      // Taken here so the window's own zoom does not enlarge the whole interface.
      const zoomKey = ({ "+": 1.25, "=": 1.25, "-": 0.8, "0": 0 } as Record<string, number>)[event.key];
      if (zoomKey !== undefined && !event.altKey && (viewerModifier || (!event.metaKey && !event.ctrlKey))) {
        event.preventDefault();
        if (zoomKey) zoom(zoomKey);
        else fit();
        return;
      }
      // The arrows go through the record's images, then on to the next or previous photograph of the list.
      if (event.key === "ArrowRight") {
        if (stripArrow) event.preventDefault();
        if (!pendingOnly && index < row.images.length - 1) setIndex(index + 1);
        else void stepRecord(1);
      }
      if (event.key === "ArrowLeft") {
        if (stripArrow) event.preventDefault();
        if (!pendingOnly && index > 0) setIndex(index - 1);
        else void stepRecord(-1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const ratio = natural ? natural.w / natural.h : image?.width && image.height ? image.width / image.height : 1;
  const box = (a: { x: number; y: number; w: number; h: number }) =>
    natural
      ? {
          left: view.x + a.x * natural.w * view.scale,
          top: view.y + a.y * natural.h * view.scale,
          width: a.w * natural.w * view.scale,
          height: a.h * natural.h * view.scale,
        }
      : { display: "none" };
  /** Where the tag picker floats: beside the region, on the side with room, inside the stage. */
  const pickerAt = (r: { x: number; y: number; w: number; h: number }): React.CSSProperties => {
    const b = box(r) as { left?: number; top?: number; width?: number; height?: number };
    const stageBox = { width: stageSize.w, height: stageSize.h };
    if (b.left === undefined || !stageSize.w) return { display: "none" };
    const width = 260,
      right = b.left + (b.width ?? 0) + 10;
    const left = right + width <= stageBox.width - 8 ? right : Math.max(8, b.left - width - 10);
    return { left, top: Math.min(Math.max(8, b.top ?? 0), Math.max(8, stageBox.height - 340)), width };
  };
  const pending = drawing
    ? { x: Math.min(drawing.x0, drawing.x), y: Math.min(drawing.y0, drawing.y), w: Math.abs(drawing.x - drawing.x0), h: Math.abs(drawing.y - drawing.y0) }
    : !searching && sideTab === "annotations" && draft && !draft.id
      ? draft
      : null;

  // Notes on one side; marks of heritage elements the record shows on the other.
  const notes = annotations.filter((a) => !a.optionId);
  const heritageMarks = annotations.filter((a) => a.optionId && heritageOptions.has(a.optionId));
  const shownMarks = heritageMarks.filter((m) => inCell.includes(m.optionId!));
  // Keep the panel's last contents until the next image's tags arrive.
  // During that handoff only the current image's metadata supplies its tab count.
  const tagListImage = tagsReady ? image : tagColumn ? tagViewImage : undefined;
  const tagListRatio = tagsReady ? ratio : tagListImage?.width && tagListImage.height ? tagListImage.width / tagListImage.height : 1;
  const sideCounts = {
    annotations: notes.length,
    tags: image ? (tagsReady ? tagRegions.length : image.validatedTagRegions ?? 0) : null,
    heritage: inCell.length,
  };
  const showTagDraft = !searching && sideTab === "tags" && tagDraft;
  const canShowStrip = !!(browse && onBrowse);
  const layers = [
    {
      id: "viewer-layer-tags", label: "Etiquetas", shown: showTags, toggle: () => setShowTags((shown) => !shown),
      tooltip: showTags ? "Ocultar las etiquetas" : "Mostrar las etiquetas",
    },
    {
      id: "viewer-layer-notes", label: "Anotaciones", shown: showNotes, toggle: () => setShowNotes((shown) => !shown),
      tooltip: showNotes ? "Ocultar las anotaciones" : "Mostrar las anotaciones",
    },
    {
      id: "viewer-strip-toggle", label: "Tira", shown: canShowStrip && stripShown, toggle: toggleStrip, disabled: !canShowStrip,
      tooltip: !canShowStrip ? "La tira está disponible al abrir el visor desde una lista de fotos."
        : stripShown ? "Ocultar la tira de fotos" : "Mostrar la tira con las fotos de la lista (← → para pasar)",
    },
  ];

  return (
    <dialog ref={dialog} className="image-viewer" aria-label={row.title} data-testid="image-viewer">
      <header className="viewer-bar">
        <div className="viewer-title">
          <strong>{row.title}</strong>
          <span>{image?.fileName}</span>
        </div>
        {row.images.length > 1 && (
          <div className="viewer-group">
            <button type="button" aria-label={t("Imagen anterior")} data-tooltip={t("Imagen anterior")} disabled={pendingOnly ? !strip.canStep(-1, index) : !index}
              onClick={() => pendingOnly ? void stepRecord(-1) : setIndex(index - 1)}>
              <ChevronLeft size={17} />
            </button>
            <span className="viewer-count">
              {index + 1} / {row.images.length}
            </span>
            <button type="button" aria-label={t("Imagen siguiente")} data-tooltip={t("Imagen siguiente")} disabled={pendingOnly ? !strip.canStep(1, index) : index >= row.images.length - 1}
              onClick={() => pendingOnly ? void stepRecord(1) : setIndex(index + 1)}>
              <ChevronRight size={17} />
            </button>
          </div>
        )}
        <div className="viewer-group">
          <button type="button" aria-label={t("Alejar")} data-tooltip={keyTooltip("Alejar", "-")} onClick={() => zoom(0.8)}>
            <Minus size={16} />
          </button>
          <span className="viewer-count">{Math.round(view.scale * 100)} %</span>
          <button type="button" aria-label={t("Acercar")} data-tooltip={keyTooltip("Acercar", "+")} onClick={() => zoom(1.25)}>
            <Plus size={16} />
          </button>
          <button type="button" aria-label={t("Ajustar a la pantalla")} data-tooltip={keyTooltip("Ajustar a la pantalla", "0")} onClick={fit}>
            <Maximize size={15} />
          </button>
        </div>
        {cropping ? (
          <div className="crop-bar" data-testid="viewer-crop-bar">
            <span>{t("Arrastra el marco o sus esquinas para elegir la parte que quieres ver.")}</span>
            <button type="button" className="viewer-annotate" disabled={applying || !natural} onClick={() => setCropping({ x: 0, y: 0, w: 1, h: 1 })}>
              {t("Toda la imagen")}
            </button>
            <button type="button" className="viewer-annotate" disabled={applying} onClick={cancelCrop}>
              {t("Cancelar")}
            </button>
            <button
              type="button"
              className="viewer-annotate is-on"
              data-testid="viewer-crop-apply"
              disabled={applying || !natural}
              onClick={() => void applyCrop(cropping)}
            >
              {applying ? <Spinner /> : <Check size={15} />}
              {t(applying ? "Aplicando…" : "Aplicar recorte")}
            </button>
          </div>
        ) : (
          <>
            <div className="viewer-group">
              <button
                type="button"
                aria-label={t("Girar a la izquierda")}
                data-tooltip={t("Girar 90° a la izquierda. El original no se modifica.")}
                data-testid="viewer-rotate-left"
                disabled={!image}
                onClick={() => void rotate("left")}
              >
                <RotateCcw size={15} />
              </button>
              <button
                type="button"
                aria-label={t("Girar a la derecha")}
                data-tooltip={t("Girar 90° a la derecha. El original no se modifica.")}
                data-testid="viewer-rotate-right"
                disabled={!image}
                onClick={() => void rotate("right")}
              >
                <RotateCw size={15} />
              </button>
              <button
                type="button"
                aria-label={t("Recortar")}
                data-tooltip={t("Recortar la imagen a tu gusto. El original no se modifica.")}
                data-testid="viewer-crop"
                data-tour="viewer-crop"
                disabled={!image}
                onClick={startCrop}
              >
                <CropIcon size={15} />
              </button>
              {savedCrop && (
                <button
                  type="button"
                  aria-label={t("Volver al original")}
                  data-tooltip={t("Volver al original: quita el recorte y muestra la imagen completa.")}
                  data-testid="viewer-uncrop"
                  onClick={() => void applyCrop(null)}
                >
                  <ImageOff size={15} />
                </button>
              )}
            </div>
            <button
              type="button"
              className={`viewer-annotate ${annotating ? "is-on" : ""}`}
              aria-pressed={annotating}
              aria-keyshortcuts={toolShortcut("annotations")}
              data-testid="viewer-annotate"
              data-tour="viewer-annotate"
              disabled={!image}
              data-tooltip={toolTooltip("annotations", "Arrastra sobre la imagen para marcar una zona y escribir una nota.")}
              onClick={() => toggleViewerTool("annotations")}
            >
              <SquareDashedMousePointer size={16} />
              {t("Anotar")}
            </button>
            <button
              type="button"
              className={`viewer-annotate ${searchMode ? "is-on" : ""}`}
              aria-pressed={searchMode}
              aria-keyshortcuts={toolShortcut("search")}
              data-testid="viewer-search"
              disabled={!image || !visualSearch}
              data-tooltip={toolTooltip(
                "search",
                visual === null
                  ? "Comprobando el índice visual…"
                  : !visual.ready
                    ? "Para buscar por zonas, elige e instala en Ajustes un modelo de embeddings con visión."
                    : !visual.indexed
                      ? "Para buscar por zonas, indexa antes las imágenes para la búsqueda semántica."
                      : "Arrastra sobre la imagen un recuadro para buscar elementos parecidos en las demás imágenes.",
              )}
              onClick={() => toggleViewerTool("search")}
            >
              <ScanSearch size={16} />
              {t("Buscar")}
            </button>
            <div className="viewer-group viewer-heritage">
              <button
                type="button"
                className={`viewer-annotate ${marking ? "is-on" : ""}`}
                aria-pressed={!!marking}
                aria-keyshortcuts={toolShortcut("heritage")}
                data-testid="viewer-heritage"
                data-tour="viewer-heritage"
                disabled={!image}
                data-tooltip={toolTooltip("heritage", "Marca en la imagen un edificio, monumento u obra con un punto o un rectángulo.")}
                onClick={() => toggleViewerTool("heritage")}
              >
                <Landmark size={16} />
                {t("Patrimonio")}
              </button>
              {marking && (
                <>
                  <button
                    type="button"
                    aria-pressed={marking === "point"}
                    className={marking === "point" ? "is-on" : ""}
                    aria-label={t("Punto")}
                    data-tooltip={t("Punto: haz clic sobre el elemento")}
                    data-testid="viewer-heritage-point"
                    onClick={() => setMarking("point")}
                  >
                    <Crosshair size={15} />
                  </button>
                  <button
                    type="button"
                    aria-pressed={marking === "rect"}
                    className={marking === "rect" ? "is-on" : ""}
                    aria-label={t("Rectángulo")}
                    data-tooltip={t("Rectángulo: arrastra alrededor del elemento")}
                    data-testid="viewer-heritage-rect"
                    onClick={() => setMarking("rect")}
                  >
                    <Square size={15} />
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              className={`viewer-annotate ${tagging ? "is-on" : ""}`}
              aria-pressed={tagging}
              aria-keyshortcuts={toolShortcut("tags")}
              data-testid="viewer-tagging"
              data-tooltip={toolTooltip("tags", "Arrastra sobre la imagen para marcar un elemento y elige una o varias etiquetas.")}
              disabled={!image}
              onClick={() => toggleViewerTool("tags")}
            >
              <Tags size={16} />
              {t("Etiquetado")}
            </button>
            <button
              type="button"
              ref={layerTrigger}
              className="viewer-annotate viewer-layers-trigger"
              aria-haspopup="dialog"
              aria-expanded={layersOpen}
              data-testid="viewer-layers"
              onClick={() => setLayersOpen((open) => !open)}
            >
              <Layers size={16} aria-hidden="true" />
              {t("Capas")}
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {layersOpen && (
              <CriteriaPopover
                anchor={layerTrigger}
                onClose={() => setLayersOpen(false)}
                width={210}
                label={t("Capas")}
                className="viewer-layers-menu"
              >
                {layers.map(({ id, label, shown, toggle, tooltip, disabled }, index) => (
                  <button
                    key={id}
                    ref={index === 0 ? firstLayer : undefined}
                    type="button"
                    aria-pressed={shown}
                    disabled={disabled}
                    data-tooltip={t(tooltip)}
                    data-testid={id}
                    onClick={toggle}
                  >
                    <span>{t(label)}</span>
                    {shown ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
                  </button>
                ))}
              </CriteriaPopover>
            )}
            <button
              type="button"
              ref={inspectTrigger}
              className={`viewer-annotate ${inspect !== "none" ? "is-on" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={inspectOpen}
              data-testid="viewer-inspect"
              data-tooltip={t("Otras formas de mirar la imagen (más contraste, negativo, bordes…). Solo mientras la ves: no se guarda nada.")}
              disabled={!image || !!cropping}
              onClick={() => setInspectOpen((open) => !open)}
            >
              {/* While the view is prepared the spinner takes the icon's place: the button keeps its size. */}
              {inspectBusy ? <span className="viewer-inspect-busy" aria-hidden="true" /> : <Microscope size={16} aria-hidden="true" />}
              {t("Inspeccionar")}
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {inspectOpen && (
              <CriteriaPopover anchor={inspectTrigger} onClose={() => setInspectOpen(false)} width={250} label={t("Inspeccionar")} className="viewer-layers-menu viewer-inspect-menu">
                {INSPECT_MODES.map(([mode, label, tooltip]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={inspect === mode}
                    data-tooltip={t(tooltip)}
                    data-testid={`viewer-inspect-${mode}`}
                    onClick={() => setInspect(mode)}
                  >
                    <span>{t(label)}</span>
                    {inspect === mode && <Check size={15} aria-hidden="true" />}
                  </button>
                ))}
                {onWorkshop && image && (
                  <button type="button" className="viewer-inspect-workshop" onClick={() => onWorkshop(image.id)} data-testid="viewer-open-workshop">
                    <span>{t("Tratar en el Taller…")}</span>
                    <SlidersHorizontal size={15} aria-hidden="true" />
                  </button>
                )}
              </CriteriaPopover>
            )}
          </>
        )}
        <span className="viewer-spacer" />
        <button type="button" className="viewer-close" aria-label={t("Cerrar")} data-tooltip={t("Cerrar")} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="viewer-body">
        {/* The image, and under it the strip: the side panel keeps its full height. */}
        <div className="viewer-main">
          <div
            ref={attachStage}
            data-tour="viewer-stage"
            className={`viewer-stage ${annotating || marking || drawingZone || searchMode || tagging ? "is-annotating" : ""} ${cropping ? "is-cropping" : ""}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={() => !annotating && !marking && !cropping && !tagging && zoom(2)}
          >
            {image && (
              <img
                key={imageSrc}
                ref={imageElement}
                className="viewer-image"
                src={imageSrc}
                alt={row.title}
                draggable={false}
                onLoad={(event) => {
                  setLoadFailed(false);
                  setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight });
                }}
                onError={() => setLoadFailed(true)}
                style={
                  natural
                    ? { width: natural.w * view.scale, height: natural.h * view.scale, transform: `translate(${view.x}px, ${view.y}px)`, filter: inspectFilter }
                    : { visibility: "hidden" }
                }
              />
            )}
            {image && natural && !cropping && inspectView && inspectView.key === inspectKey && (
              <img
                className="viewer-image viewer-inspect-layer"
                src={inspectView.url}
                alt=""
                draggable={false}
                style={{ width: natural.w * view.scale, height: natural.h * view.scale, transform: `translate(${view.x}px, ${view.y}px)` }}
              />
            )}
            {!natural && !loadFailed && thumbSrc && (
              <img
                key={thumbSrc}
                className="viewer-image-placeholder"
                src={thumbSrc}
                alt=""
                draggable={false}
                onLoad={() => setLoadedThumb(thumbSrc)}
              />
            )}
            {image && !natural && (loadFailed || !thumbSrc || loadedThumb !== thumbSrc) && (
              <div className="viewer-loading" role="status" data-testid="viewer-loading">
                {loadFailed ? (
                  <>
                    <ImageOff size={22} />
                    {t("No se ha podido cargar la imagen.")}
                    {cropping && (
                      <button type="button" className="viewer-annotate" onClick={cancelCrop}>
                        {t("Cancelar")}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <Spinner />
                    {t(cropping ? "Preparando la imagen completa…" : "Cargando la imagen…")}
                  </>
                )}
              </div>
            )}
            {cropping && natural && (
              <div className="crop-frame" style={box(cropping)} data-grip="move" data-testid="viewer-crop-frame">
                {GRIPS.map((grip) => (
                  <span key={grip} className={`crop-grip is-${grip}`} data-grip={grip} />
                ))}
              </div>
            )}
            {!cropping && showNotes && notes.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`viewer-region ${selected === a.id ? "is-selected" : ""}`}
                style={{ ...box(a), "--region": a.color ?? COLORS[0] } as unknown as React.CSSProperties}
                data-tooltip={[a.note, a.tags.join(", ")].filter(Boolean).join(" · ") || t("Sin nota")}
                aria-label={a.note || t("Anotación")}
                onClick={() => {
                  activateSideTab("annotations");
                  setSelected(a.id);
                  requestAnimationFrame(() => document.getElementById(`annotation-${a.id}`)?.scrollIntoView({ block: "nearest" }));
                }}
              >
                <span className="viewer-annotation-icon" aria-hidden="true">
                  <MessageSquare size={12} />
                </span>
              </button>
            ))}
            {!cropping &&
              showNotes &&
              shownMarks.map((m) => {
                const e = heritageElements[m.optionId!];
                const icon = heritageColumn && typology(heritageScheme(heritageColumn.config), e?.group ?? null, e?.type ?? null)?.icon;
                const label = heritageColumn?.options.find((o) => o.id === m.optionId)?.label ?? "";
                const at = box(m) as { left?: number; top?: number };
                return m.kind === "point" ? (
                  <button
                    key={m.id}
                    type="button"
                    className={`viewer-mark ${selected === m.id ? "is-selected" : ""}`}
                    style={natural ? { left: at.left, top: at.top } : { display: "none" }}
                    aria-label={label}
                    data-tooltip={label}
                    onClick={() => {
                      activateSideTab("heritage");
                      setSelected(m.id);
                    }}
                  >
                    <HeritageIcon name={icon} size={13} />
                  </button>
                ) : (
                  <button
                    key={m.id}
                    type="button"
                    className={`viewer-region is-heritage ${selected === m.id ? "is-selected" : ""}`}
                    style={box(m)}
                    aria-label={label}
                    data-tooltip={label}
                    onClick={() => {
                      activateSideTab("heritage");
                      setSelected(m.id);
                    }}
                  >
                    <span className="viewer-mark-label">
                      <HeritageIcon name={icon} size={11} /> {label}
                    </span>
                  </button>
                );
              })}
            {!cropping &&
              tagsReady &&
              showTags &&
              tagRegions.map((r) => {
                if (tagPreview?.draft.id === r.id) return null;
                const editing = showTagDraft && showTagDraft.id === r.id;
                const tags = editing ? draftTags : describeTags(r.optionIds.map((optionId) => ({ optionId })));
                const chosen = tagging && tagSelected === r.id;
                return (
                  <div
                    key={r.id}
                    data-tag-region={r.id}
                    data-testid="viewer-tag-region"
                    className={`viewer-tag${chosen ? " is-selected" : ""}${tagging ? " is-live" : ""}${editing ? " is-retagging" : ""}${tags.length > 1 ? " is-multicolor" : ""}`}
                    style={{ ...box(r), ...tagBoxColors(tags) }}
                    aria-label={tags.map((tag) => tag.label).join(", ")}
                  >
                    <TagLabels tags={tags} />
                    {chosen && !tagDraft && GRIPS.map((grip) => <span key={grip} className={`crop-grip is-${grip}`} data-grip={grip} />)}
                    {chosen && !tagDraft && (
                      <span className="viewer-tag-tools">
                        <button
                          type="button"
                          aria-label={t("Editar etiquetas")}
                          data-tooltip={t("Editar etiquetas")}
                          data-testid="viewer-tag-retag"
                          onClick={() => editRegionTags(r)}
                        >
                          <Tag size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={t("Eliminar la región")}
                          data-tooltip={t("Eliminar la región (Supr)")}
                          data-testid="viewer-tag-delete"
                          onClick={() => void removeTag(r.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            {!cropping && showTags && tagPreview && (
              <div
                className={`viewer-tag${tagPreview.tags.length > 1 ? " is-multicolor" : ""}`}
                data-testid="viewer-tag-region"
                aria-busy="true"
                style={{ ...box(tagPreview.draft), ...tagBoxColors(tagPreview.tags) }}
              >
                <TagLabels tags={tagPreview.tags} />
              </div>
            )}
            {showTagDraft && !showTagDraft.id && (
              <div
                className={`viewer-tag${draftTags.length ? "" : " is-drawing"}${draftTags.length > 1 ? " is-multicolor" : ""}`}
                style={{ ...box(showTagDraft), ...tagBoxColors(draftTags) }}
              >
                <TagLabels tags={draftTags} />
              </div>
            )}
            {showTagDraft && natural && image && (
              <div
                className="viewer-tag-picker"
                style={pickerAt(showTagDraft)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <OptionPicker
                  column={tagColumn ?? { id: "", databaseId: row.databaseId, name: "", type: "multi_select", position: 0, config: {}, options: [] }}
                  selected={showTagDraft.choices.flatMap((choice) => "optionId" in choice ? [choice.optionId] : [])}
                  busy={false}
                  onToggle={() => {}}
                  onOptionsChanged={() => {
                    void loadTags();
                    window.dispatchEvent(new CustomEvent("imago:reload-detail"));
                    onChanged();
                  }}
                  floating={{
                    placeholder: t(draftTags.length ? "Otra etiqueta…" : "Buscar o crear etiqueta…"),
                    optionIds: tagOptionIds,
                    tags: draftTags,
                    error,
                    extra: tagDictionary ? { title: t("Del diccionario «{name}»").replace("{name}", tagDictionary.name), column: tagDictionary } : undefined,
                    onPick: (optionId) => pickTag({ optionId }),
                    onCreate: (label) => pickTag({ label }),
                    onRemove: removeDraftTag,
                    onSave: saveTagDraft,
                    onClose: () => {
                      setError(null);
                      setTagDraft(null);
                    },
                  }}
                />
              </div>
            )}
            {tagging && tagsReady && !tagRegions.length && !pending && !tagDraft && !tagPreview && (
              <p className="viewer-hint">{t("Arrastra sobre la imagen alrededor de un elemento para etiquetarlo.")}</p>
            )}
            {sideTab === "heritage" && !searching && markDraft?.kind === "point" && natural && (
              <span className="viewer-mark is-drawing" style={box(markDraft) as React.CSSProperties} />
            )}
            {sideTab === "heritage" && !searching && markDraft?.kind === "rect" && <div className="viewer-region is-drawing is-heritage" style={box(markDraft)} />}
            {pending && <div className="viewer-region is-drawing" style={box(pending)} />}
            {searching?.drawn && !cropping && (
              <div className="viewer-ai-zone is-search" style={box(searching)} data-testid="viewer-search-box">
                <ScanSearch size={12} />
              </div>
            )}
            {searchMode && !searching && !pending && (
              <p className="viewer-hint">{t("Arrastra sobre la imagen un recuadro alrededor de lo que quieres buscar.")}</p>
            )}
            {sideTab === "heritage" && !heritagePanel &&
              !searching &&
              aiZones.map((z, i) => (
                <div key={i} className="viewer-ai-zone" style={box(z)}>
                  <b>{i + 1}</b>
                </div>
              ))}
            {annotating && !notes.length && !pending && (
              <p className="viewer-hint">{t("Arrastra sobre la imagen para marcar la primera zona.")}</p>
            )}
          </div>
        {browse && onBrowse && stripShown && !cropping && (
          <ViewerStrip
            browse={browse}
            items={stripItems}
            currentRowId={row.id}
            currentAssetId={imageId}
            pendingOnly={pendingOnly}
            onPendingChange={setPendingOnly}
            before={strip.before}
            after={strip.after}
            ready={strip.ready}
            onRetry={strip.retry}
            onOpen={openBrowseItem}
            onStep={(direction) => void stepRecord(direction)}
            canStep={(direction) => strip.canStep(direction, index)}
            onMore={strip.more}
          />
        )}
        </div>
        <aside ref={sidebar} className={`viewer-side${searching ? " is-searching" : ""}`} data-testid="viewer-annotations">
          {searching && (
            <DetailSearchPanel
              query={searching}
              databaseId={row.databaseId}
              backLabel={t(searching.drawn ? "Cerrar la búsqueda" : "Volver a las anotaciones")}
              onBack={() => {
                setSearching(null);
                setSearchMode(false);
              }}
              onOpenRecord={
                onOpenRecord &&
                ((rowId) => {
                  onClose();
                  onOpenRecord(rowId);
                })
              }
              onCompare={
                onCompare &&
                ((ids) => {
                  onClose();
                  onCompare(ids);
                })
              }
              onChanged={onChanged}
            >
              {searching.drawn && image && (
                <div className="detail-query">
                  <Crop annotation={searching} imageId={image.id} revision={image.revision} ratio={ratio} />
                  <small>{t("Dibuja otro recuadro sobre la imagen para buscar otra cosa.")}</small>
                </div>
              )}
            </DetailSearchPanel>
          )}
          {!searching && (
            <div
              className="viewer-side-tabs"
              role="tablist"
              aria-label={t("Secciones del visor")}
              onKeyDown={(event) => {
                const index = VIEWER_SIDE_TABS.findIndex(({ id }) => id === sideTab);
                const last = VIEWER_SIDE_TABS.length - 1;
                let next: number;
                switch (event.key) {
                  case "ArrowLeft": next = index === 0 ? last : index - 1; break;
                  case "ArrowRight": next = index === last ? 0 : index + 1; break;
                  case "Home": next = 0; break;
                  case "End": next = last; break;
                  default: return;
                }
                event.preventDefault();
                event.stopPropagation();
                activateSideTab(VIEWER_SIDE_TABS[next].id);
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
              }}
            >
              {VIEWER_SIDE_TABS.map(({ id, label, icon: Icon }) => {
                const active = sideTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    id={`${sideId}-tab-${id}`}
                    role="tab"
                    aria-label={t(label)}
                    aria-selected={active}
                    aria-controls={`${sideId}-panel-${id}`}
                    data-tooltip={t(label)}
                    tabIndex={active ? 0 : -1}
                    onClick={() => activateSideTab(id)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {active && <span>{t(label)}</span>}
                    {active && sideCounts[id] !== null && <span className="viewer-side-tab-count">{sideCounts[id]}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <section
            id={`${sideId}-panel-tags`}
            className="viewer-side-panel viewer-tagging"
            role="tabpanel"
            aria-labelledby={`${sideId}-tab-tags`}
            aria-busy={!!image && !tagsReady}
            tabIndex={0}
            data-testid="viewer-tag-panel"
            hidden={!!searching || sideTab !== "tags"}
          >
            <p className="viewer-empty">
              {t("Clasifica lo que aparece en la foto con etiquetas del diccionario. Pulsa «Etiquetado» y arrastra sobre una parte de la imagen para marcar una región; cada región puede tener varias etiquetas.")}
            </p>
            {image && (
              <>
                <section className="viewer-tag-section" aria-labelledby={`${sideId}-dictionary-title`}>
                  <h3 id={`${sideId}-dictionary-title`}>{t("Diccionario")}</h3>
                  <div className="viewer-tag-dictionary-row">
                    <select
                      aria-labelledby={`${sideId}-dictionary-title`}
                      value={(switchingDictionary ? nextDictionaryId : dictionaryId) ?? ""}
                      disabled={!dictionaryChoices.length || switchingDictionary || !!tagDraft}
                      data-testid="viewer-tag-dictionary"
                      onChange={(e) => void changeDictionary(e.target.value || null)}
                    >
                      <option value="">{t("Sin diccionario")}</option>
                      {dictionaryChoices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.options.length})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="viewer-review viewer-tag-undo"
                      data-testid="viewer-tag-undo"
                      aria-label={t("Deshacer el último cambio de etiquetado (⌘Z / Ctrl+Z)")}
                      aria-keyshortcuts="Meta+Z Control+Z"
                      data-tooltip={t("Deshacer el último cambio de etiquetado (⌘Z / Ctrl+Z)")}
                      aria-disabled={!tagsReady || undefined}
                      disabled={!canUndoTag || undoingTag || !!tagDraft || !!tagPreview}
                      onClick={() => void undoTag()}
                    >
                      <Undo2 size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="viewer-review viewer-tag-undo"
                      data-testid="viewer-tag-redo"
                      aria-label={t("Rehacer el último cambio de etiquetado deshecho (⇧⌘Z / Ctrl+Y)")}
                      aria-keyshortcuts="Meta+Shift+Z Control+Y"
                      data-tooltip={t("Rehacer el último cambio de etiquetado deshecho (⇧⌘Z / Ctrl+Y)")}
                      aria-disabled={!tagsReady || undefined}
                      disabled={!canRedoTag || undoingTag || !!tagDraft || !!tagPreview}
                      onClick={() => void undoTag("redo")}
                    >
                      <Redo2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </section>
                <section className="viewer-tag-section" aria-labelledby={`${sideId}-assigned-tags-title`} ref={setTagContentInert}>
                  <h3 id={`${sideId}-assigned-tags-title`}>{t("Etiquetas")}</h3>
                  {tagListImage && tagRegions.length > 0 && tagColumn && (
                    <div className="viewer-tag-counts" data-testid="viewer-tag-counts">
                      {Object.entries(
                        tagRegions.flatMap((r) => r.optionIds).reduce<Record<string, number>>((all, optionId) => {
                          all[optionId] = (all[optionId] ?? 0) + 1;
                          return all;
                        }, {}),
                      )
                        .sort((a, b) => b[1] - a[1])
                        .map(([optionId, n]) => {
                          const option = tagColumn.options.find((o) => o.id === optionId);
                          return (
                            <span key={optionId} className="chip" style={{ "--chip": option?.color ?? DEFAULT_OPTION_COLOR } as React.CSSProperties}>
                              <OptionIcon value={optionIconValue(tagColumn.config, optionId)} size={11} />
                              {option?.label}
                              {n > 1 && <b className="visual-tags-count">×{n}</b>}
                            </span>
                          );
                        })}
                    </div>
                  )}
                  {tagListImage && tagRegions.length > 0 && (
                    <ul className="viewer-list">
                      {tagRegions.map((r) => {
                        const tags = describeTags(r.optionIds.map((optionId) => ({ optionId })));
                        return (
                          <li key={r.id} className={tagSelected === r.id ? "is-selected" : ""}>
                            <button
                              type="button"
                              className="viewer-item"
                              onClick={() => {
                                setTagSelected(r.id);
                                focus(r);
                              }}
                            >
                              <Crop annotation={{ ...r, color: tags[0]?.color ?? DEFAULT_OPTION_COLOR }} imageId={tagListImage.id} revision={tagListImage.revision} ratio={tagListRatio} />
                              <span className="viewer-item-text">
                                {tags.map(({ key, label, color, icon }) => (
                                  <span key={key} className="viewer-tag-name" style={{ "--chip": color } as React.CSSProperties}>
                                    <OptionIcon value={icon} size={11} /> {label}
                                  </span>
                                ))}
                                {r.source !== "manual" && <small>{t("Propuesta automática")}</small>}
                              </span>
                            </button>
                            <span className="viewer-item-actions">
                              <button type="button" aria-label={t("Editar etiquetas")} data-tooltip={t("Editar etiquetas")} disabled={!!tagDraft || !!tagPreview} onClick={() => editRegionTags(r)}>
                                <Tag size={13} />
                              </button>
                              <button type="button" aria-label={t("Eliminar la región")} data-tooltip={t("Eliminar la región")} onClick={() => void removeTag(r.id)}>
                                <Trash2 size={13} />
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {tagViewImage && !tagRegions.length && (
                    <>
                      <p className="viewer-empty">
                        {t(tagging
                          ? "Arrastra sobre la imagen para marcar un elemento y elige una o varias etiquetas."
                          : "Esta imagen aún no tiene etiquetas.")}
                      </p>
                      <button
                        type="button"
                        className={`viewer-review ${reviewed ? "is-on" : ""}`}
                        aria-pressed={reviewed}
                        data-testid="viewer-tag-review"
                        onClick={() => void toggleReviewed()}
                      >
                        <CheckCheck size={14} />
                        {t(reviewed ? "Revisada, sin elementos · deshacer" : "Marcar como revisada, sin elementos")}
                      </button>
                    </>
                  )}
                  {error && !tagDraft && <p className="error">{t(error)}</p>}
                </section>
                <section className="viewer-tag-section" aria-labelledby={`${sideId}-suggest-tags-title`} ref={setTagContentInert}>
                  <h3 id={`${sideId}-suggest-tags-title`}>{t("Sugerir con IA")}</h3>
                  <VisualTagSuggestions
                    key={JSON.stringify([image.id, image.revision, dictionaryId])}
                    assetId={image.id}
                    dictionary={tagDictionary}
                    catalogue={tagCatalogue}
                    onModelChange={setVisionModel}
                    onApplied={async () => {
                      setPendingRevision((revision) => revision + 1);
                      await loadTags();
                      window.dispatchEvent(new CustomEvent("imago:reload-detail"));
                      onChanged();
                    }}
                    onPreview={focus}
                    describe={(optionIds) => describeTags(optionIds.map((optionId) => ({ optionId })))}
                    queueNext={browse || index < row.images.length - 1 ? queueTagAnalysis : undefined}
                    thumbnail={(region, color) => <Crop annotation={{ ...region, color }} imageId={image.id} revision={image.revision} ratio={ratio} />}
                    active={tagsReady && sideTab === "tags" && !searching}
                    stage={stageElement}
                    showBoxes={tagsReady && !!natural && showTags && sideTab === "tags" && !cropping && !searching && !tagDraft}
                    position={box}
                    point={point}
                    reshape={(region, grip, dx, dy, from) => dragCrop(region, grip, dx, dy, from, 0.004)}
                    undoVersion={suggestionsUndo}
                  />
                </section>
              </>
            )}
          </section>
          <section
            id={`${sideId}-panel-heritage`}
            className="viewer-side-panel viewer-tagging"
            role="tabpanel"
            aria-labelledby={`${sideId}-tab-heritage`}
            aria-busy={heritageDictionaryBusy}
            tabIndex={0}
            hidden={!!searching || sideTab !== "heritage"}
          >
            <p className="viewer-empty">
              {t("Identifica edificios, monumentos u obras en la foto y vincúlalos a la ficha. Pulsa «Patrimonio» y márcalos en la imagen con un punto o un rectángulo.")}
            </p>
            <section className="viewer-tag-section" aria-labelledby={`${sideId}-heritage-dictionary-title`}>
              <h3 id={`${sideId}-heritage-dictionary-title`}>{t("Diccionario")}</h3>
              <div className="viewer-tag-dictionary-row">
                <select aria-labelledby={`${sideId}-heritage-dictionary-title`}
                  value={heritageColumn?.id ?? ""} data-testid="viewer-heritage-dictionary"
                  disabled={heritageDictionaryBusy || !!markDraft}
                  onChange={(event) => void chooseHeritageDictionary(event.target.value || null)}>
                  {!heritageColumn && <option value="">{t("Crear propiedad de patrimonio")}</option>}
                  {heritageColumns.map((column) => (
                    <option key={column.id} value={column.id}>{column.name} ({heritageDictionaryOptions(column, columns ?? []).length})</option>
                  ))}
                  {currentHeritage && !heritageColumns.some((column) => column.id === currentHeritage.id) && (
                    <option value={currentHeritage.id}>{currentHeritage.name} ({heritageDictionary.length})</option>
                  )}
                  <optgroup label={t("Propiedades de selección")}>
                    {dictionaryChoices.filter((source) => !heritageColumns.some((column) => column.config.heritageSource === source.id)).map((source) => (
                      <option key={source.id} value={source.id}>{source.name} ({source.options.length})</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              {!heritageColumn && !heritageDictionaryBusy && (
                <Button type="button" onClick={() => void chooseHeritageDictionary(null)}>{t("Crear propiedad de patrimonio")}</Button>
              )}
            </section>
            {heritageColumn && image && heritagePanel ? (
              <HeritagePropagatePanel
                column={heritageColumn}
                optionId={heritagePanel.optionId}
                assetId={image.id}
                mark={heritageMarks.find((m) => m.id === heritagePanel.markId && m.kind !== "point") ??
                  heritageMarks.find((m) => m.optionId === heritagePanel.optionId && m.kind !== "point") ?? null}
                databaseId={row.databaseId}
                onBack={() => setHeritagePanel(null)}
                onAdded={() => onChanged()}
              />
            ) : heritageColumn && image && (
              <>
                <section className="viewer-tag-section" aria-labelledby={`${sideId}-heritage-elements-title`}>
                  <h3 id={`${sideId}-heritage-elements-title`}>{t("Elementos de patrimonio")}</h3>
                  <HeritageMarksPanel
                    onPropagate={(optionId, markId) => {
                      setDrawingZone(false);
                      setHeritagePanel({ optionId, markId });
                    }}
                    column={heritageColumn}
                    dictionary={heritageDictionary}
                    inCell={inCell}
                    marks={heritageMarks}
                    draft={markDraft}
                    selected={selected}
                    onChoose={(id) => void saveMark(id)}
                    onCreate={(label) => void createElement(label)}
                    onCancel={() => setMarkDraft(null)}
                    target={marking && markTarget ? { optionId: markTarget, kind: marking } : null}
                    onMark={(optionId, kind) => {
                      if (!image || cropping) return;
                      if (!marking) toggleViewerTool("heritage");
                      setMarking(kind);
                      setMarkDraft(null);
                      setSelected(null);
                      setMarkTarget(optionId);
                    }}
                    onCancelTarget={() => setMarkTarget(null)}
                    onFocus={(m) => {
                      setSelected(m.id);
                      focus(m.kind === "point" ? { x: m.x - 0.05, y: m.y - 0.05, w: 0.1, h: 0.1 } : m);
                    }}
                    onDelete={(m) => void removeMark(m)}
                    thumbnail={(region) => <Crop annotation={region} imageId={image.id} revision={image.revision} ratio={ratio} />}
                  />
                </section>
                <section className="viewer-tag-section" aria-labelledby={`${sideId}-heritage-suggest-title`}>
                  <h3 id={`${sideId}-heritage-suggest-title`}>{t("Sugerir con IA")}</h3>
                  <HeritageSuggestPanel
                    key={JSON.stringify([image.id, image.revision, heritageColumn.id, heritageColumn.config.heritageSource])}
                    column={heritageColumn}
                    assetId={image.id}
                    dictionarySize={heritageDictionary.length}
                    inCell={inCell}
                    marks={heritageMarks}
                    active={!searching && sideTab === "heritage"}
                    model={visionModel}
                    onModelChange={setVisionModel}
                    allowNew={allowNewHeritage}
                    onAllowNewChange={setAllowNewHeritage}
                    zones={aiZones}
                    drawing={drawingZone}
                    onDraw={(on) => {
                      if (on) {
                        setAnnotating(false);
                        setMarking(null);
                        setMarkDraft(null);
                        setSearchMode(false);
                      }
                      setDrawingZone(on);
                    }}
                    onRemoveZone={(i) => setAiZones((all) => all.filter((_, j) => j !== i))}
                    onAdded={async () => {
                      await load();
                      window.dispatchEvent(new CustomEvent("imago:reload-detail"));
                      onChanged();
                    }}
                    onPreview={focus}
                    thumbnail={(region) => <Crop annotation={region} imageId={image.id} revision={image.revision} ratio={ratio} />}
                    stage={stageElement}
                    showBoxes={!!natural && sideTab === "heritage" && !cropping && !searching && !markDraft && !marking && !drawingZone}
                    position={box}
                    point={point}
                    reshape={(region, grip, dx, dy, from) => dragCrop(region, grip, dx, dy, from, 0.005)}
                  />
                </section>
              </>
            )}
            {error && <p className="error">{t(error)}</p>}
          </section>
          <div
            id={`${sideId}-panel-annotations`}
            className="viewer-side-panel"
            role="tabpanel"
            aria-labelledby={`${sideId}-tab-annotations`}
            tabIndex={0}
            data-tour="viewer-annotations"
            hidden={!!searching || sideTab !== "annotations"}
          >
            {draft && (
              <AnnotationEditor
                draft={draft}
                known={known}
                imageId={image?.id}
                revision={image?.revision}
                ratio={ratio}
                error={error}
                onChange={setDraft}
                onSave={() => void save()}
                onCancel={() => {
                  setDraft(null);
                  setError(null);
                }}
              />
            )}
            {!notes.length && !draft && (
              <p className="viewer-empty">
                {t("Esta imagen no tiene anotaciones. Pulsa «Anotar» y arrastra sobre una parte de la imagen (una persona, una inscripción, un edificio) para describirla. Las notas se incluyen en la búsqueda.")}
              </p>
            )}
            <ul className="viewer-list">
              {notes
                .filter((a) => a.id !== draft?.id)
                .map((a) => (
                  <li key={a.id} id={`annotation-${a.id}`} className={selected === a.id ? "is-selected" : ""}>
                    <button
                      type="button"
                      className="viewer-item"
                      onClick={() => {
                        setSelected(a.id);
                        focus(a);
                      }}
                    >
                      <Crop annotation={a} imageId={image!.id} revision={image!.revision} ratio={ratio} />
                      <span className="viewer-item-text">
                        <span>{a.note || <em>{t("Sin nota")}</em>}</span>
                        {a.tags.length > 0 && (
                          <span className="viewer-tags">
                            {a.tags.map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </span>
                        )}
                      </span>
                    </button>
                    <span className="viewer-item-actions">
                      <button
                        type="button"
                        aria-label={t("Buscar este detalle")}
                        data-tooltip={t("Buscar este detalle en las demás imágenes")}
                        data-testid="annotation-search"
                        onClick={() => setSearching(a)}
                      >
                        <ScanSearch size={13} />
                      </button>
                      <button type="button" aria-label={t("Editar")} data-tooltip={t("Editar")} onClick={() => setDraft({ ...a })}>
                        <Pencil size={13} />
                      </button>
                      <button type="button" aria-label={t("Eliminar")} data-tooltip={t("Eliminar")} onClick={() => void remove(a)}>
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </aside>
      </div>
    </dialog>
  );
}

/** The region cut out of the preview, at the size of a list thumbnail. */
function Crop({
  annotation: a,
  imageId,
  revision,
  ratio,
}: {
  annotation: { x: number; y: number; w: number; h: number; color?: string | null };
  imageId: string;
  revision?: string;
  /** Width / height of the image. */
  ratio: number;
}) {
  const aspect = (a.w * ratio) / a.h,
    max = 64;
  // Every thumbnail sits in the same square, so the text beside it always
  // starts at the same place whatever the shape of the region.
  return (
    <span className="viewer-crop-slot">
    <span
      className="viewer-crop"
      style={{
        width: aspect >= 1 ? max : max * aspect,
        height: aspect >= 1 ? max / aspect : max,
        backgroundImage: `url("${src(imageId, revision)}")`,
        backgroundSize: `${100 / a.w}% ${100 / a.h}%`,
        backgroundPosition: `${a.w < 1 ? (a.x / (1 - a.w)) * 100 : 0}% ${a.h < 1 ? (a.y / (1 - a.h)) * 100 : 0}%`,
        borderColor: a.color ?? undefined,
      }}
    />
    </span>
  );
}

function AnnotationEditor({
  draft,
  known,
  imageId,
  revision,
  ratio,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  known: string[];
  imageId?: string;
  revision?: string;
  ratio: number;
  error: string | null;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [tag, setTag] = useState("");
  const add = (value: string) => {
    const clean = value.replace(/,$/, "").trim();
    if (clean && !draft.tags.some((x) => x.toLowerCase() === clean.toLowerCase())) onChange({ ...draft, tags: [...draft.tags, clean] });
    setTag("");
  };
  const suggestions = tag.trim()
    ? known.filter((k) => k.toLowerCase().includes(tag.trim().toLowerCase()) && !draft.tags.includes(k)).slice(0, 6)
    : [];
  return (
    <form
      className="annotation-editor"
      data-testid="annotation-editor"
      data-tour="annotation-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (tag.trim()) add(tag);
        onSave();
      }}
    >
      {imageId && <Crop annotation={draft} imageId={imageId} revision={revision} ratio={ratio} />}
      <label>
        {t("Nota")}
        <textarea
          autoFocus
          rows={3}
          value={draft.note}
          placeholder={t("Qué se ve en esta zona: persona, inscripción, edificio, objeto…")}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </label>
      <label>
        {t("Etiquetas")}
        <span className="annotation-tags">
          {draft.tags.map((x) => (
            <button key={x} type="button" aria-label={`${t("Quitar")} ${x}`} onClick={() => onChange({ ...draft, tags: draft.tags.filter((y) => y !== x) })}>
              {x} <X size={11} />
            </button>
          ))}
          <input
            value={tag}
            placeholder={draft.tags.length ? "" : t("Escribe y pulsa Enter")}
            onChange={(event) => (event.target.value.endsWith(",") ? add(event.target.value) : setTag(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && tag.trim()) {
                event.preventDefault();
                add(tag);
              }
              if (event.key === "Backspace" && !tag && draft.tags.length) onChange({ ...draft, tags: draft.tags.slice(0, -1) });
            }}
          />
        </span>
      </label>
      {suggestions.length > 0 && (
        <span className="annotation-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}>
              {s}
            </button>
          ))}
        </span>
      )}
      {error && <p className="annotation-error">{t(error)}</p>}
      <footer>
        <span className="hint">{t("⌘/Ctrl + Enter para guardar")}</span>
        <button type="submit" className="button primary" data-testid="annotation-save">
          {t("Guardar")}
        </button>
        <button type="button" className="button annotation-cancel" onClick={onCancel}>
          {t("Cancelar")}
        </button>
      </footer>
    </form>
  );
}
