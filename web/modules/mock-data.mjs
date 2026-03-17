export const MODEL_OPTIONS = ["GPT-5.4", "GPT-5.4 mini", "o4-mini"];
export const REASONING_OPTIONS = ["Extra High", "High", "Balanced"];
export const SPEED_OPTIONS = ["Normal", "Fast"];
export const ACCESS_OPTIONS = ["On-Request", "Workspace Write", "Read Only"];

export const REPOSITORY_BRANCHES = {
  MATR: ["main", "release/matr-patch", "feat/package-gap"],
  "remodex-windows-fix": ["main", "codex/web-deck", "codex/trust-debug"],
  "gunfire-reborn-internal-mod": ["develop", "feature/wsl-tools", "fix/ux-shell"],
  sts2: ["main", "ux-refresh", "experiment/sidebar"],
};

export const DEFAULT_CONVERSATIONS = [
  {
    folder: "MATR",
    chats: [
      {
        id: "matr-investigate",
        title: "Investigate MATR package gap",
        snippet: "Pending result flush should keep final log updates in order.",
        timestamp: "now",
        repo: "MATR",
        branch: "feat/package-gap",
        access: "On-Request",
        messages: [
          {
            role: "assistant",
            author: "Codex",
            time: "now",
            text: [
              "Pending result flush should not skip the final log update.",
              "",
              "The web deck keeps this thread style close to the app: roomy layout, long-form text, and visible runtime defaults."
            ].join("\n"),
          },
          {
            role: "assistant",
            author: "Codex",
            time: "now",
            text: [
              "If stateUpdate stays broadcast while taskResult is per-client, a race can drop the last flush.",
              "",
              "That kind of debugging note needs a comfortable right-side reading pane."
            ].join("\n"),
          },
        ],
      },
    ],
  },
  {
    folder: "remodex-windows-fix",
    chats: [
      {
        id: "remodex-pull",
        title: "Pull remote repository changes",
        snippet: "Fast-forward main and prepare the web client shell.",
        timestamp: "now",
        repo: "remodex-windows-fix",
        branch: "codex/web-deck",
        access: "On-Request",
        messages: [
          {
            role: "assistant",
            author: "Codex",
            time: "now",
            text: [
              "Relay hardening is deployed and the browser client shell now lives at /app/.",
              "",
              "Next step: wire browser-side secure transport so this becomes a working Remodex client."
            ].join("\n"),
          },
          {
            role: "user",
            author: "You",
            time: "now",
            text: "Mirror the app UI with QR scan, foldered chat list, settings, model choice, and repo controls.",
          },
          {
            role: "assistant",
            author: "Codex",
            time: "now",
            text: [
              "This shell follows that direction:",
              "- folder-first navigation on the left",
              "- conversation view on the right",
              "- model and reasoning above the composer",
              "- repo, branch, and access controls anchored at the bottom"
            ].join("\n"),
          },
        ],
      },
      {
        id: "remodex-edge",
        title: "Remove Microsoft Edge completely",
        snippet: "Keep system package cleanup separate from web shell work.",
        timestamp: "2d",
        repo: "remodex-windows-fix",
        branch: "main",
        access: "Read Only",
        messages: [
          {
            role: "assistant",
            author: "Codex",
            time: "2d",
            text: "This secondary thread is here so the sidebar feels like the app rather than a flat demo.",
          },
        ],
      },
      {
        id: "remodex-floating-window",
        title: "Wait window keeps floating",
        snippet: "Triage the detached progress window behavior.",
        timestamp: "6d",
        repo: "remodex-windows-fix",
        branch: "codex/trust-debug",
        access: "On-Request",
        messages: [
          {
            role: "assistant",
            author: "Codex",
            time: "6d",
            text: "Another thread placeholder so the sidebar grouping and timestamps feel credible.",
          },
        ],
      },
    ],
  },
  {
    folder: "gunfire-reborn-internal-mod",
    chats: [
      {
        id: "gunfire-time",
        title: "Change WSL current time",
        snippet: "Keep runtime diagnostics grouped by repo folder.",
        timestamp: "2d",
        repo: "gunfire-reborn-internal-mod",
        branch: "feature/wsl-tools",
        access: "Workspace Write",
        messages: [
          {
            role: "assistant",
            author: "Codex",
            time: "2d",
            text: "This thread exists mainly to show folder grouping and branch switching.",
          },
        ],
      },
    ],
  },
  {
    folder: "sts2",
    chats: [
      {
        id: "sts2-ux",
        title: "UI UX cleanup notes",
        snippet: "Use softer glass, heavier titles, and cleaner message cards.",
        timestamp: "3d",
        repo: "sts2",
        branch: "ux-refresh",
        access: "On-Request",
        messages: [
          {
            role: "assistant",
            author: "Codex",
            time: "3d",
            text: "The settings sheet and scanner overlay are both shaped after the screenshots in img/.",
          },
        ],
      },
    ],
  },
];
