import { useEffect, useRef, type ReactNode } from "react";
import { ClerkProvider, Show, SignIn, SignUp, useAuth, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import {
  Switch,
  Route,
  Redirect,
  Link,
  useLocation,
  Router as WouterRouter,
} from "wouter";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";

import Home from "@/pages/home";
import Hub from "@/pages/hub";
import Commons from "@/pages/commons";
import Simulations from "@/pages/simulations";
import Terminal from "@/pages/terminal";
import Personality from "@/pages/personality";
import Memory from "@/pages/memory";
import WorldModel from "@/pages/world-model";
import Journal from "@/pages/journal";
import Personas from "@/pages/personas";
import HieroCode from "@/pages/hiero-code";
import Beliefs from "@/pages/beliefs";
import Evolution from "@/pages/evolution";
import Analytics from "@/pages/analytics";
import CreateEngram from "@/pages/create-engram";
import Chat from "@/pages/chat";
import Environment from "@/pages/environment";
import Inquiry from "@/pages/inquiry";
import Media from "@/pages/media";
import Studio from "@/pages/studio";
import DownloadPage from "@/pages/download";
import SettingsPage from "@/pages/settings";

const queryClient = new QueryClient();

// Resolves the key for the current custom domain in both development and production.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// Empty in development by design; populated for the production Clerk proxy.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "bottom" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#22d3ee",
    colorForeground: "#f8fafc",
    colorMutedForeground: "#94a3b8",
    colorDanger: "#f87171",
    colorBackground: "#090b20",
    colorInput: "#151936",
    colorInputForeground: "#f8fafc",
    colorNeutral: "#293052",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "w-[440px] max-w-full overflow-hidden border border-cyan-400/30 bg-[#090b20] shadow-[0_0_36px_rgba(34,211,238,0.14)]",
    card: "!border-0 !bg-transparent !shadow-none !rounded-none",
    footer: "!border-0 !bg-transparent !shadow-none !rounded-none",
    headerTitle: "font-display uppercase tracking-widest text-slate-50",
    headerSubtitle: "text-slate-400",
    socialButtonsBlockButtonText: "text-slate-100",
    formFieldLabel: "font-mono text-xs uppercase tracking-wider text-slate-200",
    footerActionLink: "font-semibold text-cyan-300 hover:text-cyan-200",
    footerActionText: "text-slate-400",
    dividerText: "font-mono text-xs text-slate-400",
    identityPreviewEditButton: "text-cyan-300",
    formFieldSuccessText: "text-cyan-300",
    alertText: "text-slate-100",
    logoBox: "mb-4",
    logoImage: "h-12 w-auto",
    socialButtonsBlockButton:
      "border border-slate-700 bg-[#151936] hover:bg-[#1b2145]",
    formButtonPrimary:
      "bg-cyan-400 font-display uppercase tracking-widest text-slate-950 hover:bg-cyan-300",
    formFieldInput: "border-slate-700 bg-[#151936] text-slate-50",
    footerAction: "border-t border-slate-800",
    dividerLine: "bg-slate-700",
    alert: "border border-red-400/40 bg-red-950/30",
    otpCodeFieldInput: "border-slate-700 bg-[#151936] text-slate-50",
    formFieldRow: "gap-2",
    main: "gap-5",
  },
};

function LandingPage() {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(34,211,238,0.16),transparent_38%)]" />
      <section className="relative max-w-2xl border border-primary/30 bg-card/80 p-8 text-center shadow-[0_0_50px_rgba(34,211,238,0.12)] backdrop-blur sm:p-12">
        <p className="font-mono text-xs uppercase tracking-[0.4em] text-primary">
          Cognitive systems online
        </p>
        <h1 className="mt-5 text-5xl font-bold tracking-[0.16em] text-foreground sm:text-7xl">
          ENGRAM
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-muted-foreground">
          Build, observe, and evolve AI personas in a living intelligence
          framework.
        </p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/sign-up"
            className="bg-primary px-6 py-3 font-display font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/85"
          >
            Initialize an engram
          </Link>
          <Link
            href="/sign-in"
            className="border border-primary/50 px-6 py-3 font-display font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary/10"
          >
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ProtectedDashboard({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const { getToken, isLoaded } = useAuth();
  const client = useQueryClient();
  const previousIdentity = useRef<string | undefined>(undefined);

  // The browser normally sends the Clerk session cookie automatically, but the
  // preview proxy can serve the dashboard and API on different hostnames. A
  // bearer token keeps generated API hooks authenticated in that setup too.
  useEffect(() => {
    setAuthTokenGetter(isLoaded ? () => getToken() : null);
    return () => setAuthTokenGetter(null);
  }, [getToken, isLoaded]);

  useEffect(() => {
    return addListener(({ user, session }) => {
      const identity = `${user?.id ?? "signed-out"}:${session?.id ?? "no-session"}`;
      if (
        previousIdentity.current !== undefined &&
        previousIdentity.current !== identity
      ) {
        client.clear();
      }
      previousIdentity.current = identity;
    });
  }, [addListener, client]);

  return null;
}

function DashboardRoutes() {
  return (
    <Layout>
      <Switch>
        <Route path="/dashboard" component={Home} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/hub" component={Hub} />
        <Route path="/commons" component={Commons} />
        <Route path="/simulations" component={Simulations} />
        <Route path="/terminal" component={Terminal} />
        <Route path="/personality" component={Personality} />
        <Route path="/memory" component={Memory} />
        <Route path="/world-model" component={WorldModel} />
        <Route path="/journal" component={Journal} />
        <Route path="/personas" component={Personas} />
        <Route path="/hiero-code" component={HieroCode} />
        <Route path="/beliefs" component={Beliefs} />
        <Route path="/evolution" component={Evolution} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/create-engram" component={CreateEngram} />
        <Route path="/chat" component={Chat} />
        <Route path="/environment" component={Environment} />
        <Route path="/inquiry" component={Inquiry} />
        <Route path="/media" component={Media} />
        <Route path="/studio" component={Studio} />
        <Route path="/download" component={DownloadPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Return to ENGRAM",
            subtitle: "Enter the cognitive systems interface",
          },
        },
        signUp: {
          start: {
            title: "Initialize your ENGRAM account",
            subtitle: "Begin building an intelligence framework",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route>
              <ProtectedDashboard>
                <DashboardRoutes />
              </ProtectedDashboard>
            </Route>
          </Switch>
          <Toaster />
          <div className="scanline" />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
