<script lang="ts">
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "./router.svelte";
  import Toasts from "../components/common/Toasts.svelte";
  import QuickAddTask from "../components/forms/QuickAddTask.svelte";
  import TaskDetail from "../components/forms/TaskDetail.svelte";
  import PerformanceInputForm from "../components/forms/PerformanceInputForm.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import TodayPage from "../pages/TodayPage.svelte";
  import BoardPage from "../pages/BoardPage.svelte";
  import EmployeesPage from "../pages/EmployeesPage.svelte";
  import EmployeeDetailPage from "../pages/EmployeeDetailPage.svelte";
  import ProjectsPage from "../pages/ProjectsPage.svelte";
  import PerformancePage from "../pages/PerformancePage.svelte";
  import TrainingPage from "../pages/TrainingPage.svelte";
  import LeavePage from "../pages/LeavePage.svelte";
  import TeleworkPage from "../pages/TeleworkPage.svelte";
  import AwardsPage from "../pages/AwardsPage.svelte";
  import ReportsPage from "../pages/ReportsPage.svelte";
  import ArchivePage from "../pages/ArchivePage.svelte";
  import SettingsPage from "../pages/SettingsPage.svelte";
  import { formatTimestamp } from "../utils/dates";

  $effect(() => {
    void app.initialize();
  });

  // Theme handling: light / dark / system via data-theme attribute.
  $effect(() => {
    const apply = () => {
      const pref = app.settings.theme;
      const dark =
        pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  });

  const NAV: { page: string; label: string; section?: string }[] = [
    { page: "today", label: "Today" },
    { page: "board", label: "Board" },
    { page: "employees", label: "Employees", section: "People" },
    { page: "performance", label: "Performance" },
    { page: "training", label: "Training" },
    { page: "leave", label: "Leave" },
    { page: "telework", label: "Telework" },
    { page: "awards", label: "Awards" },
    { page: "projects", label: "Projects", section: "Work" },
    { page: "reports", label: "Reports" },
    { page: "archive", label: "Archive" },
    { page: "settings", label: "Settings", section: "System" }
  ];

  let detailTask = $derived(ui.detailTaskId ? app.tasks.find((t) => t.id === ui.detailTaskId) : undefined);

  function globalKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
    if (ui.quickAddOpen || ui.detailTaskId || ui.performanceFormPrefill || ui.performancePromptTask) return;
    switch (e.key.toLowerCase()) {
      case "n":
        e.preventDefault();
        ui.openQuickAdd();
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
    }
  }

  let backupAgeText = $derived(
    app.meta.lastBackupAt ? `Last backup ${formatTimestamp(app.meta.lastBackupAt)}` : "No backup yet"
  );
</script>

<svelte:window onkeydown={globalKeydown} />

{#if app.initError}
  <div class="page">
    <h1>Supervisor Assistant could not start</h1>
    <p class="field-error">{app.initError}</p>
    <p>Local storage may be blocked in this browser. Reload to try again, or run the environment test page.</p>
    <button type="button" onclick={() => location.reload()}>Reload</button>
  </div>
{:else if !app.initialized}
  <div class="page"><p class="muted">Initializing data…</p></div>
{:else}
  <div class="shell">
    <header class="topbar">
      <span class="brand">{app.settings.applicationName}</span>
      <button type="button" class="primary" onclick={() => ui.openQuickAdd()} title="Shortcut: N">+ New Task</button>
      <span class="spacer"></span>
      <span class="save-status small" data-status={app.saveStatus}>
        {#if app.saveStatus === "saving"}Saving…{:else if app.saveStatus === "error"}Save failed{:else}Saved{/if}
      </span>
      <span class="small muted">·</span>
      <span class="small muted">{backupAgeText}</span>
      {#if app.storageKind === "memory"}
        <span class="badge overdue" title="IndexedDB is unavailable. Data will be lost when this tab closes unless you export a backup.">
          Memory-only storage
        </span>
      {/if}
    </header>

    <div class="body">
      <nav class="sidenav" aria-label="Main navigation">
        {#each NAV as item (item.page)}
          {#if item.section}<div class="section">{item.section}</div>{/if}
          <a href={"#/" + item.page} class:active={router.current.page === item.page}>{item.label}</a>
        {/each}
      </nav>

      <main>
        {#if router.current.page === "today"}
          <TodayPage />
        {:else if router.current.page === "board"}
          <BoardPage />
        {:else if router.current.page === "employees" && router.current.param}
          <EmployeeDetailPage employeeId={router.current.param} />
        {:else if router.current.page === "employees"}
          <EmployeesPage />
        {:else if router.current.page === "projects"}
          <ProjectsPage />
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
        {:else if router.current.page === "reports"}
          <ReportsPage />
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

  {#if ui.quickAddOpen}
    <QuickAddTask />
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
            ui.performanceFormPrefill = {
              employeeId: t.employeeId,
              inputDate: t.completedDate ?? app.today,
              actionOrAccomplishment: t.title,
              projectId: t.projectId,
              relatedTaskId: t.id,
              source: "Completed Task"
            };
            ui.performancePromptTask = undefined;
          }}>Create input</button
        >
      </div>
    </Dialog>
  {/if}
  {#if ui.performanceFormPrefill}
    <PerformanceInputForm prefill={ui.performanceFormPrefill} onclose={() => (ui.performanceFormPrefill = undefined)} />
  {/if}
  <Toasts />
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: .7rem;
    padding: .5rem 1rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 50;
  }
  .brand { font-weight: 700; font-size: 1.05rem; }
  .spacer { flex: 1; }
  .save-status[data-status="error"] { color: var(--danger); font-weight: 700; }
  .save-status[data-status="saving"] { color: var(--warning); }
  .body { display: flex; flex: 1; min-height: 0; }
  .sidenav {
    width: 11rem;
    flex-shrink: 0;
    padding: .8rem .5rem 2rem;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }
  .sidenav a {
    display: block;
    padding: .35rem .7rem;
    border-radius: var(--radius);
    color: var(--text);
    text-decoration: none;
    margin-bottom: 1px;
  }
  .sidenav a:hover { background: var(--surface-2); }
  .sidenav a.active { background: var(--accent); color: var(--accent-text); }
  .sidenav .section {
    font-size: .7rem;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--text-muted);
    margin: .9rem .7rem .2rem;
  }
  main { flex: 1; min-width: 0; overflow-x: auto; }
  .notice {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--surface-2);
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: .72rem;
    padding: .25rem 1rem;
    text-align: center;
    z-index: 60;
  }
  @media (max-width: 900px) {
    .sidenav { width: 8.5rem; }
  }
</style>
