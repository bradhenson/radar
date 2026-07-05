<script lang="ts">
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "./router.svelte";
  import Toasts from "../components/common/Toasts.svelte";
  import TaskDetail from "../components/forms/TaskDetail.svelte";
  import PerformanceInputForm from "../components/forms/PerformanceInputForm.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import Icon from "../components/common/Icon.svelte";
  import TodayPage from "../pages/TodayPage.svelte";
  import BoardPage from "../pages/BoardPage.svelte";
  import CalendarPage from "../pages/CalendarPage.svelte";
  import EmployeesPage from "../pages/EmployeesPage.svelte";
  import EmployeeDetailPage from "../pages/EmployeeDetailPage.svelte";
  import ProjectsPage from "../pages/ProjectsPage.svelte";
  import PerformancePage from "../pages/PerformancePage.svelte";
  import MeetingsPage from "../pages/MeetingsPage.svelte";
  import TrainingPage from "../pages/TrainingPage.svelte";
  import LeavePage from "../pages/LeavePage.svelte";
  import TeleworkPage from "../pages/TeleworkPage.svelte";
  import AwardsPage from "../pages/AwardsPage.svelte";
  import ArchivePage from "../pages/ArchivePage.svelte";
  import SettingsPage from "../pages/SettingsPage.svelte";
  import { formatTimestamp } from "../utils/dates";
  import { performanceInputPrefillFromTask } from "../domain/rules/performanceImport";

  $effect(() => {
    void app.initialize();
  });

  // Theme handling: light / dark / system via data-theme attribute,
  // accent palette via data-palette.
  $effect(() => {
    const apply = () => {
      const pref = app.settings.theme;
      const dark =
        pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.dataset.palette = app.settings.colorTheme ?? "default";
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  });

  const NAV: { page: string; label: string; icon: string; section?: string }[] = [
    { page: "board", label: "Board", icon: "board" },
    { page: "calendar", label: "Calendar", icon: "calendar" },
    { page: "today", label: "Today", icon: "today" },
    { page: "employees", label: "Employees", icon: "employees", section: "People" },
    { page: "performance", label: "Performance", icon: "performance" },
    { page: "training", label: "Training", icon: "training" },
    { page: "leave", label: "Leave", icon: "leave" },
    { page: "telework", label: "Telework", icon: "telework" },
    { page: "awards", label: "Awards", icon: "awards" },
    { page: "meetings", label: "Meetings", icon: "meetings", section: "Work" },
    { page: "projects", label: "Projects", icon: "projects" },
    { page: "archive", label: "Archive", icon: "archive", section: "System" },
    { page: "settings", label: "Settings", icon: "settings" }
  ];

  let isDark = $derived(
    app.settings.theme === "dark" ||
      (app.settings.theme === "system" &&
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
  );

  function toggleTheme() {
    void app.saveSettings({ ...app.settings, theme: isDark ? "light" : "dark" });
  }

  let detailTask = $derived(ui.detailTaskId ? app.tasks.find((t) => t.id === ui.detailTaskId) : undefined);

  function globalKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
    if (ui.newTaskOpen || ui.detailTaskId || ui.performanceFormPrefill || ui.performancePromptTask) return;
    switch (e.key.toLowerCase()) {
      case "n":
        e.preventDefault();
        ui.openNewTask();
        break;
      case "p":
        e.preventDefault();
        ui.performanceFormPrefill = {};
        break;
      case "t":
        router.go("today");
        break;
      case "b":
        router.go("board");
        break;
      case "e":
        router.go("employees");
        break;
      case "m":
        router.go("meetings");
        break;
    }
  }

  let backupAgeText = $derived(
    app.meta.lastBackupAt ? `Last backup ${formatTimestamp(app.meta.lastBackupAt)}` : "No backup yet"
  );
</script>

<svelte:window onkeydown={globalKeydown} />

{#if app.initError}
  <div class="page">
    <h1>RADAR could not start</h1>
    <p class="field-error">{app.initError}</p>
    <p>Local storage may be blocked in this browser. Reload to try again, or run the environment test page.</p>
    <button type="button" onclick={() => location.reload()}>Reload</button>
  </div>
{:else if !app.initialized}
  <div class="page"><p class="muted">Initializing data…</p></div>
{:else}
  <div class="shell">
    <header class="topbar">
      <span class="brand">
        <span class="brand-mark" aria-hidden="true">R</span>
        <span>{app.settings.applicationName}</span>
      </span>
      <span class="spacer"></span>
      <span class="chip save-status" data-status={app.saveStatus} title={backupAgeText}>
        <span class="dot" aria-hidden="true"></span>
        {#if app.saveStatus === "saving"}Saving…{:else if app.saveStatus === "error"}Save failed{:else}Saved{/if}
      </span>
      {#if app.storageKind === "memory"}
        <span class="badge overdue" title="IndexedDB is unavailable. Data will be lost when this tab closes unless you export a backup.">
          Memory-only storage
        </span>
      {/if}
      <button type="button" class="icon-btn" onclick={toggleTheme} title="Toggle light/dark theme" aria-label="Toggle theme">
        <Icon name={isDark ? "sun" : "moon"} size={17} />
      </button>
    </header>

    <div class="body">
      <nav class="sidenav" aria-label="Main navigation">
        {#each NAV as item (item.page)}
          {#if item.section}<div class="section">{item.section}</div>{/if}
          <a href={"#/" + item.page} class:active={router.current.page === item.page}>
            <span class="nav-icon"><Icon name={item.icon} size={17} /></span>
            <span>{item.label}</span>
          </a>
        {/each}
        <div class="sidenav-footer small muted">{backupAgeText}</div>
      </nav>

      <main>
        {#if router.current.page === "today"}
          <TodayPage />
        {:else if router.current.page === "board"}
          <BoardPage />
        {:else if router.current.page === "calendar"}
          <CalendarPage />
        {:else if router.current.page === "employees" && router.current.param}
          <EmployeeDetailPage employeeId={router.current.param} />
        {:else if router.current.page === "employees"}
          <EmployeesPage />
        {:else if router.current.page === "projects"}
          <ProjectsPage />
        {:else if router.current.page === "meetings"}
          <MeetingsPage />
        {:else if router.current.page === "performance"}
          <PerformancePage />
        {:else if router.current.page === "training"}
          <TrainingPage />
        {:else if router.current.page === "leave"}
          <LeavePage />
        {:else if router.current.page === "telework"}
          <TeleworkPage />
        {:else if router.current.page === "awards"}
          <AwardsPage />
        {:else if router.current.page === "archive"}
          <ArchivePage />
        {:else if router.current.page === "settings"}
          <SettingsPage />
        {:else}
          <TodayPage />
        {/if}
      </main>
    </div>

    <footer class="notice">
      Use only for information authorized for local supervisory tracking. Do not enter classified information,
      credentials, medical details, Social Security numbers, or unnecessary personal information.
    </footer>
  </div>

  {#if ui.newTaskOpen}
    <TaskDetail defaults={ui.newTaskDefaults} onclose={() => ui.closeNewTask()} />
  {/if}
  {#if detailTask}
    {#key detailTask.id}
      <TaskDetail task={detailTask} />
    {/key}
  {/if}
  {#if ui.performancePromptTask}
    {@const t = ui.performancePromptTask}
    <Dialog title="Create performance input?" onclose={() => (ui.performancePromptTask = undefined)}>
      <p>
        Create a performance input for <strong>{app.employeeName(t.employeeId)}</strong> from the completed work
        “{t.title}”?
      </p>
      <div style="display:flex; gap:.5rem; justify-content:flex-end;">
        <button type="button" onclick={() => (ui.performancePromptTask = undefined)}>Not now</button>
        <button
          type="button"
          class="primary"
          onclick={() => {
            ui.performanceFormPrefill = performanceInputPrefillFromTask(t, {
              today: app.today,
              notes: app.taskNotes,
              checklistItems: app.checklistItems
            });
            ui.performancePromptTask = undefined;
          }}>Create input</button
        >
      </div>
    </Dialog>
  {/if}
  {#if ui.performanceFormPrefill || ui.performanceFormInput}
    <PerformanceInputForm
      input={ui.performanceFormInput}
      prefill={ui.performanceFormPrefill ?? {}}
      onclose={() => ui.closePerformanceForm()}
    />
  {/if}
  <Toasts />
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background:
      radial-gradient(80rem 22rem at 18% -6rem, color-mix(in srgb, var(--accent-soft) 55%, transparent), transparent),
      var(--bg);
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: .7rem;
    min-height: var(--topbar-h);
    padding: .5rem 1.1rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 50;
    box-shadow: var(--shadow-xs);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: .6rem;
    font-weight: 750;
    font-size: 1.02rem;
    letter-spacing: 0;
    min-width: 0;
    margin-right: .4rem;
  }
  .brand-mark {
    display: inline-grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 9px;
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 45%, #7c3aed));
    color: #fff;
    font-size: .72rem;
    font-weight: 800;
    letter-spacing: .02em;
    flex: 0 0 auto;
    box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .spacer { flex: 1; }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: .4rem;
    min-height: 1.85rem;
    padding: .2rem .7rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: .78rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .chip .dot {
    width: .5rem;
    height: .5rem;
    border-radius: 999px;
    background: var(--success);
    flex: 0 0 auto;
  }
  .save-status[data-status="saving"] .dot { background: var(--warning); }
  .save-status[data-status="error"] { color: var(--danger); border-color: var(--danger); }
  .save-status[data-status="error"] .dot { background: var(--danger); }

  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    border-radius: 999px;
    color: var(--text-muted);
  }
  .icon-btn:hover { color: var(--text); }

  .body { display: flex; flex: 1; min-height: 0; }

  .sidenav {
    width: 13.5rem;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 1rem .7rem 2.6rem;
    border-right: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 55%, var(--bg));
    position: sticky;
    top: var(--topbar-h);
    align-self: flex-start;
    height: calc(100vh - var(--topbar-h));
    overflow-y: auto;
  }
  .sidenav a {
    display: flex;
    align-items: center;
    gap: .6rem;
    min-height: 2.15rem;
    padding: .3rem .7rem;
    border-radius: 9px;
    color: var(--text-muted);
    text-decoration: none;
    margin-bottom: 2px;
    font-weight: 600;
    transition: background-color .12s ease, color .12s ease;
  }
  .sidenav a:hover { background: color-mix(in srgb, var(--surface-2) 80%, transparent); color: var(--text); text-decoration: none; }
  .sidenav a.active {
    background: var(--accent-soft);
    color: var(--accent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .nav-icon {
    display: inline-grid;
    place-items: center;
    width: 1.35rem;
    flex: 0 0 auto;
    opacity: .85;
  }
  .sidenav a.active .nav-icon { opacity: 1; }
  .sidenav .section {
    font-size: .66rem;
    text-transform: uppercase;
    letter-spacing: .1em;
    color: var(--text-muted);
    margin: 1.05rem .7rem .3rem;
    font-weight: 750;
    opacity: .8;
  }
  .sidenav-footer {
    margin-top: auto;
    padding: 1rem .7rem 0;
    font-size: .72rem;
  }

  main { flex: 1; min-width: 0; overflow-x: auto; }

  .notice {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--surface);
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: .7rem;
    padding: .28rem 1rem;
    text-align: center;
    z-index: 60;
  }

  @media (max-width: 900px) {
    .sidenav { width: 10.5rem; }
  }
  @media (max-width: 700px) {
    .topbar { flex-wrap: wrap; }
    .brand { flex: 1 1 100%; }
    .body { flex-direction: column; }
    .sidenav {
      display: flex;
      flex-direction: row;
      gap: .25rem;
      width: 100%;
      height: auto;
      position: static;
      overflow-x: auto;
      padding: .45rem .55rem;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }
    .sidenav .section, .sidenav-footer { display: none; }
    .sidenav a { flex: 0 0 auto; margin: 0; white-space: nowrap; }
  }
</style>
