import type { AppApi } from "../shared/ipc";

declare global {
  interface Window {
    focusApi: AppApi;
  }
}

export {};
