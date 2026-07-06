// Cross-page UI state: global dialogs opened from anywhere (task create,
// task detail, performance-input creation prompt).

import type { PerformanceInput, Task } from "../domain/models";

class UiState {
  newTaskOpen = $state(false);
  newTaskDefaults = $state<Partial<Task>>({});
  /** Task id currently open in the detail dialog. */
  detailTaskId = $state<string | undefined>(undefined);
  /** Completed task for the "create performance input?" prompt. */
  performancePromptTask = $state<Task | undefined>(undefined);
  /** Prefill for the performance input form; undefined = closed. */
  performanceFormPrefill = $state<Partial<PerformanceInput> | undefined>(undefined);
  /** Existing performance input open for editing; undefined = closed. */
  performanceFormInput = $state<PerformanceInput | undefined>(undefined);
  /**
   * Task id for the "archive this task?" prompt shown after a performance
   * input is saved for a completed task. An id (not a Task snapshot) so the
   * prompt always acts on the current record.
   */
  archivePromptTaskId = $state<string | undefined>(undefined);

  closePerformanceForm(): void {
    this.performanceFormPrefill = undefined;
    this.performanceFormInput = undefined;
  }

  openNewTask(defaults: Partial<Task> = {}): void {
    this.newTaskDefaults = defaults;
    this.newTaskOpen = true;
  }

  closeNewTask(): void {
    this.newTaskDefaults = {};
    this.newTaskOpen = false;
  }

  openTaskDetail(id: string): void {
    this.detailTaskId = id;
  }
}

export const ui = new UiState();
