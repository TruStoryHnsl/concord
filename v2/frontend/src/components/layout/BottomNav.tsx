import { useLocation, Link } from "react-router-dom";

interface NavItem {
  icon: string;
  label: string;
  href: string;
  matchPrefixes?: string[];
}

const navItems: NavItem[] = [
  { icon: "forum", label: "Forums", href: "/forum" },
  { icon: "dns", label: "Servers", href: "/servers", matchPrefixes: ["/servers", "/server/"] },
  { icon: "chat", label: "Direct", href: "/direct" },
  { icon: "group", label: "Friends", href: "/friends" },
  { icon: "tune", label: "Settings", href: "/settings" },
];

interface BottomNavProps {
  visible?: boolean;
}

function BottomNav({ visible = true }: BottomNavProps) {
  const location = useLocation();

  // Hide bottom nav when inside a server view (ServerPage has its own header)
  const inServer = location.pathname.startsWith("/server/");
  // Hide bottom nav when in a conversation view
  const inConversation = location.pathname.match(/^\/direct\/[^/]+$/);
  if (inServer || inConversation || !visible) return null;

  return (
    <nav className="shrink-0 bg-surface-container-low border-t border-outline-variant/30">
      <div className="flex items-center justify-around h-14 px-2">
        {navItems.map((item) => {
          const isActive = item.matchPrefixes
            ? item.matchPrefixes.some((prefix) => location.pathname.startsWith(prefix))
            : location.pathname === item.href || location.pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.href}
              to={item.href}
              className={`relative flex flex-col items-center justify-center gap-0.5 w-14 py-1.5 rounded-xl transition-all duration-200 ${
                isActive
                  ? "text-secondary"
                  : "text-on-surface-variant"
              }`}
            >
              <span
                className={`material-symbols-outlined text-xl transition-all duration-200 ${
                  isActive ? "scale-110" : ""
                }`}
                style={
                  isActive
                    ? { fontVariationSettings: '"FILL" 1, "wght" 500, "GRAD" 0, "opsz" 24' }
                    : undefined
                }
              >
                {item.icon}
              </span>
              <span
                className={`text-[10px] font-label font-medium transition-colors ${
                  isActive ? "text-secondary" : "text-on-surface-variant"
                }`}
              >
                {item.label}
              </span>
              {isActive && (
                <div className="absolute bottom-0.5 w-4 h-0.5 rounded-full bg-secondary" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
