import type { Mood } from "./types";

export function avatarMarkup(mood: Mood, label = "TRAE 助手"): string {
  return `
    <div class="trae-avatar mood-${mood}" role="img" aria-label="${label}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <!-- Exact geometry ported from drawTraeAvatar in traepal_round_badge.html. -->
        <path class="avatar-body" d="M24 20.541H3.428v-3.426H0V3.4h24Z" />
        <rect class="avatar-screen" x="3.428" y="6.827" width="17.144" height="10.288" />
        <g class="avatar-idle-eyes">
          <path class="avatar-eye" d="M9.576 9.495 12.001 11.919 9.576 14.343 7.151 11.919Z" />
          <path class="avatar-eye" d="M16.434 9.494 18.859 11.918 16.434 14.342 14.009 11.918Z" />
        </g>
        <g class="avatar-thinking-eyes">
          <path d="M9.35 9.54 11.07 11.72 9.35 13.9 7.63 11.72Z" />
          <path d="M16.2 9.54 17.92 11.72 16.2 13.9 14.48 11.72Z" />
        </g>
        <g class="avatar-alert-eyes">
          <path d="M6.7 10.2 12.1 11.8 10.8 13.35 6.1 11.75Z" />
          <path d="M13.9 11.8 19.3 10.2 19.9 11.75 15.2 13.35Z" />
        </g>
        <circle class="avatar-thinking-dot" cx="12" cy="8.42" r="0.55" />
      </svg>
    </div>
  `;
}
