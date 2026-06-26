export interface MirrorSyncBranchPair {
  Upstream: string;
  Mirror: string;
}

export interface MirrorSyncConfig {
  UpstreamUrl: string;
  Branches: MirrorSyncBranchPair[];
  /** Upstream project home page (not the git clone URL). */
  Url?: string;
  /** GitHub repo description used by gh repo create on first push-sync. */
  Description?: string;
  /** When true (default), push to GitHub via SSH; requires MIRROR_PUSH_SSH_KEY. */
  PushViaSsh?: boolean;
  SyncTags?: boolean;
  Notify?: {
    Enabled?: boolean;
    Repository?: string;
    EventType?: string;
  };
}
