// One icon per property type, shown before the name in table headers and in
// the "+" type picker.
import {
  AlignLeft,
  ArrowUpRight,
  AtSign,
  Calendar,
  CalendarClock,
  CheckSquare,
  CircleDot,
  Clock,
  Equal,
  Fingerprint,
  Hash,
  Heading,
  History,
  Image,
  ImagePlus,
  Layers,
  Link,
  List,
  MapPin,
  MousePointerClick,
  Paperclip,
  Phone,
  Scale,
  Sigma,
  Sparkles,
  Text,
  User,
  UserPen,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { DatabaseColumnType } from "../../shared/databases";

const ICONS: Record<DatabaseColumnType, LucideIcon> = {
  title: Heading,
  rich_text: AlignLeft,
  text: Text,
  number: Hash,
  date: Calendar,
  historical_date: History,
  time: Clock,
  select: CircleDot,
  status: CircleDot,
  multi_select: List,
  checkbox: CheckSquare,
  person: Users,
  url: Link,
  email: AtSign,
  phone: Phone,
  location: MapPin,
  files: Paperclip,
  created_by: User,
  last_edited_by: UserPen,
  created_time: CalendarClock,
  last_edited_time: CalendarClock,
  unique_id: Fingerprint,
  button: MousePointerClick,
  attachment: Image,
  ai: Sparkles,
  ai_image: ImagePlus,
  relation: ArrowUpRight,
  rollup: Layers,
  formula: Sigma,
  comparison: Scale,
};

export function ColumnTypeIcon({
  type,
  size = 13,
  className = "column-type-icon",
  ai = false,
}: {
  type: DatabaseColumnType;
  size?: number;
  className?: string;
  /** A selection the AI fills: its own icon with a small AI mark. */
  ai?: boolean;
}) {
  const Icon = ICONS[type] ?? Equal;
  if (!ai) return <Icon size={size} className={className} aria-hidden="true" />;
  return (
    <span className={className + " has-ai"} aria-hidden="true">
      <Icon size={size} />
      <Sparkles size={Math.round(size * 0.7)} className="column-type-ai" />
    </span>
  );
}
