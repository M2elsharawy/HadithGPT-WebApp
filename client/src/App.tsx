import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import Home from "./pages/Home";
import DashboardLayout from "./components/DashboardLayout";
import Tools from "./pages/Tools";
import History from "./pages/History";
import Settings from "./pages/Settings";
import GuidedWorkflow from "./pages/GuidedWorkflow";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/guided"} component={GuidedWorkflow} />
      <Route path={"/app/*"} component={AppRoutes} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/");
  }, [isAuthenticated, isLoading]);

  if (isLoading || !isAuthenticated) return null;

  return (
    <DashboardLayout>
      <Switch>
        <Route path={"/app/tools"} component={Tools} />
        <Route path={"/app/history"} component={History} />
        <Route path={"/app/settings"} component={Settings} />
        <Route component={Tools} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
