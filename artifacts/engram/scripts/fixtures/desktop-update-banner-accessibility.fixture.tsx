import { createInstance } from "i18next";
import { createRoot } from "react-dom/client";
import { I18nextProvider, initReactI18next } from "react-i18next";
import DesktopUpdateBanner from "../../src/components/desktop-update-banner";
import type { DesktopUpdateStatus } from "../../src/components/desktop-update-banner-logic";
import "../../src/index.css";

type UpdateStatusListener = (status: DesktopUpdateStatus) => void;

type FixtureWindow = Window & {
  engram?: {
    getAppInfo: () => Promise<{ updateStatus: DesktopUpdateStatus }>;
    installDownloadedUpdate: () => Promise<{ ok: boolean }>;
    onUpdateStatus: (listener: UpdateStatusListener) => () => void;
  };
  __desktopUpdateBannerFixture?: {
    emit: (status: DesktopUpdateStatus) => void;
    readonly subscriberCount: number;
  };
};

const listeners = new Set<UpdateStatusListener>();
const fixtureWindow = window as FixtureWindow;

fixtureWindow.engram = {
  getAppInfo: async () => ({ updateStatus: { state: "idle" } }),
  installDownloadedUpdate: async () => ({ ok: true }),
  onUpdateStatus: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

fixtureWindow.__desktopUpdateBannerFixture = {
  emit: (status) => listeners.forEach((listener) => listener(status)),
  get subscriberCount() {
    return listeners.size;
  },
};

const testI18n = createInstance();
await testI18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: ["common", "settings"],
  defaultNS: "common",
  resources: {
    en: {
      common: { retry: "Retry" },
      settings: {
        update: {
          checking: "Checking for updates",
          availableWithVersion: "Update {{version}} available",
          available: "Update available",
          downloading: "Downloading update: {{percent}}%",
          downloaded: "Update downloaded",
          error: "Update check failed",
          upToDate: "You are up to date",
        },
      },
    },
  },
  interpolation: { escapeValue: false },
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Fixture root element is missing");

createRoot(rootElement).render(
  <I18nextProvider i18n={testI18n}>
    <main className="min-h-screen p-4">
      <button id="dashboard-control" type="button">
        Dashboard control
      </button>
      <DesktopUpdateBanner />
    </main>
  </I18nextProvider>,
);
