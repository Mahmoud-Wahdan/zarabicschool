import {
  ArrowLeftRight, ArrowRight, BookOpenText, Calculator, Scale, Award, BadgeCheck, Banknote, Bell, BellRing, BookOpen, Calendar, CalendarCheck, CalendarCog,
  CalendarDays, CalendarRange, CalendarX, Check, ChevronDown, ChevronUp, Circle, CircleAlert, CircleCheck, CircleCheckBig,
  CirclePlay, CirclePlus, CircleUser, CircleX, ClipboardCheck, ClipboardList, Clock, Coins, CreditCard, ExternalLink, Eye,
  EyeOff, FileText, Flag, FolderOpen, GraduationCap, Hand, Headset, History, Hourglass, House, IdCard, Inbox, Info, KeyRound,
  Landmark, Languages, LayoutDashboard, LayoutGrid, LifeBuoy, ChartLine, ListChecks, LoaderCircle, Lock, LockKeyhole, Mail,
  Megaphone, Menu, MessageCircle, MessageCircleQuestion, MessageSquareText, MessageSquareWarning, MessagesSquare, Mic,
  MousePointerClick, Network, NotebookPen, PenLine, Pencil, Play, Presentation, Receipt, ReceiptText, RefreshCw, ScrollText,
  Search, ShieldCheck, SlidersHorizontal, Sparkles, Speech, Star, TriangleAlert, Tv, User, UserCheck, UserCog, UserPlus, Users,
  UserX, Video, VideoOff, Volume2, Wallet, X, ScreenShare, type LucideIcon,
} from "lucide-react";

/**
 * App icons (L2, owner 2026-10-28). Was the Material Symbols icon FONT: one 3.9 MB
 * woff2 holding every glyph, downloaded on a device's first visit (24–35 s on the
 * owner's PC). Now Lucide SVG components bundled with the app: only the icons listed
 * here ship, nothing is fetched from outside. Pages keep the Material names they
 * already use; `IconName` makes TypeScript reject a name with no mapping.
 */
const ICONS = {
  account_balance_wallet: Wallet,
  add_circle: CirclePlus,
  ads_click: MousePointerClick,
  arrow_forward: ArrowRight,
  assignment_turned_in: ClipboardCheck,
  assignment: ClipboardList,
  auto_awesome: Sparkles,
  auto_stories: BookOpenText,
  autorenew: RefreshCw,
  badge: IdCard,
  balance: Scale,
  calculate: Calculator,
  calendar_month: CalendarDays,
  campaign: Megaphone,
  cancel: CircleX,
  card_membership: CreditCard,
  chat: MessageCircle,
  check_circle: CircleCheck,
  check: Check,
  close: X,
  co_present: Presentation,
  contact_support: MessageCircleQuestion,
  currency_exchange: ArrowLeftRight,
  dashboard: LayoutDashboard,
  date_range: CalendarRange,
  description: FileText,
  done: Check,
  draw: PenLine,
  edit_calendar: CalendarCog,
  edit_note: NotebookPen,
  edit: Pencil,
  error: CircleAlert,
  event_available: CalendarCheck,
  event_busy: CalendarX,
  event: Calendar,
  expand_less: ChevronUp,
  expand_more: ChevronDown,
  fact_check: ListChecks,
  family_restroom: Users,
  feedback: MessageSquareWarning,
  flag: Flag,
  folder_open: FolderOpen,
  forum: MessagesSquare,
  grid_view: LayoutGrid,
  group: Users,
  help_center: LifeBuoy,
  history_edu: ScrollText,
  history: History,
  home: House,
  hourglass_empty: Hourglass,
  hourglass_top: Hourglass,
  how_to_reg: UserCheck,
  hub: Network,
  inbox: Inbox,
  info: Info,
  insights: ChartLine,
  key: KeyRound,
  live_tv: Tv,
  lock_reset: LockKeyhole,
  lock: Lock,
  manage_accounts: UserCog,
  mark_email_unread: Mail,
  menu_book: BookOpen,
  menu: Menu,
  mic: Mic,
  more_time: Clock,
  mosque: Landmark,
  notifications_active: BellRing,
  notifications_none: Bell,
  notifications: Bell,
  open_in_new: ExternalLink,
  payments: Banknote,
  person_add: UserPlus,
  person_off: UserX,
  person_pin: CircleUser,
  person: User,
  play_circle: CirclePlay,
  progress_activity: LoaderCircle,
  radio_button_unchecked: Circle,
  rate_review: MessageSquareText,
  receipt_long: Receipt,
  record_voice_over: Speech,
  report_problem: TriangleAlert,
  request_quote: ReceiptText,
  reviews: MessagesSquare,
  rule: ListChecks,
  schedule: Clock,
  school: GraduationCap,
  screen_share: ScreenShare,
  search: Search,
  star: Star,
  start: Play,
  support_agent: Headset,
  task_alt: CircleCheckBig,
  toll: Coins,
  translate: Languages,
  tune: SlidersHorizontal,
  verified_user: ShieldCheck,
  verified: BadgeCheck,
  video_camera_front: Video,
  videocam_off: VideoOff,
  videocam: Video,
  visibility_off: EyeOff,
  visibility: Eye,
  volume_up: Volume2,
  warning: TriangleAlert,
  waving_hand: Hand,
  workspace_premium: Award,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function isIconName(value: unknown): value is IconName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ICONS, value);
}

/** For icon names that come from data (a subject's icon in the database): unknown -> fallback. */
export function iconOr(value: string | null | undefined, fallback: IconName): IconName {
  return isIconName(value) ? value : fallback;
}

export default function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={2} className={`inline-block shrink-0 ${className}`} aria-hidden="true" focusable="false" />;
}
