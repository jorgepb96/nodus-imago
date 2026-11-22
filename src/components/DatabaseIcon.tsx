// Drawn icons for databases: the icon itself, in its colour, and the picker
// (search, groups and colours) used to choose one.
import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Database,
  Archive,
  Library,
  LibraryBig,
  BookOpen,
  Book,
  BookMarked,
  BookCopy,
  BookText,
  BookImage,
  Notebook,
  NotebookPen,
  Newspaper,
  ScrollText,
  Scroll,
  FileText,
  Files,
  FileImage,
  Folder,
  FolderOpen,
  FolderArchive,
  Box,
  Package,
  Inbox,
  Layers,
  LayoutGrid,
  Table,
  Bookmark,
  Tag,
  Tags,
  Stamp,
  Mail,
  Mails,
  Paperclip,
  Image,
  Images,
  Camera,
  Aperture,
  Film,
  Clapperboard,
  Video,
  ScanLine,
  Frame,
  Focus,
  Palette,
  Brush,
  Paintbrush,
  PenTool,
  Pencil,
  Eye,
  Sparkles,
  Contrast,
  SunMedium,
  Map,
  MapPin,
  MapPinned,
  Globe,
  Earth,
  Compass,
  Navigation,
  Mountain,
  MountainSnow,
  Trees,
  TreePine,
  Waves,
  Sailboat,
  Ship,
  Anchor,
  Plane,
  Train,
  TrainFront,
  Car,
  Bus,
  Bike,
  Tent,
  Castle,
  Church,
  Landmark,
  Building,
  Building2,
  House,
  Hotel,
  Factory,
  Warehouse,
  Store,
  Fence,
  Milestone,
  Signpost,
  Route,
  Footprints,
  Luggage,
  Ticket,
  Flag,
  TowerControl,
  User,
  Users,
  UserRound,
  Baby,
  PersonStanding,
  Heart,
  HandHeart,
  Smile,
  Contact,
  IdCard,
  Crown,
  Drama,
  Music,
  Guitar,
  Mic,
  Radio,
  Tv,
  Trophy,
  Medal,
  Calendar,
  CalendarDays,
  Clock,
  Hourglass,
  History,
  Timer,
  Sunrise,
  Sunset,
  Watch,
  GraduationCap,
  School,
  Microscope,
  FlaskConical,
  Atom,
  Brain,
  Lightbulb,
  Quote,
  Languages,
  Telescope,
  Binoculars,
  Scale,
  Gavel,
  Shield,
  Swords,
  Key,
  Lock,
  Gem,
  Coins,
  Banknote,
  Briefcase,
  Glasses,
  Leaf,
  Flower,
  Flower2,
  Sprout,
  Bird,
  Fish,
  Bug,
  Cat,
  Dog,
  Rabbit,
  Squirrel,
  Shell,
  Feather,
  Cloud,
  CloudRain,
  Snowflake,
  Flame,
  Droplet,
  Zap,
  Star,
  Rainbow,
  Sun,
  Moon,
  Wheat,
  Grape,
  Apple,
  Coffee,
  Wine,
  Utensils,
  Cake,
  Puzzle,
  Shapes,
  Circle,
  Square,
  Triangle,
  Hexagon,
  Diamond,
  Target,
  Rocket,
  Wrench,
  Hammer,
  Shirt,
  Gift,
  Umbrella,
  Lamp,
  Armchair,
  Bed,
  DoorOpen,
  Hash,
  Bell,
  Anvil,
} from "lucide-react";
import {
  DATABASE_ICON_COLORS,
  DATABASE_ICON_GROUPS,
  formatDatabaseIcon,
  parseDatabaseIcon,
  searchDatabaseIcons,
  type DatabaseIconColor,
} from "../../shared/databaseIcons";
import type { DatabaseKind } from "../../shared/databases";
import { useT } from "../i18n";

const ICONS: Record<string, LucideIcon> = {
  Database,
  Archive,
  Library,
  LibraryBig,
  BookOpen,
  Book,
  BookMarked,
  BookCopy,
  BookText,
  BookImage,
  Notebook,
  NotebookPen,
  Newspaper,
  ScrollText,
  Scroll,
  FileText,
  Files,
  FileImage,
  Folder,
  FolderOpen,
  FolderArchive,
  Box,
  Package,
  Inbox,
  Layers,
  LayoutGrid,
  Table,
  Bookmark,
  Tag,
  Tags,
  Stamp,
  Mail,
  Mails,
  Paperclip,
  Image,
  Images,
  Camera,
  Aperture,
  Film,
  Clapperboard,
  Video,
  ScanLine,
  Frame,
  Focus,
  Palette,
  Brush,
  Paintbrush,
  PenTool,
  Pencil,
  Eye,
  Sparkles,
  Contrast,
  SunMedium,
  Map,
  MapPin,
  MapPinned,
  Globe,
  Earth,
  Compass,
  Navigation,
  Mountain,
  MountainSnow,
  Trees,
  TreePine,
  Waves,
  Sailboat,
  Ship,
  Anchor,
  Plane,
  Train,
  TrainFront,
  Car,
  Bus,
  Bike,
  Tent,
  Castle,
  Church,
  Landmark,
  Building,
  Building2,
  House,
  Hotel,
  Factory,
  Warehouse,
  Store,
  Fence,
  Milestone,
  Signpost,
  Route,
  Footprints,
  Luggage,
  Ticket,
  Flag,
  TowerControl,
  User,
  Users,
  UserRound,
  Baby,
  PersonStanding,
  Heart,
  HandHeart,
  Smile,
  Contact,
  IdCard,
  Crown,
  Drama,
  Music,
  Guitar,
  Mic,
  Radio,
  Tv,
  Trophy,
  Medal,
  Calendar,
  CalendarDays,
  Clock,
  Hourglass,
  History,
  Timer,
  Sunrise,
  Sunset,
  Watch,
  GraduationCap,
  School,
  Microscope,
  FlaskConical,
  Atom,
  Brain,
  Lightbulb,
  Quote,
  Languages,
  Telescope,
  Binoculars,
  Scale,
  Gavel,
  Shield,
  Swords,
  Key,
  Lock,
  Gem,
  Coins,
  Banknote,
  Briefcase,
  Glasses,
  Leaf,
  Flower,
  Flower2,
  Sprout,
  Bird,
  Fish,
  Bug,
  Cat,
  Dog,
  Rabbit,
  Squirrel,
  Shell,
  Feather,
  Cloud,
  CloudRain,
  Snowflake,
  Flame,
  Droplet,
  Zap,
  Star,
  Rainbow,
  Sun,
  Moon,
  Wheat,
  Grape,
  Apple,
  Coffee,
  Wine,
  Utensils,
  Cake,
  Puzzle,
  Shapes,
  Circle,
  Square,
  Triangle,
  Hexagon,
  Diamond,
  Target,
  Rocket,
  Wrench,
  Hammer,
  Shirt,
  Gift,
  Umbrella,
  Lamp,
  Armchair,
  Bed,
  DoorOpen,
  Hash,
  Bell,
  Anvil,
};

/** A search shows at most three rows of icons. */
const MAX_RESULTS = 48;

const colorVar = (color: DatabaseIconColor) => (color === "accent" ? "var(--a-500)" : `var(--view-${color})`);

/** A database's icon, in its colour (the kind's icon while none is chosen). */
export function DatabaseIcon({ icon, kind, size = 15 }: { icon?: string | null; kind?: DatabaseKind | null; size?: number }) {
  const choice = parseDatabaseIcon(icon, kind),
    Icon = ICONS[choice.name] ?? Database;
  return (
    <span
      className="database-icon"
      data-icon={choice.name}
      data-color={choice.color}
      style={{ "--database-icon": colorVar(choice.color) } as React.CSSProperties}
      aria-hidden
    >
      <Icon size={size} strokeWidth={1.9} />
    </span>
  );
}

const COLOR_LABEL: Record<DatabaseIconColor, string> = {
  accent: "Color de la interfaz",
  gray: "Gris",
  brown: "Marrón",
  red: "Rojo",
  orange: "Naranja",
  yellow: "Amarillo",
  green: "Verde",
  blue: "Azul",
  purple: "Morado",
  pink: "Rosa",
};

/** Search, choose an icon and its colour; «Restablecer» goes back to the kind's icon. */
export function DatabaseIconPicker({
  value,
  kind,
  onChange,
}: {
  value: string | null;
  kind?: DatabaseKind | null;
  onChange: (value: string | null) => void;
}) {
  const t = useT(),
    [query, setQuery] = useState("");
  const choice = parseDatabaseIcon(value, kind);
  // One group at a time (none needs scrolling); a search looks in all of them.
  const [group, setGroup] = useState(
    () => DATABASE_ICON_GROUPS.find((g) => g.icons.some(([n]) => n === choice.name))?.label ?? DATABASE_ICON_GROUPS[0].label,
  );
  const results = useMemo(() => (query.trim() ? searchDatabaseIcons(query) : null), [query]);
  const shown = results ? results.slice(0, MAX_RESULTS) : (DATABASE_ICON_GROUPS.find((g) => g.label === group)?.icons.map(([n]) => n) ?? []);
  return (
    <div className="database-icon-picker" data-testid="database-icon-picker">
      <div className="database-icon-picker-head">
        <span className="database-icon-preview">
          <DatabaseIcon icon={value} kind={kind} size={22} />
        </span>
        <input
          type="search"
          value={query}
          placeholder={t("Buscar un icono")}
          aria-label={t("Buscar un icono")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="database-icon-reset" disabled={!choice.chosen} onClick={() => onChange(null)}>
          {t("Restablecer")}
        </button>
      </div>
      <div className="database-icon-colors" role="group" aria-label={t("Color del icono")}>
        {DATABASE_ICON_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={"database-icon-color" + (choice.color === color ? " selected" : "")}
            style={{ "--database-icon": colorVar(color) } as React.CSSProperties}
            aria-pressed={choice.color === color}
            aria-label={t(COLOR_LABEL[color])}
            data-tooltip={t(COLOR_LABEL[color])}
            data-testid={`database-icon-color-${color}`}
            onClick={() => onChange(formatDatabaseIcon(choice.name, color))}
          />
        ))}
      </div>
      {!results && (
        <div className="database-icon-groups" role="tablist" aria-label={t("Grupos de iconos")}>
          {DATABASE_ICON_GROUPS.map((g) => (
            <button
              key={g.label}
              type="button"
              role="tab"
              aria-selected={g.label === group}
              className={"database-icon-group" + (g.label === group ? " is-active" : "")}
              onClick={() => setGroup(g.label)}
            >
              {t(g.label)}
            </button>
          ))}
        </div>
      )}
      {shown.length ? (
        <div className="database-icon-grid" role={results ? "list" : "tabpanel"}>
          {shown.map((name) => {
            const Icon = ICONS[name];
            return (
              <button
                key={name}
                type="button"
                className={"database-icon-option" + (choice.chosen && choice.name === name ? " selected" : "")}
                aria-label={name}
                aria-pressed={choice.chosen && choice.name === name}
                data-testid={`database-icon-${name}`}
                style={{ "--database-icon": colorVar(choice.color) } as React.CSSProperties}
                onClick={() => onChange(formatDatabaseIcon(name, choice.color))}
              >
                <Icon size={18} strokeWidth={1.9} />
              </button>
            );
          })}
        </div>
      ) : (
        <p className="hint">{t("Ningún icono coincide con la búsqueda.")}</p>
      )}
      {results && results.length > MAX_RESULTS && <p className="hint">{t("Hay más iconos: afina la búsqueda.")}</p>}
    </div>
  );
}
