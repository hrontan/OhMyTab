// Only the existing optional generator API; this does not install a runtime.
declare module "playwright-core" {
  interface Viewport {
    width: number;
    height: number;
  }
  interface Clip extends Viewport {
    x: number;
    y: number;
  }
  interface Page {
    goto(url: string): Promise<unknown>;
    waitForTimeout(milliseconds: number): Promise<void>;
    fill(selector: string, value: string): Promise<void>;
    selectOption(selector: string, value: string): Promise<string[]>;
    check(selector: string): Promise<void>;
    evaluate<T>(callback: () => T | PromiseLike<T>): Promise<Awaited<T>>;
    screenshot(options: {
      path: string;
      clip?: Clip;
      omitBackground?: boolean;
    }): Promise<unknown>;
    addInitScript<T>(callback: (value: T) => void, value: T): Promise<void>;
    close(): Promise<void>;
  }
  interface Worker {
    evaluate<T>(callback: () => T | PromiseLike<T>): Promise<Awaited<T>>;
    url(): string;
  }
  interface Context {
    serviceWorkers(): Worker[];
    waitForEvent(event: "serviceworker"): Promise<Worker>;
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }
  interface Browser {
    newPage(options: {
      viewport: Viewport;
      deviceScaleFactor: number;
    }): Promise<Page>;
    close(): Promise<void>;
  }
  export const chromium: {
    launchPersistentContext(
      profile: string,
      options: {
        executablePath: string;
        headless: boolean;
        locale: string;
        args: string[];
        viewport: Viewport;
      },
    ): Promise<Context>;
    launch(options: { executablePath: string }): Promise<Browser>;
  };
}
