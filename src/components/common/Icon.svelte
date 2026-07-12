<script lang="ts">
  // Inline stroke icons. Bundled SVG only — no external icon fonts or CDNs
  // (plan sections 6.6, 8.1).
  let { name, size = 18 }: { name: string; size?: number } = $props();

  const PATHS: Record<string, string> = {
    today: "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zm0 4h16M9 3v4m6-4v4m-5.5 7.5l2 2 3.5-3.5",
    board: "M5 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5zm8 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5z",
    calendar: "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zm0 4h16M9 3v4m6-4v4M8 14.5h2m3 0h2m-7 3.5h2m3 0h2",
    employees: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm-5.5 9c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2M17 10.5a2.6 2.6 0 1 0 0-5.2m3.5 13.2c0-2.4-1.6-4.2-3.9-4.7",
    performance: "M3 17l6-6 4 4 8-8m-6 0h6v6",
    training: "M12 4L2.5 9 12 14l9.5-5L12 4zm-6 7.2V16c0 1.6 2.7 3 6 3s6-1.4 6-3v-4.8M21.5 9v5",
    leave: "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zm0 4h16M9 3v4m6-4v4m-6 8h6",
    telework: "M3 11.2L12 3.5l9 7.7M5.5 9.6V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.6M9.5 20v-6h5v6",
    travel: "M12 3c-.6 0-1 .5-1 1.2V10L3 14.8V16.5l8-2.4v4.3l-2 1.5V21l3-.9 3 .9v-1.6l-2-1.5v-4.3l8 2.4V14.8L13 10V4.2C13 3.5 12.6 3 12 3z",
    awards: "M8 4h8v5a4 4 0 0 1-8 0V4zm0 1.5H4.5c0 3 1.6 4.8 3.7 5M16 5.5h3.5c0 3-1.6 4.8-3.7 5M12 13v4m-3.5 3h7m-5.5-3h4l.8 3H9.7l.8-3z",
    meetings: "M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm3 5h8M8 12h5",
    projects: "M3 7a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
    reports: "M5 20v-7m6 7V5m6 15v-10M3.5 20h17",
    archive: "M3.5 5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V5zM5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4",
    settings: "M4 8h9m5 0h2m-2.5 0a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0zM4 16h4m5 0h7m-11.5 0a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0z",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9.5 2.5L16 16",
    plus: "M12 5v14M5 12h14",
    edit: "M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z",
    trash: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7M10 11v6M14 11v6",
    unarchive: "M3.5 5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V5zM5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M12 17.5V12m-2 2l2-2 2 2",
    close: "M6 6l12 12M6 18L18 6",
    menu: "M4 6.5h16M4 12h16M4 17.5h16",
    download: "M12 3v11m-4-4l4 4 4-4M5 19h14",
    sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.2-6.7l-1.5 1.5M6.8 17.2l-1.5 1.5m0-13.4l1.5 1.5m10.4 10.4l1.5 1.5",
    moon: "M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z"
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name] ?? PATHS.board} />
</svg>
