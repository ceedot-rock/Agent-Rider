/**
 * Agent file-share scaffold — PLANNED, NOT LIVE.
 *
 * Honesty lock: do not implement real transfer here. Routes and MCP tools
 * always answer 501 with { error: "file_share_planned", status: "not_live" }
 * until a later PR ships storage + auth + receipts.
 *
 * FILE_SHARE_LIVE defaults false. Setting it true does NOT enable transfer
 * while this scaffold is the only implementation — still not_live.
 */

export const FILE_SHARE_PUBLIC_COPY =
  "Coming next: file sharing — same signed seats (not live)" as const;

export type FileSharePlannedBody = {
  error: "file_share_planned";
  status: "not_live";
  message: typeof FILE_SHARE_PUBLIC_COPY;
  live: false;
  feature_flag: {
    name: "FILE_SHARE_LIVE";
    value: boolean;
    note: string;
  };
  schema_preview: FileShareSchemaPreview;
};

/** Planned request/response shapes — docs only until live. */
export type FileShareSchemaPreview = {
  share_request: {
    to_agent_id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    sha256?: string;
  };
  list_query: {
    with_agent_id?: string;
    limit?: number;
  };
  note: string;
};

export const FILE_SHARE_SCHEMA_PREVIEW: FileShareSchemaPreview = {
  share_request: {
    to_agent_id: "<peer agent_id>",
    filename: "example.txt",
    content_type: "text/plain",
    size_bytes: 0,
    sha256: "optional",
  },
  list_query: {
    with_agent_id: "optional peer filter",
    limit: 25,
  },
  note: "Schema preview only — no bytes are accepted or stored while not_live.",
};

/** True only when env explicitly sets FILE_SHARE_LIVE=true. Default false. */
export function isFileShareLiveFlag(): boolean {
  return process.env.FILE_SHARE_LIVE === "true";
}

/**
 * Canonical planned body. Always live:false while scaffold-only.
 * Even if FILE_SHARE_LIVE=true, transfer is not implemented.
 */
export function fileSharePlannedBody(): FileSharePlannedBody {
  const flag = isFileShareLiveFlag();
  return {
    error: "file_share_planned",
    status: "not_live",
    message: FILE_SHARE_PUBLIC_COPY,
    live: false,
    feature_flag: {
      name: "FILE_SHARE_LIVE",
      value: flag,
      note: flag
        ? "Flag is true but transfer is not implemented — still not_live (honesty lock)."
        : "Default false. Flip only after a real transfer PR ships.",
    },
    schema_preview: FILE_SHARE_SCHEMA_PREVIEW,
  };
}

export const FILE_SHARE_HTTP_STATUS = 501 as const;
