// Cross-page UI state: global dialogs opened from anywhere (quick add,
// task detail, performance-input creation prompt).

import type { PerformanceInput, Task } from "../domain/models";

class UiState {
  quickAddOpen = $state(false);
  quickAddDefaults = $state<Partial<Task>>({});
  /** Task id currently open in the detail dialog. */
  detailTaskId = $state<string | undefined>(undefined);
  /** Completed task for the "create performance input?" prompt. */
  performancePromptTask = $state<Task | undefined>(undefined);
  /** Prefill for the performance input form; undefined = closed. */
  performanceFormPrefill = $state<Partial<PerformanceInput> | undefined>(undefined);

  openQuickAdd(defaults: Partial<Task> = {}): void {
    this.quickAddDefaults = defaults;
    this.quickAddOpen = true;
  }

  openTaskDetail(id: string): void {
    this.detailTaskId = id;
  }
}

export const ui = new UiState();
