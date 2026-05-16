import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Music, History, Settings, PanelLeft, LogOut, Zap, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

const navItems = [
  {
    icon: Music,
    label: "الأدوات",
    path: "/app/tools",
    sub: "معالجة الصوت",
    badge: null,
  },
  {
    icon: History,
    label: "السجل",
    path: "/app/history",
    sub: "الملفات السابقة",
    badge: null,
  },
  {
    icon: Settings,
    label: "الإعدادات",
    path: "/app/settings",
    sub: "التفضيلات",
    badge: null,
  },
];

// ── Smart tips — تدور تلقائياً ───────────────────────────────────────────────
const TIPS = [
  "💡 اسحب الملف مباشرة فوق النافذة",
  "🕌 جرّب وضع الصلاة المبسّط",
  "⌨ Space = تشغيل · ← → = تنقل 5ث",
  "🔇 إعدادات الصمت: -20dB / 5ث أفضل للصلاة",
  "💾 كل تصدير يُحفظ تلقائياً في السجل",
];

function AppSidebar({ user, logout }: { user: any; logout: () => void }) {
  const { isCollapsed, toggleSidebar } = useSidebar();
  const [location, setLocation] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [tipIdx, setTipIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTipIdx(i => (i + 1) % TIPS.length), 6000);
    return () => clearInterval(id);
  }, []);

  return (
    <Sidebar collapsible="icon" className="border-l border-slate-200 dark:border-slate-800">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <SidebarHeader className="h-14 justify-center">
        <div className="flex items-center gap-2.5 px-2 w-full">
          <button
            onClick={toggleSidebar}
            className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-accent transition-colors focus:outline-none flex-shrink-0"
            aria-label="طي الشريط الجانبي">
            <PanelLeft className="h-4 w-4 text-muted-foreground"/>
          </button>
          {!isCollapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                <Zap className="w-3.5 h-3.5 text-white"/>
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm text-slate-800 dark:text-slate-200 truncate leading-none">
                  معالج الصوت
                </p>
                <p className="text-xs text-slate-400 leading-none mt-0.5">v1.0</p>
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <SidebarContent className="px-2 py-2">
        <SidebarMenu>
          {navItems.map(item => {
            const isActive = location === item.path ||
              (item.path === "/app/tools" && location.startsWith("/app/tools"));
            return (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton
                  isActive={isActive}
                  onClick={() => setLocation(item.path)}
                  tooltip={item.label}
                  className="h-11 rounded-xl transition-all">
                  <item.icon className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-primary" : ""}`}/>
                  {!isCollapsed && (
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className={`text-sm font-semibold leading-none ${
                        isActive ? "" : "text-slate-700 dark:text-slate-300"
                      }`}>
                        {item.label}
                      </span>
                      <span className="text-xs text-slate-400 leading-none mt-0.5 font-normal">
                        {item.sub}
                      </span>
                    </div>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>

        {/* ── Quick tip (فقط عند توسيع الـ sidebar) ──────────────────────── */}
        {!isCollapsed && (
          <div className="mt-4 mx-1 px-3 py-2.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
            <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed transition-all">
              {TIPS[tipIdx]}
            </p>
          </div>
        )}
      </SidebarContent>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <SidebarFooter className="p-2 space-y-1">
        {/* Dark mode toggle */}
        <button
          onClick={toggleTheme}
          className="w-full h-9 flex items-center gap-2.5 px-2.5 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
          title="تبديل المظهر">
          {theme === "dark"
            ? <Sun className="w-4 h-4 flex-shrink-0"/>
            : <Moon className="w-4 h-4 flex-shrink-0"/>}
          {!isCollapsed && (
            <span className="text-xs font-medium">
              {theme === "dark" ? "وضع النهار" : "وضع الليل"}
            </span>
          )}
        </button>

        {/* User / Local mode */}
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-accent transition-colors focus:outline-none">
                <Avatar className="h-7 w-7 border flex-shrink-0">
                  <AvatarFallback className="text-xs font-bold bg-gradient-to-br from-blue-500 to-violet-600 text-white">
                    {user.name?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {!isCollapsed && (
                  <div className="flex-1 min-w-0 text-right">
                    <p className="text-xs font-semibold truncate text-slate-800 dark:text-slate-200 leading-none">
                      {user.name || "المستخدم"}
                    </p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{user.email || ""}</p>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive gap-2">
                <LogOut className="h-4 w-4"/>
                تسجيل الخروج
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl">
            <div className="w-7 h-7 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
              <span className="text-xs">🔒</span>
            </div>
            {!isCollapsed && (
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 leading-none">وضع محلي</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-none">خصوصية تامة</p>
              </div>
            )}
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const { logout } = useAuth();

  if (loading) return <DashboardLayoutSkeleton/>;

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950" dir="rtl">
        <AppSidebar user={user} logout={logout}/>
        <main className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
