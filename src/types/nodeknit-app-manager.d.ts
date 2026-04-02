declare module "@nodeknit/app-manager" {
  import type { Server as HttpServer } from "node:http";

  export class AppManager {
    app: any;
    server?: HttpServer;
  }

  export abstract class AbstractApp {
    appManager: AppManager;
    constructor(appManager: AppManager);
    abstract mount(): Promise<void>;
    abstract unmount(): Promise<void>;
  }

  export function Collection(target: any, propertyKey: string): void;
  export function CollectionHandler(
    collectionName: string
  ): (target: any, propertyKey: string) => void;
}
