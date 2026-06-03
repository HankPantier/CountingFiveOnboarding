// Curated icon set for feature-grid / industry-cards items. KEEP IN SYNC with
// the template's ICON_MAP in counting-five-client-template
// src/components/blocks/Icon.tsx — names not in that map render as a plain
// square on the live site.
import {
  Square,
  Calculator, Briefcase, ChartLine, ChartBar, ChartPie, TrendingUp, TrendingDown,
  FileText, FileCheck, FileSpreadsheet, FileSearch, ClipboardCheck, ClipboardList,
  Coins, DollarSign, Banknote, CreditCard, Wallet, PiggyBank, Receipt,
  Users, User, UserCheck, UserPlus, Building, Building2, Home, MapPin,
  Phone, Mail, MessageCircle, Globe, Compass,
  Check, CheckCircle, CheckSquare, ShieldCheck, Award, Star, Trophy, BadgeCheck,
  Hammer, Wrench, Cog, Settings,
  HeartPulse, Stethoscope, GraduationCap, Scale, Gavel,
  Sun, Lightbulb, Target, Flag, Zap, Sparkles,
  Calendar, Clock, AlarmClock,
  ArrowRight, ArrowUpRight, ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const ICON_COMPONENTS: Record<string, LucideIcon> = {
  Square,
  Calculator, Briefcase, ChartLine, ChartBar, ChartPie, TrendingUp, TrendingDown,
  FileText, FileCheck, FileSpreadsheet, FileSearch, ClipboardCheck, ClipboardList,
  Coins, DollarSign, Banknote, CreditCard, Wallet, PiggyBank, Receipt,
  Users, User, UserCheck, UserPlus, Building, Building2, Home, MapPin,
  Phone, Mail, MessageCircle, Globe, Compass,
  Check, CheckCircle, CheckSquare, ShieldCheck, Award, Star, Trophy, BadgeCheck,
  Hammer, Wrench, Cog, Settings,
  HeartPulse, Stethoscope, GraduationCap, Scale, Gavel,
  Sun, Lightbulb, Target, Flag, Zap, Sparkles,
  Calendar, Clock, AlarmClock,
  ArrowRight, ArrowUpRight, ChevronRight,
}

export const ICON_GROUPS: Array<{ label: string; names: string[] }> = [
  {
    label: 'Finance & accounting',
    names: [
      'Calculator', 'Briefcase', 'ChartLine', 'ChartBar', 'ChartPie', 'TrendingUp', 'TrendingDown',
      'FileText', 'FileCheck', 'FileSpreadsheet', 'FileSearch', 'ClipboardCheck', 'ClipboardList',
      'Coins', 'DollarSign', 'Banknote', 'CreditCard', 'Wallet', 'PiggyBank', 'Receipt',
    ],
  },
  {
    label: 'People & places',
    names: [
      'Users', 'User', 'UserCheck', 'UserPlus', 'Building', 'Building2', 'Home', 'MapPin',
      'Phone', 'Mail', 'MessageCircle', 'Globe', 'Compass',
    ],
  },
  {
    label: 'Trust & credentials',
    names: ['Check', 'CheckCircle', 'CheckSquare', 'ShieldCheck', 'Award', 'Star', 'Trophy', 'BadgeCheck'],
  },
  {
    label: 'Trades & tools',
    names: ['Hammer', 'Wrench', 'Cog', 'Settings'],
  },
  {
    label: 'Verticals',
    names: ['HeartPulse', 'Stethoscope', 'GraduationCap', 'Scale', 'Gavel'],
  },
  {
    label: 'Ideas & motion',
    names: ['Sun', 'Lightbulb', 'Target', 'Flag', 'Zap', 'Sparkles'],
  },
  {
    label: 'Time',
    names: ['Calendar', 'Clock', 'AlarmClock'],
  },
  {
    label: 'Arrows',
    names: ['ArrowRight', 'ArrowUpRight', 'ChevronRight'],
  },
]

export const ICON_NAMES: string[] = ICON_GROUPS.flatMap((g) => g.names)
