<script lang="ts">
  import { app } from "../stores/app.svelte";
  import { ui } from "../stores/ui.svelte";
  import { router } from "./router.svelte";
  import Toasts from "../components/common/Toasts.svelte";
  import TaskDetail from "../components/forms/TaskDetail.svelte";
  import QuickAddTask from "../components/forms/QuickAddTask.svelte";
  import PerformanceInputForm from "../components/forms/PerformanceInputForm.svelte";
  import ConfirmDialog from "../components/common/ConfirmDialog.svelte";
  import Dialog from "../components/common/Dialog.svelte";
  import Icon from "../components/common/Icon.svelte";
  import WindowControls from "../components/common/WindowControls.svelte";
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
  import TravelPage from "../pages/TravelPage.svelte";
  import AwardsPage from "../pages/AwardsPage.svelte";
  import ArchivePage from "../pages/ArchivePage.svelte";
  import SettingsPage from "../pages/SettingsPage.svelte";
  import { daysSinceTimestamp, formatTimestamp } from "../utils/dates";
  import { backupFilename, downloadJson } from "../utils/download";
  import { performanceInputPrefillFromTask } from "../domain/rules/performanceImport";
  import { isWailsHost, toggleMaximiseDesktopWindow } from "../data/wailsBridge";

  const desktopHost = isWailsHost();

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
    { page: "board", label: "Board", icon: "board", section: "Work" },
    { page: "calendar", label: "Calendar", icon: "calendar" },
    { page: "today", label: "Today", icon: "today" },
    { page: "projects", label: "Projects", icon: "projects" },
    { page: "meetings", label: "Meetings", icon: "meetings" },
    { page: "employees", label: "Employees", icon: "employees", section: "People" },
    { page: "performance", label: "Performance", icon: "performance" },
    { page: "training", label: "Training", icon: "training" },
    { page: "leave", label: "Leave", icon: "leave" },
    { page: "telework", label: "Telework", icon: "telework" },
    { page: "travel", label: "Travel", icon: "travel" },
    { page: "awards", label: "Awards", icon: "awards" },
    { page: "archive", label: "Archive", icon: "archive", section: "System" },
    { page: "settings", label: "Settings", icon: "settings" }
  ];

  let isDark = $derived(
    app.settings.theme === "dark" ||
      (app.settings.theme === "system" &&
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
  );

  // Narrow windows get a compact primary nav plus a "More" menu instead of a
  // 14-destination horizontal scroll strip.
  const PRIMARY_NAV = new Set(["board", "calendar", "today", "employees"]);
  let primaryNavItems = $derived(NAV.filter((i) => PRIMARY_NAV.has(i.page)));
  let moreNavItems = $derived(NAV.filter((i) => !PRIMARY_NAV.has(i.page)));
  let isNarrow = $state(false);
  let moreOpen = $state(false);
  let moreWrap: HTMLDivElement | undefined = $state();
  let moreIsActive = $derived(moreNavItems.some((i) => i.page === router.current.page));

  $effect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const apply = () => {
      isNarrow = mq.matches;
      if (!mq.matches) moreOpen = false;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  });

  function closeMoreOnOutsideClick(e: MouseEvent) {
    if (moreOpen && moreWrap && !moreWrap.contains(e.target as Node)) moreOpen = false;
  }

  // Move focus to the new page's heading on route changes so screen-reader and
  // keyboard users land at the top of the content, not wherever focus was.
  let lastFocusedPage: string | undefined;
  $effect(() => {
    const page = router.current.page;
    if (lastFocusedPage !== undefined && lastFocusedPage !== page) {
      requestAnimationFrame(() => {
        const heading = document.querySelector<HTMLElement>("main h1");
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus();
        }
      });
    }
    lastFocusedPage = page;
  });

  function toggleTheme() {
    void app.saveSettings({ ...app.settings, theme: isDark ? "light" : "dark" });
  }

  function handleTitlebarDoubleClick() {
    if (desktopHost) toggleMaximiseDesktopWindow();
  }

  async function exportBackup() {
    try {
      const pkg = await app.buildBackup();
      const saved = await downloadJson(backupFilename("RADAR_Backup", "json"), pkg);
      if (!saved) {
        // Cancelled native save dialog: the backup reminder must not reset.
        app.toast("Backup export cancelled", "info");
        return;
      }
      await app.markBackupCompleted(pkg);
      app.toast("Backup exported", "success");
    } catch (e) {
      app.toast(`Backup failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  let detailTask = $derived(ui.detailTaskId ? app.tasks.find((t) => t.id === ui.detailTaskId) : undefined);

  // Full-page editors render in place of the routed page, so navigating while
  // one is open must dismiss it — otherwise the destination page would stay
  // hidden behind the form.
  let lastRoute = router.current.page + "/" + (router.current.param ?? "");
  $effect(() => {
    const route = router.current.page + "/" + (router.current.param ?? "");
    if (route === lastRoute) return;
    lastRoute = route;
    if (ui.detailTaskId) ui.detailTaskId = undefined;
    if (ui.newTaskOpen) ui.closeNewTask();
    if (ui.performanceFormPrefill || ui.performanceFormInput) ui.closePerformanceForm();
  });

  // Current record for the post-input "archive this task?" prompt; resolved by
  // id so the archive acts on the latest task state, never a stale snapshot.
  let archivePromptTask = $derived(
    ui.archivePromptTaskId ? app.tasks.find((t) => t.id === ui.archivePromptTaskId && !t.isArchived) : undefined
  );

  async function archivePromptedTask() {
    const task = archivePromptTask;
    ui.archivePromptTaskId = undefined;
    if (!task) return;
    await app.updateTask({ ...task, isArchived: true }, `Archived "${task.title}"`, "archived");
    app.toast(`Archived "${task.title}"`, "success", async () => {
      const current = app.tasks.find((t) => t.id === task.id);
      if (current) await app.updateTask({ ...current, isArchived: false }, `Restored "${task.title}"`, "restored");
    });
  }

  function globalKeydown(e: KeyboardEvent) {
    if (!app.settings.enableSingleKeyShortcuts) return;
    const target = e.target as HTMLElement;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
    if (ui.newTaskOpen || ui.quickAddOpen || ui.detailTaskId || ui.performanceFormPrefill || ui.performanceFormInput || ui.performancePromptTask || ui.archivePromptTaskId)
      return;
    switch (e.key.toLowerCase()) {
      case "n":
        e.preventDefault();
        ui.openNewTask();
        break;
      case "q":
        e.preventDefault();
        ui.quickAddOpen = true;
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
    app.meta.lastBackupAt ? `Last backup ${formatTimestamp(app.meta.lastBackupAt)}` : app.hasOperatorData ? "No backup yet" : "No local records"
  );

  // "Stored locally" (IndexedDB write state) and "backed up" (exported file the
  // user confirmed) are different guarantees, shown as separate chips.
  let backupAgeDays = $derived(
    app.meta.lastBackupAt ? daysSinceTimestamp(app.meta.lastBackupAt, app.today) : undefined
  );
  let backupStale = $derived(
    (!app.meta.lastBackupAt && app.meta.changesSinceBackup > 0) ||
      (backupAgeDays !== undefined && backupAgeDays >= app.settings.backupReminderDays) ||
      app.meta.changesSinceBackup >= app.settings.backupChangeThreshold
  );
  let backupChipText = $derived(
    !app.meta.lastBackupAt
      ? "No backup yet"
      : backupAgeDays === 0
        ? "Backed up today"
        : `Backup ${backupAgeDays}d ago`
  );
</script>

<svelte:window onkeydown={globalKeydown} onclick={closeMoreOnOutsideClick} />

{#if desktopHost && !app.initialized}
  <div class="startup-titlebar">
    <strong>RADAR</strong><span class="spacer"></span><WindowControls />
  </div>
{/if}

{#if app.storageFault === "blocked"}
  <div class="page fault-screen">
    <h1>RADAR can't open its database</h1>
    <p>
      Another RADAR window or tab is holding an older version of the database open, so this window cannot
      upgrade it.
    </p>
    <p><strong>Close every other RADAR window and tab</strong>, then retry.</p>
    <button type="button" class="primary" onclick={() => location.reload()}>Retry</button>
  </div>
{:else if app.storageFault === "locked"}
  <div class="page fault-screen">
    <h1>RADAR is already open in another window</h1>
    <p>
      To prevent two windows from overwriting each other's changes, only one RADAR window can save at a time.
      The other window is currently the editing window.
    </p>
    <p>Close the other RADAR windows and retry, or make this the editing window (the other window will stop saving within a few seconds).</p>
    <div style="display:flex; gap:.5rem; flex-wrap:wrap">
      <button type="button" class="primary" onclick={() => location.reload()}>Retry</button>
      <button type="button" onclick={() => void app.initialize({ takeOverWriterLease: true })}>Use this window for editing</button>
    </div>
  </div>
{:else if app.storageFault === "versionchange"}
  <div class="page fault-screen">
    <h1>The database changed in another window</h1>
    <p>
      Another RADAR window upgraded or replaced the database. This window has stopped saving to protect your
      data. Reload to continue working here.
    </p>
    <button type="button" class="primary" onclick={() => location.reload()}>Reload</button>
  </div>
{:else if app.storageFault === "lease_lost"}
  <div class="page fault-screen">
    <h1>Another window took over editing</h1>
    <p>
      You chose to edit in a different RADAR window, so this one has stopped saving. Close this window, or
      reload it to take editing back.
    </p>
    <button type="button" class="primary" onclick={() => location.reload()}>Reload and edit here</button>
  </div>
{:else if app.initError}
  <div class="page">
    <h1>RADAR could not start</h1>
    <p class="field-error">{app.initError}</p>
    <p>Local storage may be blocked in this browser. Reload to try again, or run the environment test page.</p>
    <button type="button" onclick={() => location.reload()}>Reload</button>
  </div>
{:else if !app.initialized}
  <div class="page"><p class="muted">Initializing data…</p></div>
{:else}
  <div class="shell" class:desktop-shell={desktopHost}>
    <header class="topbar" class:desktop-titlebar={desktopHost}>
      <!-- The maximize button remains the keyboard-accessible alternative to this native title-bar gesture. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="titlebar-brand-region" ondblclick={handleTitlebarDoubleClick}>
        <span class="brand">
          <span class="brand-mark" aria-hidden="true">
            <span class="brand-sweep"></span>
            <svg class="brand-icon" viewBox="0 0 24 24" focusable="false">
              <path d="M4.8 18.7A10 10 0 1 1 19.2 18.7" />
              <path d="M8.1 15.5A5.6 5.6 0 1 1 15.9 15.5" />
              <path d="M12 12l6.2-6.2" />
              <circle class="radar-fill" cx="12" cy="12" r="1.7" />
              <circle class="radar-fill" cx="18.2" cy="5.8" r="1.35" />
            </svg>
          </span>
          <span>{app.settings.applicationName}</span>
        </span>
        <span class="spacer"></span>
      </div>
      <span
        class="chip save-status"
        data-status={app.saveStatus}
        title="Changes are saved to this browser's local storage. That is not an external backup."
      >
        <span class="dot" aria-hidden="true"></span>
        {#if app.saveStatus === "saving"}Saving…{:else if app.saveStatus === "error"}Save failed{:else}Stored locally{/if}
      </span>
      <button
        type="button"
        class="chip backup-chip"
        class:stale={backupStale}
        title={`${backupAgeText} · ${app.meta.changesSinceBackup} change(s) since. Click to export a JSON backup.`}
        onclick={() => void exportBackup()}
        disabled={app.saveStatus === "saving"}
      >
        <span class="dot" aria-hidden="true"></span>
        {backupChipText}
      </button>
      {#if app.storageKind === "memory"}
        <span class="badge overdue" title="IndexedDB is unavailable. Data will be lost when this tab closes unless you export a backup.">
          Memory-only storage
        </span>
      {/if}
      <button type="button" class="icon-btn" onclick={toggleTheme} title="Toggle light/dark theme" aria-label="Toggle theme">
        <Icon name={isDark ? "sun" : "moon"} size={17} />
      </button>
      {#if desktopHost}<WindowControls />{/if}
    </header>
    <div class="body">
      {#if isNarrow}
        <nav class="compactnav" aria-label="Main navigation">
          {#each primaryNavItems as item (item.page)}
            <a
              href={"#/" + item.page}
              class:active={router.current.page === item.page}
              aria-current={router.current.page === item.page ? "page" : undefined}
            >
              <span class="nav-icon"><Icon name={item.icon} size={16} /></span>
              <span>{item.label}</span>
            </a>
          {/each}
          <div class="more-wrap" bind:this={moreWrap}>
            <button
              type="button"
              class="more-button"
              class:active={moreIsActive}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onclick={() => (moreOpen = !moreOpen)}
            >
              More ▾
            </button>
            {#if moreOpen}
              <div class="more-menu" role="menu" aria-label="More destinations">
                {#each moreNavItems as item (item.page)}
                  <a
                    role="menuitem"
                    href={"#/" + item.page}
                    class:active={router.current.page === item.page}
                    aria-current={router.current.page === item.page ? "page" : undefined}
                    onclick={() => (moreOpen = false)}
                  >
                    <span class="nav-icon"><Icon name={item.icon} size={16} /></span>
                    <span>{item.label}</span>
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        </nav>
      {:else}
        <nav class="sidenav" aria-label="Main navigation">
          {#each NAV as item (item.page)}
            {#if item.section}<div class="section">{item.section}</div>{/if}
            <a
              href={"#/" + item.page}
              class:active={router.current.page === item.page}
              aria-current={router.current.page === item.page ? "page" : undefined}
            >
              <span class="nav-icon"><Icon name={item.icon} size={17} /></span>
              <span>{item.label}</span>
            </a>
          {/each}
          <div class="sidenav-footer small muted">{backupAgeText}</div>
        </nav>
      {/if}

      <main>
        {#if !app.hasOperatorData}
          <section class="recovery-banner" role="status">
            <div>
              <strong>No RADAR records found in this {app.storageKind === "sqlite" ? "desktop database" : "browser"}.</strong>
              <span>
                If you expected existing data,
                {app.storageKind === "sqlite" ? "the wrong database file may be open" : "browser storage may have been cleared"}.
                Import your latest JSON backup before creating new records.
              </span>
            </div>
            <button type="button" class="primary" onclick={() => router.go("settings")}>Restore backup</button>
          </section>
        {/if}
        {#if ui.newTaskOpen}
          <TaskDetail defaults={ui.newTaskDefaults} onclose={() => ui.closeNewTask()} />
        {:else if detailTask}
          {#key detailTask.id}
            <TaskDetail task={detailTask} />
          {/key}
        {:else if ui.performanceFormPrefill || ui.performanceFormInput}
          <PerformanceInputForm
            input={ui.performanceFormInput}
            prefill={ui.performanceFormPrefill ?? {}}
            onclose={() => ui.closePerformanceForm()}
          />
        {:else if router.current.page === "today"}
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
        {:else if router.current.page === "travel"}
          <TravelPage />
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

  </div>

  {#if ui.quickAddOpen}
    <QuickAddTask onclose={() => (ui.quickAddOpen = false)} />
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
  {#if archivePromptTask}
    <ConfirmDialog
      title="Archive task?"
      message={`The performance input is saved. Archive "${archivePromptTask.title}" to move it off the board? You can restore it from the Archive page.`}
      confirmLabel="Archive task"
      onconfirm={() => void archivePromptedTask()}
      oncancel={() => (ui.archivePromptTaskId = undefined)}
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
  .desktop-shell { --topbar-h: 2.75rem; }
  .desktop-shell .topbar { padding-top: .2rem; padding-bottom: .2rem; }
  .desktop-titlebar { --wails-draggable: no-drag; }
  .startup-titlebar {
    --wails-draggable: drag;
    user-select: none;
  }
  .desktop-titlebar button { --wails-draggable: no-drag; }
  .titlebar-brand-region { display: contents; }
  .desktop-titlebar .titlebar-brand-region {
    --wails-draggable: drag;
    display: flex;
    align-items: center;
    align-self: stretch;
    flex: 1;
    min-width: 0;
    user-select: none;
  }
  .startup-titlebar {
    display: flex;
    align-items: center;
    height: 2.75rem;
    padding: .2rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
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
    flex: 0 0 auto;
    box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 40%, transparent);
    position: relative;
    overflow: hidden;
  }
  /* Live radar sweep rotating behind the icon — the app's signature move. */
  .brand-sweep {
    position: absolute;
    inset: -30%;
    border-radius: 50%;
    background: conic-gradient(from 0deg,
      transparent 0 72%,
      rgba(255, 255, 255, .05) 80%,
      rgba(255, 255, 255, .5) 97%,
      transparent 100%);
    animation: radar-sweep 4.6s linear infinite;
  }
  @keyframes radar-sweep {
    to { transform: rotate(360deg); }
  }
  .brand-icon {
    width: 1.28rem;
    height: 1.28rem;
    overflow: visible;
    position: relative;
  }
  .brand-icon path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .brand-icon .radar-fill {
    fill: currentColor;
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

  .backup-chip {
    cursor: pointer;
    font-weight: 600;
    min-height: 1.85rem;
  }
  .backup-chip:hover { color: var(--text); }
  .backup-chip.stale {
    color: var(--warning);
    border-color: color-mix(in srgb, var(--warning) 60%, var(--border));
  }
  .backup-chip.stale .dot { background: var(--warning); }

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

  .fault-screen {
    max-width: 38rem;
    margin: 3rem auto;
  }

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
  .sidenav .section:first-child { margin-top: 0; }
  .sidenav-footer {
    margin-top: auto;
    padding: 1rem .7rem 0;
    font-size: .72rem;
  }

  main { flex: 1; min-width: 0; overflow-x: auto; }
  /* Headings receive programmatic focus on route changes; a focus ring there
     is noise (the location change itself is the signal). */
  main :global(h1[tabindex="-1"]:focus) { outline: none; }

  /* Compact navigation for narrow windows: four primary destinations plus a
     More menu, instead of one horizontally scrolling 14-item strip. */
  .compactnav {
    display: flex;
    align-items: center;
    gap: .25rem;
    width: 100%;
    padding: .4rem .55rem;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface) 55%, var(--bg));
  }
  .compactnav a,
  .compactnav .more-button {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    min-height: 2.1rem;
    padding: .3rem .55rem;
    border: none;
    border-radius: 9px;
    background: none;
    box-shadow: none;
    color: var(--text-muted);
    text-decoration: none;
    font-weight: 600;
    font-size: .85rem;
    white-space: nowrap;
  }
  .compactnav a:hover,
  .compactnav .more-button:hover {
    background: color-mix(in srgb, var(--surface-2) 80%, transparent);
    color: var(--text);
    text-decoration: none;
  }
  .compactnav a.active,
  .compactnav .more-button.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .more-wrap {
    position: relative;
    margin-left: auto;
  }
  .more-menu {
    position: absolute;
    right: 0;
    top: calc(100% + .3rem);
    min-width: 11rem;
    padding: .3rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-elevated);
    box-shadow: var(--shadow-lg);
    z-index: 60;
    display: flex;
    flex-direction: column;
  }
  .more-menu a {
    display: flex;
    width: 100%;
  }

  .recovery-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 1rem 1.6rem 0;
    padding: .8rem 1rem;
    border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
    border-radius: var(--radius);
    background: var(--duesoon-bg);
    color: var(--duesoon-fg);
    box-shadow: var(--shadow-xs);
  }
  .recovery-banner div {
    display: grid;
    gap: .15rem;
  }
  .recovery-banner span {
    font-size: .84rem;
  }

  @media (max-width: 900px) {
    .sidenav { width: 10.5rem; }
  }
  @media (max-width: 700px) {
    .topbar { flex-wrap: wrap; }
    .brand { flex: 1 1 100%; }
    .body { flex-direction: column; }
    .recovery-banner {
      align-items: flex-start;
      flex-direction: column;
      margin: .75rem .9rem 0;
    }
  }
</style>
