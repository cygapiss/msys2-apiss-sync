export interface MirrorSyncBranchPair {
  Upstream: string;
  Mirror: string;
}

export interface MirrorSyncConfig {
  UpstreamUrl: string;
  Branches: MirrorSyncBranchPair[];
  /** When true (default), push to GitHub via SSH; requires MIRROR_PUSH_SSH_KEY. */
  PushViaSsh?: boolean;
  SyncTags?: boolean;
  Notify?: {
    Enabled?: boolean;
    Repository?: string;
    EventType?: string;
  };
}
