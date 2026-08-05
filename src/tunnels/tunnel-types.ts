import type { ChildProcess } from "node:child_process";
import type { ManagedTunnelRecord, TunnelProvider } from "../background-lifecycle.js";

export interface TunnelProcess {
  process: ChildProcess;
  url: string;
}

export interface TunnelStartOptions {
  detached?: boolean;
  logPath?: string;
  ngrokAuthtoken?: string;
  ngrokUrl?: string;
  cloudflareTunnelToken?: string;
  publicUrl?: string;
}

export interface ManagedTunnelOptions {
  stateDir: string;
  port: number;
  provider: TunnelProvider;
  ngrokAuthtoken?: string;
  ngrokUrl?: string;
  cloudflareTunnelToken?: string;
  publicUrl?: string;
}

export interface ManagedTunnelResult {
  record: ManagedTunnelRecord;
  created: boolean;
}
