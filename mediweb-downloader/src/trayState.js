import { EventEmitter } from "node:events";

export class TrayStateController extends EventEmitter {
  constructor() {
    super();
    this.state = "starting";
    this.activeJob = false;
  }

  handle(type) {
    if (type === "connector:ready") this.#set("ready");
    else if (type === "browser:opened") this.#set("browser_open");
    else if (type === "job:started") { this.activeJob = true; this.#set("processing"); }
    else if (type === "job:completed") { this.activeJob = false; this.#set("completed"); }
    else if (type === "job:failed") { this.activeJob = false; this.#set("error"); }
    else if (type === "job:cancelled") { this.activeJob = false; this.#set("ready"); }
    else if (type === "connector:error" || type === "browser:error") this.#set("error");
    else if (type === "connector:stopped") { this.activeJob = false; this.#set("stopped"); }
    return this.snapshot();
  }

  canExit() {
    return !this.activeJob;
  }

  snapshot() {
    return { state: this.state, activeJob: this.activeJob };
  }

  #set(state) {
    this.state = state;
    this.emit("changed", this.snapshot());
  }
}
