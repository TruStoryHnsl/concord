import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import DashboardPage from "@/components/dashboard/DashboardPage";
import ForumPage from "@/components/forum/ForumPage";
import ServersPage from "@/components/server/ServersPage";
import ServerPage from "@/components/chat/ServerPage";
import DirectPage from "@/components/direct/DirectPage";
import ConversationView from "@/components/direct/ConversationView";
import FriendsPage from "@/components/friends/FriendsPage";
import NodeMapPage from "@/components/mesh/NodeMapPage";
import SettingsPage from "@/components/settings/SettingsPage";
import ProfilePage from "@/components/profile/ProfilePage";
import HealthPage from "@/components/health/HealthPage";
import HostSessionPage from "@/components/server/HostSessionPage";
import GuestAuthPage from "@/components/auth/GuestAuthPage";
import { useNodeEvents } from "@/hooks/useNodeEvents";
import { useAuthStore } from "@/stores/auth";
import { getNodeStatus } from "@/api/tauri";
import { useMeshStore } from "@/stores/mesh";

function App() {
  // Set up Tauri event listeners
  useNodeEvents();

  // Initialize identity and node status on mount
  useEffect(() => {
    async function init() {
      try {
        const initIdentity = useAuthStore.getState().initIdentity;
        await initIdentity();

        const status = await getNodeStatus();
        useMeshStore.getState().setNodeStatus(status);
      } catch (err) {
        console.warn("App init failed (backend not ready?):", err);
      }
    }
    void init();
  }, []);

  return (
    <ErrorBoundary>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/forum" element={<ForumPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/server/:id" element={<ServerPage />} />
          <Route path="/direct" element={<DirectPage />} />
          <Route path="/direct/:id" element={<ConversationView />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/map" element={<NodeMapPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/host" element={<HostSessionPage />} />
          <Route path="/guest" element={<GuestAuthPage />} />
        </Routes>
      </AppShell>
    </ErrorBoundary>
  );
}

export default App;
